// Durable, asynchronous orchestration around the autobiographical store.
//
// The server owns the formation and surfacing queues. The runner performs at
// most one background model call at a time and foreground work may abort it.
// Journalling never awaits memory. A postcard may wait only for a short fixed
// deadline, then continues without memory if no compatible set is ready.

import { createHash } from 'node:crypto';

import {
  MEMORY_MODEL_BOUNDARIES,
  buildFormationRequest,
  buildSurfacingRequest,
  filterMemoriesBeforePrompt,
  formatAutobiographicalMemory,
  parseFormationResponse,
  parseSurfacingDecision,
} from './autobiographical-memory.js';

const PREPARED_TTL_MS = 15 * 60 * 1000;
const BACKGROUND_TIMEOUT_MS = 120000;
const RETRY_DELAY_SECONDS = 30;

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
    backgroundTimeoutMs = BACKGROUND_TIMEOUT_MS,
  }) {
    this.client = client;
    this.generate = generate;
    this.makeId = makeId;
    this.now = now;
    this.contextBroker = contextBroker;
    this.canRunBackground = canRunBackground;
    this.providerInfo = providerInfo;
    this.backgroundTimeoutMs = backgroundTimeoutMs;
    this.working = { directive: '', selected: [], inspection: null };
    this.desired = null;
    this.busy = false;
    this.activeAbort = null;
    this.interruptReason = null;
    this.timer = null;
    this.stopped = true;
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
    if (!source || !source.sourceId || !source.sourceType) return { queued: false };
    const result = await this.client.enqueueMemorySource(source);
    this.schedule(10);
    return result;
  }

  async requestWorkingContext(value = {}, { deadlineMs = 0, priority = 80 } = {}) {
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
        if (cached && cached.prepared_set) this.activatePrepared(cached.prepared_set, context);
        if (!this.compatibleWorking(fingerprint, context.currentVisitorId)) {
          await this.client.enqueueMemorySurfacing({
            context_fingerprint: fingerprint,
            visitor_id: context.currentVisitorId,
            context,
            priority,
          });
          this.schedule(0);
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
    void this.client.consumePreparedMemorySet({
      preparedSetId: inspection.preparedSetId,
      generationRef,
      visitorId: currentVisitorId,
    }).catch(() => {});
    return this.working;
  }

  async tick() {
    if (this.stopped || this.busy) return;
    if (!this.canRunBackground('surfacing')) {
      this.schedule(250);
      return;
    }
    this.busy = true;
    let didWork = false;
    try {
      if (typeof this.client.drainMemorySourceQueue === 'function') {
        await this.client.drainMemorySourceQueue();
      }
      const surfacing = await this.client.claimMemorySurfacing();
      if (surfacing && surfacing.job) {
        didWork = true;
        await this.processSurfacing(surfacing.job);
      }
      else if (this.canRunBackground('formation')) {
        const formation = await this.client.claimMemorySource();
        if (formation && formation.job) {
          didWork = true;
          await this.processFormation(formation.job, formation.depth || 0);
        }
      }
    } catch {
      // Durable server rows remain pending or are recovered as retryable.
    } finally {
      this.busy = false;
      this.activeAbort = null;
      this.interruptReason = null;
      this.schedule(didWork ? 25 : 2000);
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
      const inspection = {
        status: 'LIVE', query: { text: context.text, tags: context.tags, location: context.location },
        senderKnown: !!job.subject_visitor_id, mechanisms: [], privacyFilter: 'APPLIED BEFORE RESPONSE',
        candidateIds: candidates.map((memory) => memory.id), offeredIds: candidates.map((memory) => memory.id),
        selectedIds: selected.map((memory) => memory.id), insertedIds: selected.map((memory) => memory.id),
        selectedReasons: Object.fromEntries(selected.map((memory) => [memory.id, memory.reasons || []])),
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
    const source = job.source || {};
    const started = this.now();
    const provider = this.providerInfo() || {};
    let call = null;
    let category = 'ERROR';
    let memoryId = null;
    let error = null;
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
        await this.client.applyMemoryOperations([operation]);
        category = operation.decision;
        memoryId = operation.memoryId;
        const scope = operation.privacyScope
          || candidates.find((memory) => memory.id === operation.memoryId)?.privacyScope
          || 'INTERNAL_ONLY';
        await this.client.recordMemoryActivity({
          memoryId: operation.memoryId,
          activityType: operation.decision === 'CREATE' ? 'MEMORY_FORMED' : 'MEMORY_CHANGED',
          publicText: scope === 'PUBLIC_RECALLABLE'
            ? String(operation.publicSummary || 'An autobiographical memory changed.').slice(0, 600) : null,
          privacyScope: scope, reasonCodes: source.tags || [],
        }).catch(() => {});
      }
    } catch (caught) {
      error = errorText(caught);
      if (/409|version conflict/i.test(error)) category = 'CONFLICT';
      else category = isAbort(caught) ? (this.interruptReason ? 'PREEMPTED' : 'TIMEOUT') : 'ERROR';
    }
    await this.client.completeMemorySource({
      job_id: Number(job.id), result_category: category, memory_id: memoryId,
      provider: provider.id || provider.provider, model: provider.model,
      prompt_chars: promptChars(call), latency_ms: this.now() - started,
      queue_depth_before: Number(queueDepthBefore) || 0,
      retry_delay_seconds: RETRY_DELAY_SECONDS, error,
    });
    return { status: category, memoryId };
  }

  async formNext() {
    this.schedule(0);
    return { status: 'DEFERRED_TO_BACKGROUND' };
  }
}
