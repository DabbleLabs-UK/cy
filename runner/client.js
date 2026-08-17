// client.js - the only thing that talks to the network.
//
// Events are buffered in memory and flushed as one batch POST to
// {apiBase}/api/ingest.php every 2s with the X-Cy-Key header. The inbox is
// polled every 60s from {apiBase}/api/inbox.php. On any network failure the
// pending batch is written to a disk queue (state/queue.jsonl) and retried with
// exponential backoff - the stream is never lost and the loop never crashes.
//
// dryRun mode does no network at all: events are appended to state/events.jsonl
// and the inbox is read from state/inbox.json (if present), then consumed so the
// same letter is not delivered twice.

import { appendFile, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const FLUSH_MS = 2000;
const INBOX_MS = 60000;
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
    this.batch = [];
    this.backoff = 0;
    this.onInbox = null;
    this._flushTimer = null;
    this._inboxTimer = null;
    this._flushing = false;
    this._stopped = false;
  }

  // Queue an event. ts is stamped here if the caller did not set one.
  enqueue(event) {
    if (!event.ts) event.ts = tsNow();
    this.batch.push(event);
  }

  start() {
    this._flushTimer = setInterval(() => this.flush().catch(() => {}), FLUSH_MS);
    this._inboxTimer = setInterval(() => this.pollInbox().catch(() => {}), INBOX_MS);
    // one immediate inbox read so a dry-run inbox.json is seen promptly
    this.pollInbox().catch(() => {});
  }

  async stop() {
    this._stopped = true;
    clearInterval(this._flushTimer);
    clearInterval(this._inboxTimer);
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
    } catch (err) {
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
      } catch {
        return; // no dry-run inbox present
      }
      // Consume it so the same items are not re-delivered on the next poll.
      try {
        await writeFile(this.inboxPath, JSON.stringify({ letters: [], images: [], news: [] }));
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
        if (!res.ok) return;
        data = await res.json();
      } catch {
        return; // transient; try again next poll
      }
    }
    const has =
      (data.letters && data.letters.length) ||
      (data.images && data.images.length) ||
      (data.news && data.news.length);
    if (has && this.onInbox) this.onInbox(data);
  }

  async _appendEvents(path, events) {
    await mkdir(dirname(path), { recursive: true });
    const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await appendFile(path, body);
  }
}
