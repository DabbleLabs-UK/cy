// One optional, cue-bound preparation for an existing expressive opportunity.
// This lane never supplies the global working set and never waits for a journal.
import { createHash } from 'node:crypto';
import { filterMemoriesBeforePrompt, formatAutobiographicalMemory,
  sourceFromEnvironmentRecord } from './autobiographical-memory.js';

export const JOURNAL_PREPARATION_VERSION = 'cy.journal-preparation.v1';
export const JOURNAL_PREPARATION_TTL_MS = 15 * 60 * 1000;
const LOOKAHEAD_MS = JOURNAL_PREPARATION_TTL_MS - 120000;
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const empty = reason => ({ directive: '', selected: [], inspection: { status: reason } });

export function journalMemoryCue(record) {
  const source = sourceFromEnvironmentRecord(record);
  const event = record?.world_event;
  if (!source || !record.consumed_by?.includes('soma-input-staging-v1')) return null;
  const cue = {
    version: 'cy.journal-cue.v1', sourceEventId: source.sourceId,
    occurredAt: source.occurredAt, eventType: event.event_type, eventFamily: event.event_family,
    text: [...source.text.trim()].slice(0, 600).join(''),
    tags: [...new Set(source.tags.map(tag => String(tag).trim().toLowerCase()).filter(Boolean))].sort(),
    location: event.world?.context?.location ?? null, scope: 'NO_SENDER_JOURNAL',
  };
  if (!cue.text || ![cue.sourceEventId, cue.occurredAt, cue.eventType, cue.eventFamily].every(v => typeof v === 'string')
      || (cue.location !== null && typeof cue.location !== 'string')) return null;
  cue.digest = hash(JSON.stringify(Object.values(cue)));
  return cue;
}

export function journalPreparationContext(binding) {
  const cue = binding.cue;
  return {
    text: cue.text, tags: cue.tags, location: cue.location,
    publicSituation: cue.text, groundedContext: cue.text, currentVisitorId: null,
    querySourceType: 'ENVIRONMENT_EVENT', recentExpressionText: '',
    generationRef: `journal:${binding.slotAnchorMs}`, journalPreparation: copy(binding),
  };
}

export class JournalMemoryPreparation {
  constructor({ now = () => Date.now(), availability }) {
    this.now = now;
    this.availability = availability;
    this.pending = null;
    this.serial = 0;
    this.handledSerial = 0;
    this.lastAdmittedAnchor = 0;
    this.lastClosedAnchor = 0;
    this.slot = null;
    this.openAnchor = null;
    this.validationEpoch = 0;
    this.acknowledged = new Map();
  }

  observe(record) {
    const cue = journalMemoryCue(record);
    if (!cue || equal(cue, this.pending?.cue)) return;
    this.pending = { cue, serial: ++this.serial,
      acknowledged: this.acknowledged.get(cue.sourceEventId) === cue.digest };
    if (this.slot && !equal(this.slot.binding.cue, cue)) this.invalidate('NEWER_CUE');
  }

  acknowledge(events) {
    for (const event of events || []) {
      if (event.kind !== 'world_event_record') continue;
      const cue = journalMemoryCue(event.payload);
      if (!cue) continue;
      this.acknowledged.set(cue.sourceEventId, cue.digest);
      while (this.acknowledged.size > 64) this.acknowledged.delete(this.acknowledged.keys().next().value);
      if (equal(cue, this.pending?.cue)) this.pending.acknowledged = true;
    }
  }

  // Admission is spent locally before any network await. The server's immutable
  // slot and attempts counter enforce the same bound across lost responses/restart.
  admit() {
    const a = this.availability();
    if (this.openAnchor !== null || !a.eligible || !this.pending?.acknowledged
        || this.pending.serial <= this.handledSerial || !Number.isSafeInteger(a.slotAnchorMs)
        || a.slotAnchorMs <= Math.max(0, this.lastAdmittedAnchor, this.lastClosedAnchor)
        || !Number.isFinite(a.dueAtMs) || a.dueAtMs - this.now() > LOOKAHEAD_MS) return null;
    this.lastAdmittedAnchor = a.slotAnchorMs;
    const binding = {
      version: JOURNAL_PREPARATION_VERSION, slotAnchorMs: a.slotAnchorMs,
      slotKey: hash(`${JOURNAL_PREPARATION_VERSION}:${a.slotAnchorMs}`), cue: copy(this.pending.cue),
    };
    this.slot = { binding, valid: true, ready: null, prepared: false, consumed: false,
      token: Object.freeze({ slotKey: binding.slotKey, cueDigest: binding.cue.digest }) };
    return journalPreparationContext(binding);
  }

  current() {
    const slot = this.slot;
    if (!slot?.valid || slot.consumed) return false;
    const a = this.availability();
    if (!a.eligible || (this.openAnchor === null && a.slotAnchorMs !== slot.binding.slotAnchorMs)
        || (this.openAnchor !== null && this.openAnchor !== slot.binding.slotAnchorMs)
        || !this.pending?.acknowledged || !equal(this.pending.cue, slot.binding.cue)) {
      this.invalidate('INCOMPATIBLE');
      return false;
    }
    return true;
  }

  desiredFingerprint() { return this.current() ? this.slot.binding.slotKey : null; }
  reservation() { return this.current() ? this.slot.token : null; }
  validReservation(token) { return !!token && this.current() && token === this.slot.token; }
  invalidateReady() {
    this.validationEpoch++;
    if (this.slot) this.slot.ready = null;
  }
  invalidate(reason) {
    this.validationEpoch++;
    if (this.slot) { this.slot.valid = false; this.slot.ready = null; this.slot.reason = reason; }
  }

  begin(anchor) {
    this.validationEpoch++;
    this.openAnchor = anchor;
    this.handledSerial = this.serial;
    this.lastClosedAnchor = Math.max(this.lastClosedAnchor, anchor || 0);
    if (this.slot?.binding.slotAnchorMs !== anchor) this.invalidate('WRONG_SLOT');
    // Preserve an already canonically validated READY snapshot. Most ordinary
    // choices are deterministic; demanding new network I/O here would recreate
    // the original readiness race. In-flight pre-opening reads remain fenced.
  }

  finish() {
    if (this.openAnchor !== null) this.invalidate('OPPORTUNITY_CLOSED');
    this.openAnchor = null;
  }

  acceptPrepared(set) {
    if (!this.current() || !equal(set?.journal_preparation, this.slot.binding)
        || set.context_fingerprint !== this.slot.binding.slotKey || set.subject_visitor_id
        || !Number.isFinite(Date.parse(set.expires_at)) || Date.parse(set.expires_at) <= this.now()) return false;
    this.slot.prepared = true;
    // READY remains private before the opportunity. Canonical revalidation has
    // completed at the API boundary; known mutations invalidate this snapshot.
    this.slot.ready = copy(set);
    return true;
  }

  consume({ sourceEventId, generationRef, eligible }) {
    const slot = this.slot;
    if (!eligible || this.openAnchor === null || !this.current() || !slot.ready
        || sourceEventId !== slot.binding.cue.sourceEventId
        || Date.parse(slot.ready.expires_at) <= this.now()) {
      this.invalidate('NOT_READY_OR_ALIGNED');
      return empty('OMITTED');
    }
    const raw = slot.ready.selected_memories;
    const selected = filterMemoriesBeforePrompt(Array.isArray(raw) ? raw : [], { currentVisitorId: null });
    if (!Array.isArray(raw) || selected.length !== raw.length) {
      this.invalidate('INELIGIBLE');
      return empty('INELIGIBLE');
    }
    slot.consumed = true;
    const result = {
      directive: formatAutobiographicalMemory(selected), selected,
      inspection: { status: 'PREPARED', preparedSetId: slot.ready.id,
        contextFingerprint: slot.binding.slotKey, sourceEventId, cueDigest: slot.binding.cue.digest,
        selectedIds: selected.map(m => m.id), insertedIds: selected.map(m => m.id),
        consumedBy: generationRef, expiresAtMs: Date.parse(slot.ready.expires_at) },
      journalPreparation: copy(slot.binding),
    };
    slot.ready = null;
    return result;
  }
}
