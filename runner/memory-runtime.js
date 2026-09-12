// memory-runtime.js - live orchestration around the autobiographical store.
//
// The server performs deterministic, privacy-filtered candidate retrieval. The
// active language model then decides whether zero to three eligible candidates
// belong in the current working context. Memory formation is a separate, bounded
// call run after outward expression; it never edits authoritative world records.

import {
  MEMORY_FORMATION_QUEUE_LIMIT,
  MEMORY_MODEL_BOUNDARIES,
  buildFormationRequest,
  buildSurfacingRequest,
  filterMemoriesBeforePrompt,
  formatAutobiographicalMemory,
  parseFormationResponse,
  parseSurfacingResponse,
} from './autobiographical-memory.js';

export class AutobiographicalMemoryRuntime {
  constructor({ client, generate, makeId, now = () => Date.now() }) {
    this.client = client;
    this.generate = generate;
    this.makeId = makeId;
    this.now = now;
    this.pending = [];
    this.pendingIds = new Set();
    this.working = { directive: '', selected: [], inspection: null };
  }

  queueSource(source) {
    if (!source || !source.sourceId || !source.sourceType) return false;
    const key = `${source.sourceType}:${source.sourceId}`;
    if (this.pendingIds.has(key)) return false;
    if (this.pending.length >= MEMORY_FORMATION_QUEUE_LIMIT) {
      const removed = this.pending.shift();
      if (removed) this.pendingIds.delete(`${removed.sourceType}:${removed.sourceId}`);
    }
    this.pending.push(source);
    this.pendingIds.add(key);
    return true;
  }

  async refreshWorkingContext({
    text = '', tags = [], location = null, currentVisitorId = null,
    senderLabel = null, publicSituation = null, groundedContext = null,
    generationRef = null,
  } = {}) {
    let response;
    try {
      response = await this.client.queryMemories({
        query: { text, tags, location }, visitorId: currentVisitorId, limit: 10,
      });
    } catch (error) {
      this.working = {
        directive: '', selected: [],
        inspection: { status: 'UNAVAILABLE', error: String(error && error.message || error) },
      };
      return this.working;
    }
    const candidates = Array.isArray(response && response.candidates) ? response.candidates : [];
    const surfaced = buildSurfacingRequest(candidates, {
      currentVisitorId, senderLabel, publicSituation, groundedContext,
    });
    let selectedIds = [];
    if (surfaced.candidates.length) {
      try {
        const raw = await this.generate(surfaced.call);
        selectedIds = parseSurfacingResponse(raw, surfaced.candidates);
      } catch {
        selectedIds = [];
      }
    }
    const eligible = filterMemoriesBeforePrompt(candidates, { currentVisitorId });
    const selected = selectedIds
      .map((id) => eligible.find((memory) => memory.id === id))
      .filter(Boolean);
    const insertedIds = selected.map((memory) => memory.id);
    const inspection = {
      status: 'LIVE',
      query: { text: String(text).slice(0, 600), tags, location },
      senderKnown: !!currentVisitorId,
      mechanisms: response && response.retrieval && response.retrieval.mechanisms || [],
      privacyFilter: response && response.retrieval && response.retrieval.privacy_filter || null,
      candidateIds: candidates.map((memory) => memory.id),
      offeredIds: surfaced.candidates.map((memory) => memory.id),
      selectedIds,
      insertedIds,
      selectedReasons: Object.fromEntries(selected.map((memory) => [
        memory.id, Array.isArray(memory.reasons) ? memory.reasons : [],
      ])),
      boundaries: MEMORY_MODEL_BOUNDARIES,
    };
    this.working = {
      directive: formatAutobiographicalMemory(selected), selected, inspection,
    };
    try {
      await this.client.recordMemoryQuery({ generationRef, inspection });
    } catch {
      // Diagnostics must never make outward generation fail.
    }
    return this.working;
  }

  async formNext({ groundedContext = null } = {}) {
    const source = this.pending.shift();
    if (!source) return { status: 'EMPTY' };
    this.pendingIds.delete(`${source.sourceType}:${source.sourceId}`);
    let candidates = [];
    try {
      const response = await this.client.queryMemories({
        query: {
          text: source.text || '', tags: source.tags || [],
          location: source.location || null,
        },
        visitorId: source.subjectVisitorId || null,
        limit: 5,
      });
      candidates = Array.isArray(response && response.candidates) ? response.candidates : [];
      const request = buildFormationRequest(source, candidates, groundedContext);
      const raw = await this.generate(request);
      const operation = parseFormationResponse(raw, {
        source,
        existing: request.candidates.map((candidate) => (
          candidates.find((memory) => memory.id === candidate.id)
        )).filter(Boolean),
        makeId: this.makeId,
      });
      if (!operation.valid || operation.decision === 'NOTHING') {
        return { status: 'NOTHING', sourceType: source.sourceType, sourceId: source.sourceId };
      }
      const result = await this.client.applyMemoryOperations([operation]);
      const scope = operation.privacyScope
        || candidates.find((memory) => memory.id === operation.memoryId)?.privacyScope
        || 'INTERNAL_ONLY';
      const activityText = scope === 'PUBLIC_RECALLABLE'
        ? String(operation.publicSummary || 'An autobiographical memory changed.').slice(0, 600)
        : null;
      try {
        await this.client.recordMemoryActivity({
          memoryId: operation.memoryId,
          activityType: operation.decision === 'CREATE' ? 'MEMORY_FORMED' : 'MEMORY_CHANGED',
          publicText: activityText,
          privacyScope: scope,
          reasonCodes: source.tags || [],
        });
      } catch {
        // Public activity is optional observability, not memory authority.
      }
      return { status: operation.decision, operation, result };
    } catch (error) {
      return {
        status: 'ERROR', sourceType: source.sourceType, sourceId: source.sourceId,
        error: String(error && error.message || error),
      };
    }
  }
}
