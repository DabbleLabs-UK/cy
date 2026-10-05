// Durable, asynchronous orchestration around the autobiographical store.
//
// The server owns the formation and surfacing queues. The runner performs at
// most one background model call at a time and foreground work may abort it.
// Journalling never awaits memory. Postcard optional enrichment waits briefly
// for a compatible set; postcard-memory.js separately requires canonical sender
// continuity without waiting for this background model selector.

import { createHash } from 'node:crypto';

import {
  MEMORY_MODEL_BOUNDARIES,
  buildFormationRequest,
  buildSurfacingRequest,
  filterMemoriesBeforePrompt,
  formatAutobiographicalMemory,
  parseFormationResponse,
  parseSurfacingDecision,
  sanitizeCyExpressionSource,
} from './autobiographical-memory.js';
import { sanitizeCharacterContext } from './warden.js';

const PREPARED_TTL_MS = 15 * 60 * 1000;
const BACKGROUND_TIMEOUT_MS = 120000;
const RETRY_DELAY_SECONDS = 30;
const SENDER_FORMATION_MIN_AGE_SECONDS = 120;
const SENDER_RESERVED_INTERVAL_MS = 10 * 60 * 1000;

function stableContext(value = {}) {
  return {
    text: String(value.text || '').trim().slice(0, 600),
    tags: [...new Set((Array.isArray(value.tags) ? value.tags : [])
      .map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))].sort(),
    location: value.location ? String(value.location).trim().toLowerCase() : null,
    currentVisitorId: value.currentVisitorId || null,
    publicSituation: String(value.publicSituation || '').trim().slice(0, 600),
    groundedContext: String(value.groundedContext || '').trim().slice(0, 4000),
    senderLabel: value.senderLabel ? String(value.senderLabel).slice(0, 120) : null,
    generationRef: value.generationRef ? String(value.generationRef).slice(0, 96) : null,
    // Retrieval-cue provenance only (see autobiographical_memory.php's doc
    // comment on captive_memory_rank_candidates). Deliberately excluded from
    // memoryContextFingerprint's identity below: neither field changes what
    // is fetched, ranked or selected, so including them would only fragment
    // prepared-set caching for no behavioural benefit.
    querySourceType: value.querySourceType ? String(value.querySourceType).slice(0, 32) : null,
    recentExpressionText: sanitizeCharacterContext(value.recentExpressionText).trim().slice(0, 2000),
  };
}

export function memoryContextFingerprint(value = {}) {
  const context = stableContext(value);
  const identity = {
    text: context.text,
    tags: context.tags,
    location: context.location,
    currentVisitorId: context.currentVisitorId,
    publicSituation: context.publicSituation,
    groundedContext: context.groundedContext,
  };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function promptChars(call) {
  return String(call && call.system || '').length + String(call && call.prompt || '').length;
}

function errorText(error) {
  return String(error && error.message || error || 'unknown error').slice(0, 1000);
}

function isAbort(error) {
  return !!error && (error.name === 'AbortError' || /abort/i.test(errorText(error)));
}

export class AutobiographicalMemoryRuntime {
  constructor({
    client, generate, makeId, now = () => Date.now(), contextBroker = null,
    canRunBackground = () => true, providerInfo = () => ({}),
    backgroundWaitMs = () => 250,
    backgroundTimeoutMs = BACKGROUND_TIMEOUT_MS,
  }) {
    this.client = client;
    this.generate = generate;
    this.makeId = makeId;
    this.now = now;
    this.contextBroker = contextBroker;
    this.canRunBackground = canRunBackground;
    this.backgroundWaitMs = backgroundWaitMs;
    this.providerInfo = providerInfo;
    this.backgroundTimeoutMs = backgroundTimeoutMs;
    this.working = { directive: '', selected: [], inspection: null };
    this.desired = null;
    // Provenance only: the ids explicitly inserted into the most recently
    // CONSUMED (i.e. actually used in a model generation) working set, so the
    // next surfacing query can record which of its candidates were also
    // inserted into the immediately preceding generation context. Never read
    // by anything that fetches/ranks/selects/inserts memories.
    this.lastConsumed = { generationRef: null, insertedIds: [] };
    this.busy = false;
    // Start conservatively: the durable server queues have not been inspected
    // yet, so lower-priority world generation must wait for the first poll.
    this.priorityPending = true;
    this.pendingSourceWrites = 0;
    this.activeAbort = null;
    this.interruptReason = null;
    this.timer = null;
    this.stopped = true;
    this.lastReservedSenderAt = 0;
    this.activeSenderFormation = null;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(25);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.interruptBackground('shutdown');
  }

  schedule(delay = 250) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delay);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  interruptBackground(reason = 'foreground') {
    this.interruptReason = reason;
    if (this.activeAbort) this.activeAbort.abort();
  }

  async queueSource(source) {
    source = sanitizeCyExpressionSource(source);
    if (!source || !source.sourceId || !source.sourceType) return { queued: false };
    this.pendingSourceWrites += 1;
    this.priorityPending = true;
    try {
      const result = await this.client.enqueueMemorySource(source);
      this.schedule(10);
      return result;
    } finally {
      this.pendingSourceWrites = Math.max(0, this.pendingSourceWrites - 1);
    }
  }

  hasPriorityWork() {
    return this.busy || this.priorityPending || this.pendingSourceWrites > 0;
  }

  async requestWorkingContext(value = {}, {
    deadlineMs = 0, priority = 80, scheduleDelayMs = 0,
  } = {}) {
    const started = this.now();
    const context = stableContext(value);
    const fingerprint = memoryContextFingerprint(context);
    this.desired = { fingerprint, visitorId: context.currentVisitorId, generationRef: context.generationRef };
    if (!this.compatibleWorking(fingerprint, context.currentVisitorId)) this.clearWorking('PENDING');
    const prepare = (async () => {
      try {
        const cached = await this.client.getPreparedMemorySet({
          contextFingerprint: fingerprint,
          visitorId: context.currentVisitorId,
        });
        // An optional foreground wait may expire while this read is pending.
        // Never let that older request replace a newer sender's working set.
        if (this.desired?.fingerprint !== fingerprint
            || (this.desired?.visitorId || null) !== (context.currentVisitorId || null)) return;
        if (cached && cached.prepared_set) this.activatePrepared(cached.prepared_set, context);
        if (!this.compatibleWorking(fingerprint, context.currentVisitorId)) {
          this.priorityPending = true;
          await this.client.enqueueMemorySurfacing({
            context_fingerprint: fingerprint,
            visitor_id: context.currentVisitorId,
            context,
            priority,
          });
          const requestedDelay = Number(scheduleDelayMs);
          this.schedule(Number.isFinite(requestedDelay) ? Math.max(0, requestedDelay) : 0);
        }
      } catch (error) {
        if (this.desired && this.desired.fingerprint === fingerprint) {
          this.clearWorking('UNAVAILABLE', errorText(error));
        }
      }
    })();
    if (deadlineMs > 0) {
      const remaining = Math.max(0, started + deadlineMs - this.now());
      await Promise.race([
        prepare,
        new Promise((resolve) => setTimeout(resolve, remaining)),
      ]);
    } else {
      await prepare;
    }
    if (deadlineMs > 0 && !this.compatibleWorking(fingerprint, context.currentVisitorId)) {
      const deadline = started + deadlineMs;
      while (this.now() < deadline && !this.compatibleWorking(fingerprint, context.currentVisitorId)) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - this.now()))));
      }
    }
    return this.compatibleWorking(fingerprint, context.currentVisitorId)
      ? this.working : { directive: '', selected: [], inspection: { status: 'DEADLINE_EXPIRED' } };
  }

  refreshWorkingContext(value = {}) {
    return this.requestWorkingContext(value);
  }

  compatibleWorking(fingerprint, visitorId) {
    const inspection = this.working && this.working.inspection;
    if (!inspection || inspection.contextFingerprint !== fingerprint) return false;
    return (inspection.subjectVisitorId || null) === (visitorId || null)
      && (!inspection.expiresAtMs || inspection.expiresAtMs > this.now());
  }

  clearWorking(status, error = null) {
    this.working = { directive: '', selected: [], inspection: { status, error } };
  }

  activatePrepared(set, context = {}) {
    const selected = filterMemoriesBeforePrompt(set.selected_memories || set.selectedMemories || [], {
      currentVisitorId: context.currentVisitorId || set.subject_visitor_id || null,
    });
    const preparedAt = Date.parse(set.prepared_at || '') || this.now();
    this.working = {
      directive: formatAutobiographicalMemory(selected),
      selected,
      inspection: {
        status: 'PREPARED', preparedSetId: set.id,
        contextFingerprint: set.context_fingerprint || memoryContextFingerprint(context),
        subjectVisitorId: set.subject_visitor_id || null,
        selectedIds: selected.map((memory) => memory.id),
        insertedIds: selected.map((memory) => memory.id),
        expiresAtMs: Date.parse(set.expires_at || '') || preparedAt + PREPARED_TTL_MS,
        provider: set.provider || null, model: set.model || null,
        boundaries: MEMORY_MODEL_BOUNDARIES,
      },
    };
  }

  consumeWorking(generationRef, currentVisitorId = null) {
    const inspection = this.working && this.working.inspection;
    if (!inspection || inspection.status !== 'PREPARED') return this.working;
    if ((inspection.subjectVisitorId || null) !== (currentVisitorId || null)) {
      this.clearWorking('SENDER_MISMATCH');
      return this.working;
    }
    inspection.consumedBy = generationRef || null;
    this.lastConsumed = {
      generationRef: generationRef || null,
      insertedIds: Array.isArray(inspection.insertedIds) ? [...inspection.insertedIds] : [],
    };
    void this.client.consumePreparedMemorySet({
      preparedSetId: inspection.preparedSetId,
      generationRef,
      visitorId: currentVisitorId,
    }).catch(() => {});
    return this.working;
  }

  async tick() {
    if (this.stopped || this.busy) return;
    if (!this.canRunBackground('surfacing') && !this.canRunBackground('sender_formation')) {
      // A tempo reservation can be minutes long. Polling it four times a second
      // adds no value and makes a supposedly quiet interval needlessly busy.
      const requested = Number(this.backgroundWaitMs('surfacing'));
      this.schedule(Number.isFinite(requested)
        ? Math.max(250, Math.min(requested, 10000)) : 250);
      return;
    }
    this.busy = true;
    let didWork = false;
    let checkedFormation = false;
    try {
      if (typeof this.client.drainMemorySourceQueue === 'function') {
        await this.client.drainMemorySourceQueue();
      }
      // An aged sender source gets first refusal on each available background
      // slot. The optional surfacing queue can be perpetually replenished and
      // must not prevent durable correspondence from forming memory.
      if (this.canRunBackground('sender_formation')) {
        const sender = await this.client.claimMemorySource({
          senderOnly: true, minAgeSeconds: SENDER_FORMATION_MIN_AGE_SECONDS,
        });
        checkedFormation = true;
        if (sender && sender.job) {
          didWork = true;
          const formation = this.processFormation(sender.job, sender.depth || 0);
          this.activeSenderFormation = formation;
          try {
            await formation;
          } finally {
            if (this.activeSenderFormation === formation) this.activeSenderFormation = null;
          }
        }
      }
      if (!didWork && this.canRunBackground('surfacing')) {
        const surfacing = await this.client.claimMemorySurfacing();
        if (surfacing && surfacing.job) {
          didWork = true;
          await this.processSurfacing(surfacing.job);
        }
      }
      if (!didWork && this.canRunBackground('formation')) {
        const formation = await this.client.claimMemorySource();
        checkedFormation = true;
        if (formation && formation.job) {
          didWork = true;
          await this.processFormation(formation.job, formation.depth || 0);
        }
      }
    } catch {
      // Durable server rows remain pending or are recovered as retryable.
    } finally {
      this.busy = false;
      // A completed job may reveal another ready or retryable row only on the
      // next claim, so retain priority for the immediate follow-up poll. When
      // both queues have been checked empty, AWG may use a later idle window.
      this.priorityPending = didWork
        || !checkedFormation
        || this.pendingSourceWrites > 0;
      this.activeAbort = null;
      this.interruptReason = null;
      this.schedule(didWork ? 25 : 2000);
    }
  }

  // A waking opportunity reserves at most one aged sender job per interval.
  // This supplies a bounded turn even when visible expression would otherwise
  // take every model slot. Incoming interactive work may still abort it.
  async serviceAgedSenderBeforeExpression() {
    if (this.stopped) return { status: 'DEFERRED' };
    if (this.lastReservedSenderAt && this.now() - this.lastReservedSenderAt < SENDER_RESERVED_INTERVAL_MS) {
      return { status: 'NOT_DUE' };
    }
    // The normal background tick may have already claimed a sender job. In
    // that case the waking opportunity is its reserved turn: wait for the
    // bounded in-flight work instead of preempting it and claiming nothing.
    if (this.activeSenderFormation) {
      this.lastReservedSenderAt = this.now();
      return this.activeSenderFormation;
    }
    if (this.busy || !this.canRunBackground('sender_formation')) return { status: 'DEFERRED' };
    this.busy = true;
    try {
      if (typeof this.client.drainMemorySourceQueue === 'function') await this.client.drainMemorySourceQueue();
      const response = await this.client.claimMemorySource({
        senderOnly: true, minAgeSeconds: SENDER_FORMATION_MIN_AGE_SECONDS,
      });
      if (!response?.job) return { status: 'EMPTY' };
      this.lastReservedSenderAt = this.now();
      const result = await this.processFormation(response.job, response.depth || 0);
      this.priorityPending = true;
      return result;
    } finally {
      this.busy = false;
      this.activeAbort = null;
      this.interruptReason = null;
      this.schedule(25);
    }
  }

  async backgroundGenerate(call) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.backgroundTimeoutMs);
    this.activeAbort = controller;
    try {
      return await this.generate({ ...call, signal: controller.signal, background: true });
    } finally {
      clearTimeout(timer);
      if (this.activeAbort === controller) this.activeAbort = null;
    }
  }

  broker(consumer, options, fallback) {
    if (typeof this.contextBroker !== 'function') return fallback;
    const result = this.contextBroker({ consumer, ...options });
    return result && result.rendering || fallback;
  }

  async processSurfacing(job) {
    const started = this.now();
    const context = stableContext(job.context || {});
    const provider = this.providerInfo() || {};
    let call = null;
    let candidates = [];
    let selected = [];
    let privacyRemovedCount = 0;
    let category = 'ERROR';
    let error = null;
    try {
      const response = await this.client.queryMemories({
        query: { text: context.text, tags: context.tags, location: context.location },
        visitorId: job.subject_visitor_id || null,
        limit: 10,
        recentExpressionText: context.recentExpressionText,
        querySourceType: context.querySourceType,
      });
      candidates = Array.isArray(response && response.candidates) ? response.candidates : [];
      const grounded = this.broker('MEMORY_SURFACING', {
        generationRef: context.generationRef || `memory-surfacing:${this.now()}`,
        currentSenderId: job.subject_visitor_id || null,
        currentPostcard: context.publicSituation || context.text,
        groundedContext: context.groundedContext,
        memoryCandidates: candidates,
        fallback: context.groundedContext,
        databaseQueries: 1,
      }, context.groundedContext);
      const request = buildSurfacingRequest(candidates, {
        currentVisitorId: job.subject_visitor_id || null,
        senderLabel: context.senderLabel,
        publicSituation: context.publicSituation,
        groundedContext: grounded,
      });
      call = request.call;
      if (!request.candidates.length) category = 'NO_CANDIDATES';
      else {
        const raw = await this.backgroundGenerate(request.call);
        const decision = parseSurfacingDecision(raw, request.candidates);
        if (!decision.valid) {
          category = 'INVALID';
          error = 'invalid memory surfacing response';
          throw new Error(error);
        }
        const selectedIds = decision.ids;
        const eligible = filterMemoriesBeforePrompt(candidates, {
          currentVisitorId: job.subject_visitor_id || null,
        });
        privacyRemovedCount = Math.max(0, candidates.length - eligible.length);
        selected = selectedIds.map((id) => eligible.find((memory) => memory.id === id)).filter(Boolean);
        category = 'PREPARED';
      }
    } catch (caught) {
      error = errorText(caught);
      if (category !== 'INVALID') {
        category = isAbort(caught) ? (this.interruptReason ? 'PREEMPTED' : 'TIMEOUT') : 'ERROR';
      }
    }
    const setId = this.makeId();
    await this.client.completeMemorySurfacing({
      job_id: Number(job.id), prepared_set_id: setId,
      result_category: category, selected_memories: selected,
      candidate_ids: candidates.map((memory) => memory.id), privacy_removed_count: privacyRemovedCount,
      generation_ref: context.generationRef, provider: provider.id || provider.provider,
      model: provider.model, prompt_chars: promptChars(call), latency_ms: this.now() - started,
      retry_delay_seconds: RETRY_DELAY_SECONDS, error,
    });
    if (category === 'PREPARED' || category === 'NO_CANDIDATES') {
      // Provenance only, from here to the end of this block: none of it is
      // read back into fetching/ranking/selection/insertion above. It exists
      // solely so the owner-gated query ledger (recordMemoryQuery) can answer,
      // per candidate, which terms/tags matched and whether that match
      // independently overlaps Cy's own recent-expression buffer, plus
      // whether the candidate repeats the immediately preceding generation.
      const previouslyInsertedIds = this.lastConsumed.insertedIds || [];
      const candidateProvenance = Object.fromEntries(candidates.map((memory) => [memory.id, {
        matchedTags: memory.matchedTags || [],
        matchedTerms: memory.matchedTerms || [],
        matchProvenance: memory.matchProvenance || {},
        repeatedFromPreviousGeneration: previouslyInsertedIds.includes(memory.id),
      }]));
      const repeatedFromPreviousGenerationIds = candidates
        .map((memory) => memory.id)
        .filter((id) => previouslyInsertedIds.includes(id));
      const inspection = {
        status: 'LIVE', query: { text: context.text, tags: context.tags, location: context.location },
        querySourceType: context.querySourceType || null,
        senderKnown: !!job.subject_visitor_id, mechanisms: [], privacyFilter: 'APPLIED BEFORE RESPONSE',
        candidateIds: candidates.map((memory) => memory.id), offeredIds: candidates.map((memory) => memory.id),
        selectedIds: selected.map((memory) => memory.id), insertedIds: selected.map((memory) => memory.id),
        selectedReasons: Object.fromEntries(selected.map((memory) => [memory.id, memory.reasons || []])),
        candidateProvenance, repeatedFromPreviousGenerationIds,
        boundaries: MEMORY_MODEL_BOUNDARIES,
      };
      await this.client.recordMemoryQuery({ generationRef: context.generationRef, inspection }).catch(() => {});
      if (this.desired && this.desired.fingerprint === job.context_fingerprint
          && (this.desired.visitorId || null) === (job.subject_visitor_id || null)) {
        this.activatePrepared({
          id: setId, context_fingerprint: job.context_fingerprint,
          subject_visitor_id: job.subject_visitor_id || null,
          selected_memories: selected, provider: provider.id || provider.provider,
          model: provider.model, prepared_at: new Date(this.now()).toISOString(),
          expires_at: new Date(this.now() + PREPARED_TTL_MS).toISOString(),
        }, context);
      }
    }
  }

  async processFormation(job, queueDepthBefore = 0) {
    const source = sanitizeCyExpressionSource(job.source || {});
    const started = this.now();
    const provider = this.providerInfo() || {};
    if (!source) {
      await this.client.finishMemorySource({
        job_id: Number(job.id), claim_token: job.claim_token,
        result_category: 'NOTHING', operations: [],
        provider: provider.id || provider.provider, model: provider.model,
        prompt_chars: 0, latency_ms: this.now() - started,
        queue_depth_before: Number(queueDepthBefore) || 0,
        retry_delay_seconds: RETRY_DELAY_SECONDS, error: null,
      });
      return { status: 'NOTHING', memoryId: null };
    }
    let call = null;
    let category = 'ERROR';
    let memoryId = null;
    let error = null;
    let operations = [];
    try {
      const response = await this.client.queryMemories({
        query: { text: source.text || '', tags: source.tags || [], location: source.location || null },
        visitorId: source.subjectVisitorId || null,
        limit: 5,
      });
      const candidates = Array.isArray(response && response.candidates) ? response.candidates : [];
      const grounded = this.broker('MEMORY_FORMATION', {
        generationRef: `memory-formation:${source.sourceType}:${source.sourceId}`,
        currentSenderId: source.subjectVisitorId || null,
        provenanceSource: source, groundedContext: null,
        memoryCandidates: candidates, fallback: '', databaseQueries: 1,
      }, null);
      const request = buildFormationRequest(source, candidates, grounded);
      call = request;
      const raw = await this.backgroundGenerate(request);
      const operation = parseFormationResponse(raw, {
        source,
        existing: request.candidates.map((candidate) => candidates.find((memory) => memory.id === candidate.id)).filter(Boolean),
        makeId: this.makeId,
      });
      if (!operation.valid) category = 'INVALID';
      else if (operation.decision === 'NOTHING') category = 'NOTHING';
      else {
        category = operation.decision === 'ARCHIVE' ? 'RESOLVE' : operation.decision;
        memoryId = operation.memoryId;
        operations = [operation];
      }
    } catch (caught) {
      error = errorText(caught);
      if (/409|version conflict/i.test(error)) category = 'CONFLICT';
      else category = isAbort(caught) ? (this.interruptReason ? 'PREEMPTED' : 'TIMEOUT') : 'ERROR';
    }
    const completion = {
      job_id: Number(job.id), claim_token: job.claim_token,
      result_category: category, operations, memory_id: memoryId,
      provider: provider.id || provider.provider, model: provider.model,
      prompt_chars: promptChars(call), latency_ms: this.now() - started,
      queue_depth_before: Number(queueDepthBefore) || 0,
      retry_delay_seconds: RETRY_DELAY_SECONDS, error,
    };
    let completed;
    try {
      completed = await this.client.finishMemorySource(completion);
    } catch (caught) {
      // The atomic apply may have committed while its HTTP response was lost.
      // Reusing the claim token returns that receipt; a real conflict instead
      // records a retryable attempt rather than waiting for stale-claim recovery.
      const failure = errorText(caught);
      category = /409|version conflict/i.test(failure) ? 'CONFLICT'
        : /422/i.test(failure) ? 'INVALID' : 'ERROR';
      completed = await this.client.finishMemorySource({
        ...completion, result_category: category, operations: [], memory_id: null, error: failure,
      });
    }
    category = completed?.result_category || category;
    memoryId = completed?.results?.[0]?.memory_id || memoryId;
    if (completed?.status === 'FAILED') console.warn(`[cy-memory] ${source.sourceType} formation reached terminal failure`);
    else if (category !== 'NOTHING') console.log(`[cy-memory] ${source.sourceType} formation ${category}`);
    return { status: category, memoryId };
  }

  async formNext() {
    this.schedule(0);
    return { status: 'DEFERRED_TO_BACKGROUND' };
  }
}
