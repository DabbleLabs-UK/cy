// Non-publishing production-state probe for the AWG candidate contract.
//
// This script reads a COPY of runner state, acquires the normal shared-Ollama
// lease, generates structured candidates, validates them, and exits. It never
// applies a candidate, writes runner state, or calls the CY ingest API.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  buildAwgCall,
  findNextAwgEligibility,
  materialiseAwgProposal,
  parseAwgCandidate,
  reconcileWorldSimulationState,
  selectAwgGenerationFacts,
  validateAwgCandidate,
} from '../runner/ambient-world-generator.js';
import { CAST, OFFICERS } from '../runner/cast.js';
import {
  CONTEXT_CONSUMERS,
  buildContextPacket,
  createContextItem,
  renderContextPacket,
} from '../runner/context-broker.js';
import { incidentLine } from '../runner/incidents.js';
import { locationContextId } from '../runner/location-regime.js';
import { makeProviders } from '../runner/provider.js';
import { loadVitals } from '../runner/vitals.js';

const statePath = resolve(process.argv[2] || 'runner/state/vitals.json');
const configPath = resolve(process.argv[3] || 'runner/config.json');
const count = Math.max(1, Math.min(8, Number.parseInt(process.argv[4] || '4', 10) || 4));
const config = JSON.parse(await readFile(configPath, 'utf8'));
const vitals = await loadVitals(statePath);
const state = reconcileWorldSimulationState(vitals.worldSimulation);
const location = locationContextId(vitals.locationRegime && vitals.locationRegime.current
  && vitals.locationRegime.current.id) || 'cell';
const plausibleCastIds = [
  ...(location === 'exercise_yard'
    ? CAST.filter((entry) => !['root', 'daemon'].includes(entry.key))
    : CAST),
  ...OFFICERS,
].map((entry) => entry.key);
const capturedAt = Date.now();

const frozenOpportunity = findNextAwgEligibility(state, { fromMs: capturedAt });
if (frozenOpportunity.eligibleAt == null) {
  throw new Error('NO_ELIGIBLE_FROZEN_AWG_OPPORTUNITY_WITHIN_24H');
}
const probeNow = frozenOpportunity.eligibleAt;
const generationFacts = selectAwgGenerationFacts(state, {
  plausibleCastIds, currentLocation: location, nowMs: probeNow,
});

function item(value) {
  return createContextItem({
    provenanceClass: 'WORLD FACT', knowledgeScope: 'WORLD_KNOWS',
    privacyScope: 'WORLD_SIMULATION', priority: 80, ...value,
  });
}

const contextItems = [item({
  id: 'probe:current', sourceId: 'probe:current', section: 'mandatory_current_state',
  mandatory: true, priority: 100,
  content: `Current HMP ThinkPad location: ${location}. Current regime activity: ${vitals.locationRegime && vitals.locationRegime.current && vitals.locationRegime.current.regime_activity || 'unknown'}.`,
}), item({
  id: 'probe:canon', sourceId: 'probe:canon', section: 'world_canon',
  mandatory: true, priority: 100,
  content: 'HMP ThinkPad is a British digital prison. Cy is inmate 7734. Prison-world history is immutable.',
})];

for (const entry of [...CAST, ...OFFICERS].filter((item) => plausibleCastIds.includes(item.key))) {
  contextItems.push(item({
    id: `probe:cast:${entry.key}`, sourceId: `probe:cast:${entry.key}`,
    section: 'cast_context', priority: 90,
    content: `${entry.key}: ${entry.name} - ${entry.blurb}`,
  }));
}
for (const thread of generationFacts.threads) {
  contextItems.push(item({
    id: `probe:thread:${thread.id}`, sourceId: `probe:thread:${thread.id}`,
    section: 'unresolved_threads', priority: 85,
    content: `Open thread ${thread.id}: ${thread.type}. ${thread.summary}. Source events: ${(thread.sourceEventIds || []).join(', ') || 'none recorded'}.`,
  }));
}
for (const object of generationFacts.objects) {
  contextItems.push(item({
    id: `probe:object:${object.id}`, sourceId: `probe:object:${object.id}`,
    section: 'persistent_objects', priority: 70,
    content: `Object ${object.id}: ${object.type}; owner ${object.ownerId || 'unknown'}; holder ${object.holderId || 'none known'}; location ${object.location}; status ${object.status}.`,
  }));
}
const packet = buildContextPacket({
  consumer: CONTEXT_CONSUMERS.AWG,
  items: contextItems,
  generatedAt: new Date(probeNow).toISOString(),
  generationRef: `awg-semantic-probe:${probeNow}`,
});
const contextRendering = renderContextPacket(packet);
const recentEvents = [
  ...state.recentAccepted,
  ...(Array.isArray(vitals.ledger) ? vitals.ledger.slice(-24) : []).map((entry, index) => ({
    id: `ledger:${index}`,
    timestamp: entry.ts || new Date(capturedAt).toISOString(),
    summary: incidentLine(entry),
    participants: [],
  })),
];
const provider = makeProviders(config).ollama;
const results = [];

for (let index = 0; index < count; index++) {
  const attemptNow = probeNow;
  const call = buildAwgCall(contextRendering, {
    state, currentLocation: location, plausibleCastIds, recentEvents, nowMs: attemptNow,
  });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort('PROBE_TIMEOUT'), 5 * 60 * 1000);
  let lease = null;
  const result = {
    probe: index + 1, generated: false, parsed: false, schemaPassed: false,
    semanticPassed: false, decision: null, epistemicClass: null, rejectionReasons: [],
    proposal: null, candidateSummary: null, participants: [], thread: null, objects: [],
  };
  try {
    lease = await provider.acquireSharedLease({ purpose: 'ambient_world_generation_probe', signal: abort.signal });
    const response = await provider.rawGenerate({
      system: call.system,
      prompt: call.prompt,
      format: call.format,
      opts: provider.applySharedProfile(call.options, lease),
      signal: abort.signal,
      purpose: call.purpose,
    });
    if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`);
    result.generated = true;
    const proposal = parseAwgCandidate(response.text);
    result.parsed = true;
    result.proposal = proposal;
    const candidate = materialiseAwgProposal(proposal, state, {
      nowMs: attemptNow, currentLocation: location, plausibleCastIds,
      makeId: (prefix) => `${prefix}-probe-${randomUUID()}`,
    });
    result.schemaPassed = true;
    result.decision = candidate.decision;
    result.candidateSummary = candidate.objective?.summary || null;
    result.participants = candidate.participants || [];
    result.thread = candidate.thread || null;
    result.objects = candidate.objects || [];
    if (candidate.decision === 'NO_EVENT') {
      result.semanticPassed = true;
      result.epistemicClass = 'NO_EVENT';
    } else {
      const validation = validateAwgCandidate(candidate, state, {
        nowMs: attemptNow, currentLocation: location, plausibleCastIds, recentEvents,
      });
      result.semanticPassed = validation.valid;
      result.epistemicClass = validation.cyObserved ? 'OBSERVED' : 'WORLD_ONLY';
      result.rejectionReasons = validation.errors;
    }
  } catch (error) {
    result.rejectionReasons = [String(error && error.message || error)];
  } finally {
    clearTimeout(timer);
    if (lease) await lease.release();
  }
  results.push(result);
}

console.log(JSON.stringify({
  classification: 'NON_PUBLISHING_AWG_SEMANTIC_CONTRACT_PROBE',
  stateSource: dirname(statePath),
  capturedAt: new Date(capturedAt).toISOString(),
  frozenEligibleAt: new Date(probeNow).toISOString(),
  frozenEligibility: frozenOpportunity.eligibility,
  currentLocation: location,
  plausibleCastIds,
  recentEventCount: recentEvents.length,
  continuableThreadIds: generationFacts.threads.map((item) => item.id),
  excludedOpenThreadIds: state.threads.filter((item) => item.state === 'OPEN'
    && !generationFacts.threads.some((thread) => thread.id === item.id)).map((item) => item.id),
  generationObjectIds: generationFacts.objects.map((item) => item.id),
  generationContextSections: packet.sections.map((section) => section.id),
  generated: results.filter((item) => item.generated).length,
  parsed: results.filter((item) => item.parsed).length,
  schemaPassed: results.filter((item) => item.schemaPassed).length,
  semanticPassed: results.filter((item) => item.semanticPassed).length,
  observed: results.filter((item) => item.epistemicClass === 'OBSERVED').length,
  worldOnly: results.filter((item) => item.epistemicClass === 'WORLD_ONLY').length,
  noEvent: results.filter((item) => item.epistemicClass === 'NO_EVENT').length,
  results,
}, null, 2));
