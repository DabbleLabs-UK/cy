// client.js - the only thing that talks to the network.
//
// Events are buffered in memory and flushed as one batch POST to
// {apiBase}/api/ingest.php every 2s with the X-Cy-Key header. The inbox is
// polled every ~3s from {apiBase}/api/inbox.php on its OWN timer, independent of
// the generation loop, so a posted postcard reaches Cy within seconds. The poll
// is a tiny query; a failed poll is a no-op that keeps the last known state (it
// never blocks or slows generation). On any network failure the pending batch is
// written to a disk queue (state/queue.jsonl) and retried with exponential
// backoff - the stream is never lost and the loop never crashes.
//
// dryRun mode does no network at all: events are appended to state/events.jsonl
// and the inbox is read from state/inbox.json (if present), then consumed so the
// same letter is not delivered twice.

import { appendFile, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { clampSpeed } from './tempo.js';

const FLUSH_MS = 2000;
// Poll the inbox on its own fast timer so a posted postcard is delivered within
// seconds (instant delivery). It is a tiny, cheap query and must never block or
// slow the generation loop; a failed poll retains the last known state.
const INBOX_MS = 3000;
// Poll the tempo row every ~3s. It carries not just the viewer-driven duty cycle
// but the OPERATOR PAUSE flag, and the pause has to be picked up within a few
// seconds so the pause control can confirm the runner's real state promptly (a
// 12s poll made the button look like it had failed even on success). The query is
// tiny and onTempo only fires on an actual change, so a faster poll is cheap.
const TEMPO_MS = 3000;
const MAX_BACKOFF_MS = 60000;

// MariaDB DATETIME(3) string, e.g. "2026-08-17 19:30:00.123".
export function tsNow(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

export class Client {
  constructor(config, stateDir) {
    this.config = config;
    this.stateDir = stateDir;
    this.eventsPath = join(stateDir, 'events.jsonl');
    this.queuePath = join(stateDir, 'queue.jsonl');
    this.inboxPath = join(stateDir, 'inbox.json');
    this.tempoPath = join(stateDir, 'tempo.json');
    this.batch = [];
    this.backoff = 0;
    this.onInbox = null;
    this.onTempo = null;
    // Fired from pollTempo the moment the operator pause flag TRANSITIONS, so the
    // runner can cut the in-flight burst and confirm the pause/resume at once
    // rather than at the end of the current 30-60s generation.
    this.onPause = null;
    this.onResume = null;
    // Active model provider, owner-set via /api/admin.php and read off the same
    // tempo poll below (it lives on the tempo row alongside `paused`). Defaults to
    // 'ollama' so a poll failure at startup never switches blindly. onProviderChange
    // fires the moment it transitions so the runner can cut the in-flight burst and
    // continue with the new provider, no restart.
    this.provider = 'ollama';
    this.onProviderChange = null;
    // last known tempo. Defaults to 100 (continuous, the old behaviour) so an
    // endpoint that is unreachable at startup never stalls or throttles blindly;
    // the first successful poll replaces it.
    this.tempo = { speed: 100, viewers: 0, custom: false };
    // Operator pause (owner-only, set via /api/admin.php, read off the same tempo
    // poll below). While true the generation loop makes NO ollama calls at all;
    // every other timer keeps running. Defaults false so a poll failure at startup
    // never freezes the loop - the first successful poll sets the real value.
    this.paused = false;
    // live diagnostics: whether the last inbox/tempo poll succeeded, and the
    // last error string seen talking to the server (null once things recover).
    // Start null (unknown) so the HUD does not claim a failure before any poll.
    this.lastInboxOk = null;
    this.lastTempoOk = null;
    this.lastError = null;
    this._flushTimer = null;
    this._inboxTimer = null;
    this._tempoTimer = null;
    this._flushing = false;
    this._stopped = false;
  }

  // Queue an event. ts is stamped here if the caller did not set one.
  enqueue(event) {
    if (!event.ts) event.ts = tsNow();
    this.batch.push(event);
  }

  // Priority flush for latency-sensitive events (the public inference LED). Sends
  // the pending batch NOW instead of waiting up to FLUSH_MS, so a state the viewer
  // is watching for lands within a poll rather than a batch window. If a flush is
  // already in flight the guard inside flush() makes this a no-op and the event
  // rides the next scheduled flush - still bounded by FLUSH_MS. Best-effort.
  kick() {
    if (this._stopped) return;
    this.flush().catch(() => {});
  }

  start() {
    this._flushTimer = setInterval(() => this.flush().catch(() => {}), FLUSH_MS);
    this._inboxTimer = setInterval(() => this.pollInbox().catch(() => {}), INBOX_MS);
    this._tempoTimer = setInterval(() => this.pollTempo().catch(() => {}), TEMPO_MS);
    // one immediate inbox read so a dry-run inbox.json is seen promptly
    this.pollInbox().catch(() => {});
    // one immediate tempo read so the duty cycle is right from the first burst
    this.pollTempo().catch(() => {});
  }

  async stop() {
    this._stopped = true;
    clearInterval(this._flushTimer);
    clearInterval(this._inboxTimer);
    clearInterval(this._tempoTimer);
    await this.flush().catch(() => {});
  }

  async flush() {
    if (this._flushing) return;
    this._flushing = true;
    try {
      if (this.batch.length === 0 && this.backoff === 0) return;
      const events = this.batch;
      this.batch = [];

      if (this.config.dryRun) {
        if (events.length) await this._appendEvents(this.eventsPath, events);
        return;
      }

      // Live: try to drain the disk queue first, then this batch.
      await this._drainQueue();
      if (events.length) await this._send(events);
    } catch (err) {
      // handled inside _send/_drainQueue by re-queuing; nothing to do
    } finally {
      this._flushing = false;
    }
  }

  async _send(events) {
    try {
      const res = await fetch(`${this.config.apiBase}/api/ingest.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cy-Key': this.config.ingestKey,
        },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`ingest HTTP ${res.status}`);
      this.backoff = 0;
      this.lastError = null;
    } catch (err) {
      this.lastError = String(err && err.message ? err.message : err);
      // Persist to disk queue and back off. Never lose the events.
      await this._appendEvents(this.queuePath, events);
      this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff ? this.backoff * 2 : 2000);
      throw err;
    }
  }

  async _drainQueue() {
    let raw;
    try {
      raw = await readFile(this.queuePath, 'utf8');
    } catch {
      return; // no queue file
    }
    const lines = raw.split('\n').filter((l) => l.trim());
    if (!lines.length) return;
    const queued = [];
    for (const l of lines) {
      try {
        queued.push(JSON.parse(l));
      } catch {
        /* skip corrupt line */
      }
    }
    if (!queued.length) {
      await writeFile(this.queuePath, '');
      return;
    }
    // Send in chunks so one huge backlog does not build a 50MB body.
    const CHUNK = 500;
    for (let i = 0; i < queued.length; i += CHUNK) {
      const slice = queued.slice(i, i + CHUNK);
      const res = await fetch(`${this.config.apiBase}/api/ingest.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cy-Key': this.config.ingestKey,
        },
        body: JSON.stringify({ events: slice }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`queue drain HTTP ${res.status}`);
    }
    // Whole queue delivered - clear it.
    await writeFile(this.queuePath, '');
    this.backoff = 0;
  }

  async pollInbox() {
    let data;
    if (this.config.dryRun) {
      try {
        const raw = await readFile(this.inboxPath, 'utf8');
        data = JSON.parse(raw);
        this.lastInboxOk = true;
      } catch {
        return; // no dry-run inbox present (not treated as a failure)
      }
      // Consume it so the same items are not re-delivered on the next poll.
      try {
        await writeFile(this.inboxPath, JSON.stringify({ postcards: [], news: [], warden: [] }));
      } catch {
        /* ignore */
      }
    } else {
      try {
        const res = await fetch(`${this.config.apiBase}/api/inbox.php`, {
          method: 'GET',
          headers: { 'X-Cy-Key': this.config.ingestKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          this.lastInboxOk = false;
          this.lastError = `inbox HTTP ${res.status}`;
          return;
        }
        data = await res.json();
        this.lastInboxOk = true;
      } catch (err) {
        this.lastInboxOk = false;
        this.lastError = String(err && err.message ? err.message : err);
        return; // transient; try again next poll
      }
    }
    const has =
      (data.postcards && data.postcards.length) ||
      (data.news && data.news.length) ||
      (data.warden && data.warden.length);
    if (has && this.onInbox) this.onInbox(data);
  }

  // Poll the viewer-driven tempo. Degrades safely: on ANY failure (network,
  // non-200, bad body) it returns without touching this.tempo, so the last known
  // value keeps driving the duty cycle rather than stalling or running flat out.
  // dryRun reads an optional state/tempo.json (NOT consumed - it is live state).
  async pollTempo() {
    let data;
    if (this.config.dryRun) {
      try {
        data = JSON.parse(await readFile(this.tempoPath, 'utf8'));
        this.lastTempoOk = true;
      } catch {
        return; // no dry-run tempo file - keep last known
      }
    } else {
      try {
        const res = await fetch(`${this.config.apiBase}/api/tempo.php`, {
          method: 'GET',
          headers: { 'X-Cy-Key': this.config.ingestKey },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          this.lastTempoOk = false;
          this.lastError = `tempo HTTP ${res.status}`;
          return; // keep last known
        }
        data = await res.json();
        this.lastTempoOk = true;
      } catch (err) {
        this.lastTempoOk = false;
        this.lastError = String(err && err.message ? err.message : err);
        return; // transient; keep last known
      }
    }
    // Pause rides on the same poll (it lives on the tempo row). Detect the
    // TRANSITION here and fire onPause/onResume at once, so the runner can cut the
    // in-flight burst and confirm the operator's action immediately - not at the
    // end of the current 30-60s generation. Handled before the speed early-return
    // below, so a resume/pause is honoured even if speed is somehow absent and
    // cannot be stranded by a malformed tempo body.
    if (data && typeof data.paused !== 'undefined') {
      const next = !!data.paused;
      if (next !== this.paused) {
        this.paused = next;
        if (next) {
          if (this.onPause) this.onPause();
        } else if (this.onResume) {
          this.onResume();
        }
      }
    }
    // The active provider rides on the same tempo poll (it lives on the tempo row
    // next to `paused`). Detect the TRANSITION here and fire onProviderChange so the
    // runner can switch mid-loop - abort the in-flight burst and continue with the
    // new provider. Handled before the speed early-return so a switch is honoured
    // even if speed is somehow absent from a malformed tempo body.
    if (data && typeof data.provider === 'string' && data.provider) {
      if (data.provider !== this.provider) {
        this.provider = data.provider;
        if (this.onProviderChange) this.onProviderChange(data.provider);
      }
    }
    if (!data || data.speed == null) return;
    const next = {
      speed: clampSpeed(data.speed),
      viewers: Number(data.viewers) || 0,
      custom: !!data.custom,
    };
    const changed =
      next.speed !== this.tempo.speed ||
      next.viewers !== this.tempo.viewers ||
      next.custom !== this.tempo.custom;
    this.tempo = next;
    if (changed && this.onTempo) this.onTempo(next);
  }

  async _appendEvents(path, events) {
    await mkdir(dirname(path), { recursive: true });
    const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await appendFile(path, body);
  }
}
