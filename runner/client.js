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

import { appendFile, readFile, writeFile, rename, mkdir, open } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

import { clampSpeed } from './tempo.js';
import { ingestionRecordFromEnvironment } from './feeding-homeostasis.js';

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
const STOP_FLUSH_PASSES = 3;
const MAX_QUEUE_QUARANTINE_BYTES = 8 * 1024 * 1024;

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
    this.queueQuarantinePath = join(stateDir, 'queue.quarantine.json');
    this._queueQuarantineMaxBytes = MAX_QUEUE_QUARANTINE_BYTES;
    this.memorySourcesPath = join(stateDir, 'memory-sources.jsonl');
    this.inboxPath = join(stateDir, 'inbox.json');
    this.tempoPath = join(stateDir, 'tempo.json');
    this.batch = [];
    this.backoff = 0;
    this.onInbox = null;
    this.onTempo = null;
    this.onDelivered = null;
    this.onWorldMirrorConflict = null;
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
    // Owner regime override, owner-set via /api/admin.php and read off the same
    // tempo poll below (it lives on the tempo row alongside `paused`/`provider`).
    // 'auto' follows the clock (no override); 'day' forces awake; 'night' forces
    // asleep. Defaults to 'auto' so a poll failure at startup never forces a state
    // blindly. onRegimeChange fires the moment it transitions so the runner can cut
    // the in-flight burst and re-evaluate the sleep state at once, no restart.
    this.regime = 'auto';
    this.regimeLoaded = false;
    this.onRegimeChange = null;
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
    this._flushPromise = null;
    this._memorySourceWork = Promise.resolve();
    this._stopped = false;
  }

  // Queue an event. ts is stamped here if the caller did not set one.
  enqueue(event) {
    if (!event.ts) event.ts = tsNow();
    // An enqueue is a new logical delivery. Retries reuse this ID from the
    // owned batch or disk queue; a later enqueue, even of the same object,
    // must not be mistaken for the earlier delivery.
    event.delivery_id = randomUUID();
    this.batch.push({ ...event });
  }

  // A checkpointed day rollover already owns its stable delivery identity.
  // Do not mint another ID when replaying that outbox entry after a restart.
  enqueueDayRollover(event) {
    if (event.kind !== 'day' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(event.delivery_id || '')) {
      throw new Error('identified day rollover required');
    }
    this.batch.push({ ...event });
  }

  // Priority flush for latency-sensitive events (the public inference LED). Sends
  // the pending batch NOW instead of waiting up to FLUSH_MS, so a state the viewer
  // is watching for lands within a poll rather than a batch window. If a flush is
  // already in flight, callers share that work and the event rides the next
  // scheduled flush. Best-effort.
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
    // An active flush may have left a later batch in memory. Give later batches
    // a bounded chance to send, then queue any remainder for the next runner.
    for (let pass = 0; pass < STOP_FLUSH_PASSES; pass += 1) {
      await this.flush();
      if (!this.batch.length) break;
    }
    if (this.batch.length) await this._queuePendingBatch();
    if (this.batch.length) throw new Error('events arrived during final shutdown queue write');
    await this.drainMemorySourceQueue().catch(() => {});
  }

  flush() {
    if (this._flushPromise) return this._flushPromise;
    this._flushPromise = this._flushPending().finally(() => {
      this._flushPromise = null;
    });
    return this._flushPromise;
  }

  async _flushPending() {
    if (this.batch.length === 0 && this.backoff === 0) return;

    if (this.config.dryRun) {
      const events = this.batch;
      this.batch = [];
      if (events.length) {
        try {
          await this._appendEvents(this.eventsPath, events);
          this.onDelivered?.(events);
        } catch (err) {
          this.batch = events.concat(this.batch);
          throw err;
        }
      }
      return;
    }

    // The older disk queue owns delivery priority. Do not remove the new batch
    // from memory until the drain has succeeded. If it fails, append the new
    // batch after the old queue so a later retry preserves event order.
    try {
      await this._drainQueue();
    } catch (err) {
      this.lastError = String(err && err.message ? err.message : err);
      await this._queuePendingBatch();
      return;
    }

    const events = this.batch;
    this.batch = [];
    if (!events.length) return;
    try {
      await this._send(events);
      this.onDelivered?.(events);
    } catch (err) {
      this.lastError = String(err && err.message ? err.message : err);
      await this._queueEvents(events);
      this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff ? this.backoff * 2 : 2000);
    }
  }

  async _queuePendingBatch() {
    const events = this.batch;
    this.batch = [];
    if (events.length) await this._queueEvents(events);
  }

  async _queueEvents(events) {
    for (const event of events) {
      if (!event.delivery_id) event.delivery_id = randomUUID();
    }
    try {
      await this._appendQueueEvents(events);
    } catch (err) {
      // Disk persistence failed too: the events are still owned in memory and
      // shutdown must report failure rather than pretending they were saved.
      this.batch = events.concat(this.batch);
      throw err;
    }
  }

  async _send(events) {
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
    const response = typeof res.json === 'function' ? await res.json() : {};
    if (response.world_mirror_conflicts?.length) {
      this.onWorldMirrorConflict?.(response.world_mirror_conflicts);
    }
    this.backoff = 0;
    this.lastError = null;
  }

  async fetchWorldMirror() {
    if (this.config.dryRun) return { objects: [], threads: [] };
    const res = await fetch(`${this.config.apiBase}/api/world-mirror.php`, {
      headers: { 'X-Cy-Key': this.config.ingestKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`world mirror HTTP ${res.status}`);
    const body = await res.json();
    if (!body || !Array.isArray(body.objects) || !Array.isArray(body.threads)) {
      throw new Error('malformed world mirror response');
    }
    return body;
  }

  async republishWorldMirror(records) {
    if (this.config.dryRun || !records.length) return;
    const events = records.map(({ kind, entity }) => ({
      ts: tsNow(), kind: kind === 'object' ? 'world_object_record' : 'world_thread_record',
      payload: entity,
      // A checkpoint-backed republish is the same logical transition each
      // time. It need not occupy the ordinary retry queue: the checkpoint is
      // already durable and startup/reconnect reconciliation repeats it.
      delivery_id: entity.transitionId,
    }));
    const res = await fetch(`${this.config.apiBase}/api/ingest.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cy-Key': this.config.ingestKey },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`world mirror republish HTTP ${res.status}`);
    const response = await res.json();
    if (response.world_mirror_conflicts?.length) {
      throw new Error('world mirror transition conflict during republish');
    }
  }

  async _drainQueue() {
    let raw;
    try {
      raw = await readFile(this.queuePath);
    } catch (err) {
      if (err && err.code === 'ENOENT') return; // no queue file
      throw err;
    }
    if (!raw.length) return;
    const queued = [];
    const validLines = [];
    const malformed = [];
    let assignedLegacyIds = false;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let start = 0;
    for (let end = 0; end <= raw.length; end += 1) {
      if (end < raw.length && raw[end] !== 10) continue;
      if (end === start && end === raw.length) break;
      const line = raw.subarray(start, end < raw.length ? end + 1 : end);
      try {
        const event = JSON.parse(decoder.decode(line));
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
          throw new Error('NOT_EVENT_OBJECT');
        }
        if (!event.delivery_id) {
          event.delivery_id = randomUUID();
          assignedLegacyIds = true;
        }
        queued.push(event);
        validLines.push(line);
      } catch (error) {
        malformed.push({
          offset: start,
          bytes: line,
          reason: error && error.message === 'NOT_EVENT_OBJECT' ? 'NOT_EVENT_OBJECT'
            : error instanceof TypeError ? 'INVALID_UTF8' : 'MALFORMED_JSON',
        });
      }
      start = end + 1;
    }
    if (malformed.length || assignedLegacyIds) {
      try {
        const result = malformed.length
          ? await this._quarantineQueueLines(malformed) : null;
        const compact = assignedLegacyIds
          ? Buffer.from(queued.map((event) => JSON.stringify(event)).join('\n') + '\n')
          : Buffer.concat(validLines);
        const terminated = compact.length && compact[compact.length - 1] !== 10
          ? Buffer.concat([compact, Buffer.from('\n')]) : compact;
        await this._atomicReplace(this.queuePath, terminated);
        if (malformed.length) {
          console.warn(`[cy] queue: quarantined ${malformed.length} malformed record(s) in ${this.queueQuarantinePath}` +
            (result.evicted ? `; ${result.evicted} oldest quarantine record(s) expired at the size limit` : '') +
            (result.truncated ? `; ${result.truncated} oversized record(s) retained as bounded prefixes` : ''));
        }
      } catch (error) {
        console.error(`[cy] queue: quarantine/identity upgrade failed; active queue retained: ${error.message}`);
        throw error;
      }
    }
    if (!queued.length) {
      if (!malformed.length) await writeFile(this.queuePath, '');
      this.backoff = 0;
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
      const response = typeof res.json === 'function' ? await res.json() : {};
      if (response.world_mirror_conflicts?.length) {
        this.onWorldMirrorConflict?.(response.world_mirror_conflicts);
      }
      this.onDelivered?.(slice);
    }
    // Whole queue delivered - clear it.
    await writeFile(this.queuePath, '');
    this.backoff = 0;
  }

  async _quarantineQueueLines(malformed) {
    let state = {
      schema: 'cy.queue-quarantine.v1',
      evictedRecords: 0,
      evictedRawBytes: 0,
      entries: [],
    };
    try {
      state = JSON.parse(await readFile(this.queueQuarantinePath, 'utf8'));
      if (state.schema !== 'cy.queue-quarantine.v1' || !Array.isArray(state.entries)) {
        throw new Error('unrecognised queue quarantine format');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const maxBytes = this._queueQuarantineMaxBytes;
    const maxRawEntryBytes = Math.floor(maxBytes / 2);
    let truncated = 0;
    for (const item of malformed) {
      const stored = item.bytes.subarray(0, maxRawEntryBytes);
      if (stored.length < item.bytes.length) truncated += 1;
      state.entries.push({
        at: new Date().toISOString(),
        offset: item.offset,
        reason: item.reason,
        rawBytes: item.bytes.length,
        sha256: createHash('sha256').update(item.bytes).digest('hex'),
        rawBase64: stored.toString('base64'),
        truncated: stored.length < item.bytes.length,
      });
    }
    let evicted = 0;
    let body = JSON.stringify(state) + '\n';
    while (Buffer.byteLength(body) > maxBytes && state.entries.length > 1) {
      const oldest = state.entries.shift();
      state.evictedRecords += 1;
      state.evictedRawBytes += oldest.rawBytes;
      evicted += 1;
      body = JSON.stringify(state) + '\n';
    }
    if (Buffer.byteLength(body) > maxBytes) {
      throw new Error('queue quarantine size limit cannot hold one record');
    }
    await this._atomicReplace(this.queueQuarantinePath, body);
    return { evicted, truncated };
  }

  async _atomicReplace(path, data) {
    const temporary = `${path}.tmp`;
    const handle = await open(temporary, 'w');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  }

  async _appendQueueEvents(events) {
    await mkdir(dirname(this.queuePath), { recursive: true });
    let separator = '';
    let handle;
    try {
      handle = await open(this.queuePath, 'r');
      const { size } = await handle.stat();
      if (size) {
        const tail = Buffer.alloc(1);
        await handle.read(tail, 0, 1, size - 1);
        if (tail[0] !== 10) separator = '\n';
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    } finally {
      if (handle) await handle.close();
    }
    await this._appendEvents(this.queuePath, events, separator);
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
        await writeFile(this.inboxPath, JSON.stringify({ postcards: [], fan_mail: [], news: [], warden: [] }));
      } catch {
        /* ignore */
      }
    } else {
      try {
        const res = await fetch(`${this.config.apiBase}/api/inbox.php?fan_mail=1`, {
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
      (data.fan_mail && data.fan_mail.length) ||
      (data.news && data.news.length) ||
      (data.warden && data.warden.length);
    if (has && this.onInbox) this.onInbox(data);
  }

  async fetchObservedSleepHistory() {
    if (this.config.dryRun) return [];
    const res = await fetch(`${this.config.apiBase}/api/sleep-history.php`, {
      method: 'GET',
      headers: { 'X-Cy-Key': this.config.ingestKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`sleep history HTTP ${res.status}`);
    const data = await res.json();
    if (!data || data.ok !== true || !Array.isArray(data.records)) {
      throw new Error('malformed sleep history response');
    }
    return data.records;
  }

  async fetchSatietyRecoveryHistory() {
    if (this.config.dryRun) return { complete: false, records: [] };
    const res = await fetch(`${this.config.apiBase}/api/satiety-recovery-history.php`, {
      method: 'GET',
      headers: { 'X-Cy-Key': this.config.ingestKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`satiety recovery history HTTP ${res.status}`);
    const data = await res.json();
    const queued = [];
    let queueComplete = true;
    try {
      const raw = await readFile(this.queuePath, 'utf8');
      for (const line of raw.split('\n').filter((item) => item.trim())) {
        let event;
        try { event = JSON.parse(line); } catch { queueComplete = false; break; }
        if (event.kind !== 'world_event_record') continue;
        const payload = event.payload;
        const intake = payload && payload.feeding && payload.feeding.ledger && payload.feeding.ledger.record;
        if (intake && intake.schema === 'cy.ingestion-record') queued.push(intake);
        else if (payload && payload.world_event && payload.world_event.archetype_id === 'meal') {
          const derived = ingestionRecordFromEnvironment(payload);
          if (derived) queued.push(derived);
          else queueComplete = false;
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') queueComplete = false;
    }
    return {
      complete: data.complete === true && data.ok === true && queueComplete,
      records: Array.isArray(data.records)
        ? data.records.map((record) => record && record.schema === 'cy.environment-record'
          ? ingestionRecordFromEnvironment(record) || record : record).concat(queued)
        : [],
    };
  }

  async _memoryRequest(action, payload = {}) {
    if (this.config.dryRun) {
      if (action === 'query') {
        return { candidates: [], mechanisms: [], privacy_filter: { applied: true, dry_run: true } };
      }
      return { ok: true, dry_run: true, applied: 0 };
    }
    const res = await fetch(`${this.config.apiBase}/api/memory.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cy-Key': this.config.ingestKey,
      },
      body: JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`memory ${action} HTTP ${res.status}`);
    return res.json();
  }

  async queryMemories({
    query, visitorId = null, limit = 10, recentExpressionText = '', querySourceType = null,
  } = {}) {
    return this._memoryRequest('query', {
      query: query || {}, visitor_id: visitorId, limit,
      // Provenance only - see captive_memory_rank_candidates's doc comment.
      // Never affects which candidates are fetched/ranked/limited.
      recent_expression_text: recentExpressionText || '',
      query_source_type: querySourceType || null,
    });
  }

  async applyMemoryOperations(operations) {
    return this._memoryRequest('apply', { operations });
  }

  async recordMemoryQuery({ generationRef = null, inspection } = {}) {
    return this._memoryRequest('record_query', {
      generation_ref: generationRef,
      current_context: inspection && inspection.query || {},
      query_source_type: (inspection && inspection.querySourceType) || null,
      sender_known: !!(inspection && inspection.senderKnown),
      candidate_memory_ids: inspection && inspection.candidateIds || [],
      retrieval_mechanisms: inspection && inspection.mechanisms || [],
      candidate_match_provenance: (inspection && inspection.candidateProvenance) || {},
      privacy_filter: inspection && inspection.privacyFilter || {},
      offered_memory_ids: inspection && inspection.offeredIds || [],
      selected_memory_ids: inspection && inspection.selectedIds || [],
      inserted_memory_ids: inspection && inspection.insertedIds || [],
      repeated_from_previous_generation_ids: (inspection && inspection.repeatedFromPreviousGenerationIds) || [],
      selected_memory_reasons: inspection && inspection.selectedReasons || {},
    });
  }

  async recordMemoryActivity(activity) {
    const value = activity || {};
    return this._memoryRequest('activity', {
      memory_id: value.memoryId || null,
      activity_type: value.activityType || '',
      public_text: value.publicText || null,
      privacy_scope: value.privacyScope || 'INTERNAL_ONLY',
      reason_codes: value.reasonCodes || [],
    });
  }

  async enqueueMemorySource(source) {
    const work = async () => {
      await mkdir(dirname(this.memorySourcesPath), { recursive: true });
      await appendFile(this.memorySourcesPath, `${JSON.stringify(source)}\n`, 'utf8');
      return this._drainMemorySourceQueue();
    };
    const result = this._memorySourceWork.then(work, work);
    this._memorySourceWork = result.catch(() => {});
    return result;
  }

  async drainMemorySourceQueue() {
    const work = () => this._drainMemorySourceQueue();
    const result = this._memorySourceWork.then(work, work);
    this._memorySourceWork = result.catch(() => {});
    return result;
  }

  async _drainMemorySourceQueue() {
    let raw;
    try {
      raw = await readFile(this.memorySourcesPath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return { queued: false, pending: 0 };
      throw error;
    }
    const sources = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    let last = { queued: false };
    for (let index = 0; index < sources.length; index += 1) {
      try {
        last = await this._memoryRequest('enqueue_source', { source: sources[index] });
      } catch (error) {
        const pending = sources.slice(index);
        const tempPath = `${this.memorySourcesPath}.tmp`;
        await writeFile(tempPath, pending.map((source) => JSON.stringify(source)).join('\n') + '\n', 'utf8');
        await rename(tempPath, this.memorySourcesPath);
        throw error;
      }
    }
    const tempPath = `${this.memorySourcesPath}.tmp`;
    await writeFile(tempPath, '', 'utf8');
    await rename(tempPath, this.memorySourcesPath);
    return { ...last, pending: 0 };
  }

  async claimMemorySource() {
    return this._memoryRequest('claim_source');
  }

  async completeMemorySource(value) {
    return this._memoryRequest('complete_source', value || {});
  }

  async enqueueMemorySurfacing(value) {
    return this._memoryRequest('enqueue_surfacing', value || {});
  }

  async claimMemorySurfacing() {
    return this._memoryRequest('claim_surfacing');
  }

  async completeMemorySurfacing(value) {
    return this._memoryRequest('complete_surfacing', value || {});
  }

  async getPreparedMemorySet({ contextFingerprint, visitorId = null } = {}) {
    return this._memoryRequest('prepared_get', {
      context_fingerprint: contextFingerprint,
      visitor_id: visitorId,
    });
  }

  async consumePreparedMemorySet({ preparedSetId, generationRef, visitorId = null } = {}) {
    return this._memoryRequest('consume_prepared', {
      prepared_set_id: preparedSetId,
      generation_ref: generationRef,
      visitor_id: visitorId,
    });
  }

  // Poll the viewer-driven tempo. Degrades safely: on ANY failure (network,
  // non-200, bad body) it returns without touching this.tempo, so the last known
  // value keeps driving the duty cycle rather than stalling or running flat out.
  // dryRun reads an optional state/tempo.json (NOT consumed - it is live state).
  async pollTempo({ regimeOnly = false } = {}) {
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
    // Startup reads only this field before any sleep/location decision. The
    // provider and pause handlers are not yet installed at that point.
    if (regimeOnly) {
      if (data && ['auto', 'day', 'night'].includes(data.regime)) {
        this.regime = data.regime;
        this.regimeLoaded = true;
      }
      return;
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
    // The owner regime override rides the same tempo poll (it lives on the tempo
    // row next to `paused`/`provider`). Detect the TRANSITION here and fire
    // onRegimeChange so the runner can cut the in-flight burst and re-evaluate the
    // sleep state immediately - forcing 'day' wakes him, 'night' puts him under.
    // Handled before the speed early-return so it is honoured even if speed is
    // somehow absent from a malformed tempo body.
    if (data && ['auto', 'day', 'night'].includes(data.regime)) {
      this.regimeLoaded = true;
      if (data.regime !== this.regime) {
        this.regime = data.regime;
        if (this.onRegimeChange) this.onRegimeChange(data.regime);
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

  async _appendEvents(path, events, prefix = '') {
    await mkdir(dirname(path), { recursive: true });
    const body = prefix + events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await appendFile(path, body);
  }
}
