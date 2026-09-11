// current-defensive-context.js - event-driven defensive situation state.
//
// This subsystem joins present structured environmental cues to the grounded
// threat learner while keeping imminence, ambiguity, objective control and
// outcome resolution separate. It does not calculate fear, anxiety, salience
// or any other scalar emotional magnitude.

import {
  THREAT_LEARNING_MODEL_VERSION,
  THREAT_LEARNING_PRIOR,
  THREAT_OUTCOME_CLASSES,
  cuesFromEnvironmentRecord,
  posteriorMean,
  posteriorVariance,
} from './probabilistic-threat-learning.js';
import { contingenciesForContext } from './action-outcome-contingency.js';

export const DEFENSIVE_CONTEXT_SCHEMA = 'cy.current-defensive-context';
export const DEFENSIVE_CONTEXT_VERSION = 1;
export const DEFENSIVE_CONTEXT_MODEL_ID = 'current-defensive-context-dimensional-ontology';
export const DEFENSIVE_CONTEXT_MODEL_VERSION = 'current-defensive-context-v1';
export const DEFENSIVE_CONTEXT_PROVENANCE = 'config/model-specs/current-defensive-context.json';

export const DEFENSIVE_TEMPORAL_STATUSES = Object.freeze([
  'POTENTIAL',
  'IMMINENT',
  'ONGOING',
  'RESOLVED',
  'UNKNOWN',
]);

export const OBJECTIVE_CONTROLLABILITY = Object.freeze([
  'NONE',
  'LIMITED',
  'SUBSTANTIAL',
  'UNKNOWN',
]);

export const WORLD_AMBIGUITY = Object.freeze([
  'CLEAR',
  'PARTIAL',
  'AMBIGUOUS',
  'UNKNOWN',
]);

export const DEFENSIVE_RESOLUTION_STATUSES = Object.freeze([
  'UNRESOLVED',
  'RESOLVED_ADVERSE',
  'RESOLVED_SAFE',
  'UNKNOWN',
]);

const VALID_OUTCOME = new Set(THREAT_OUTCOME_CLASSES);
const VALID_TEMPORAL = new Set(DEFENSIVE_TEMPORAL_STATUSES);
const VALID_CONTROL = new Set(OBJECTIVE_CONTROLLABILITY);
const VALID_AMBIGUITY = new Set(WORLD_AMBIGUITY);
const VALID_RESOLUTION = new Set(DEFENSIVE_RESOLUTION_STATUSES);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function canonicalPart(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function timestampOf(event) {
  return typeof event.timestamp === 'string' && event.timestamp ? event.timestamp : null;
}

function posteriorSnapshot(raw) {
  const alpha = Number.isInteger(raw && raw.alpha) && raw.alpha >= 1
    ? raw.alpha : THREAT_LEARNING_PRIOR.alpha;
  const beta = Number.isInteger(raw && raw.beta) && raw.beta >= 1
    ? raw.beta : THREAT_LEARNING_PRIOR.beta;
  return {
    alpha,
    beta,
    mean: posteriorMean(alpha, beta),
    variance: posteriorVariance(alpha, beta),
    resolvedObservations: alpha + beta - THREAT_LEARNING_PRIOR.alpha - THREAT_LEARNING_PRIOR.beta,
    modelVersion: THREAT_LEARNING_MODEL_VERSION,
  };
}

function explicitOutcomeMap(event) {
  const learning = event.world && event.world.associative_learning;
  const result = new Map();
  for (const outcome of (learning && Array.isArray(learning.outcomes)) ? learning.outcomes : []) {
    if (!outcome || !VALID_OUTCOME.has(outcome.outcome_class)) continue;
    if (!['occurred', 'did_not_occur', 'unknown'].includes(outcome.status)) continue;
    result.set(outcome.outcome_class, outcome.status);
  }
  return result;
}

function explicitDefensiveFacts(event) {
  const facts = event.world && event.world.defensive_context;
  return facts && typeof facts === 'object' ? facts : {};
}

function temporalStatus(event, outcomeStatus) {
  const supplied = String(explicitDefensiveFacts(event).temporal_status || '').toUpperCase();
  if (VALID_TEMPORAL.has(supplied) && supplied !== 'UNKNOWN') return supplied;
  const resolution = event.world && event.world.situation && event.world.situation.resolution_status;
  if (resolution === 'resolved') return 'RESOLVED';
  if (outcomeStatus === 'occurred') return 'ONGOING';
  return 'UNKNOWN';
}

function objectiveControllability(event) {
  const supplied = String(event.world && event.world.situation && event.world.situation.control || '').toUpperCase();
  return VALID_CONTROL.has(supplied) ? supplied : 'UNKNOWN';
}

function worldAmbiguity(record) {
  const certainty = String(record && record.observation && record.observation.certainty || '').toLowerCase();
  if (certainty === 'certain') return 'CLEAR';
  if (certainty === 'probable') return 'PARTIAL';
  if (certainty === 'uncertain') return 'AMBIGUOUS';
  return 'UNKNOWN';
}

function resolutionStatus(event, outcomeStatus) {
  if (outcomeStatus === 'occurred') return 'RESOLVED_ADVERSE';
  if (outcomeStatus === 'did_not_occur') return 'RESOLVED_SAFE';
  const supplied = event.world && event.world.situation && event.world.situation.resolution_status;
  return supplied === 'unresolved' ? 'UNRESOLVED' : 'UNKNOWN';
}

function outcomeClassesFor(event, cues, threatLearning) {
  const classes = new Set();
  const facts = explicitDefensiveFacts(event);
  for (const outcomeClass of Array.isArray(facts.adverse_outcome_classes) ? facts.adverse_outcome_classes : []) {
    if (VALID_OUTCOME.has(outcomeClass)) classes.add(outcomeClass);
  }
  for (const outcomeClass of explicitOutcomeMap(event).keys()) classes.add(outcomeClass);
  for (const cue of cues) {
    for (const outcomeClass of Object.keys((threatLearning && threatLearning.pairs
      && threatLearning.pairs[cue.id]) || {})) {
      if (VALID_OUTCOME.has(outcomeClass)) classes.add(outcomeClass);
    }
  }
  return [...classes];
}

function learnedAssociationsFor(cues, outcomeClass, explicitClass, threatLearning) {
  const associations = [];
  for (const cue of cues) {
    const learned = threatLearning && threatLearning.pairs && threatLearning.pairs[cue.id]
      ? threatLearning.pairs[cue.id][outcomeClass] : null;
    if (!learned && !explicitClass) continue;
    associations.push({
      cueId: cue.id,
      cueType: cue.type,
      outcomeClass,
      posterior: posteriorSnapshot(learned),
      posteriorBasis: learned ? 'EXISTING_GROUNDED_LEARNER_STATE' : 'BETA_1_1_PRIOR_BEFORE_FIRST_RESOLVED_TRIAL',
    });
  }
  return associations;
}

function contextIdentity(event, outcomeClass) {
  const supplied = canonicalPart(explicitDefensiveFacts(event).context_id);
  const eventPart = canonicalPart(event.id) || 'unknown_event';
  const contextId = supplied || `event:${eventPart}`;
  return { contextId, contextKey: `${contextId}|${outcomeClass}` };
}

export function createCurrentDefensiveContext(now = Date.now()) {
  return {
    schema: DEFENSIVE_CONTEXT_SCHEMA,
    version: DEFENSIVE_CONTEXT_VERSION,
    modelId: DEFENSIVE_CONTEXT_MODEL_ID,
    modelVersion: DEFENSIVE_CONTEXT_MODEL_VERSION,
    provenance: DEFENSIVE_CONTEXT_PROVENANCE,
    installedAtMs: now,
    contexts: {},
    history: [],
  };
}

function validContext(raw) {
  return raw && typeof raw === 'object'
    && typeof raw.contextKey === 'string' && raw.contextKey
    && typeof raw.contextId === 'string' && raw.contextId
    && VALID_OUTCOME.has(raw.outcomeClass)
    && VALID_TEMPORAL.has(raw.temporalStatus)
    && VALID_CONTROL.has(raw.objectiveControllability)
    && VALID_AMBIGUITY.has(raw.worldAmbiguity)
    && VALID_RESOLUTION.has(raw.resolutionStatus);
}

export function reconcileCurrentDefensiveContext(raw, { now = Date.now() } = {}) {
  const out = createCurrentDefensiveContext(now);
  if (!raw || raw.schema !== DEFENSIVE_CONTEXT_SCHEMA || raw.version !== DEFENSIVE_CONTEXT_VERSION) return out;
  out.installedAtMs = Number.isFinite(raw.installedAtMs) ? raw.installedAtMs : now;
  for (const [key, context] of Object.entries(raw.contexts || {})) {
    if (!validContext(context) || context.contextKey !== key) continue;
    out.contexts[key] = clone(context);
  }
  out.history = Array.isArray(raw.history) ? raw.history.filter(validContext).map(clone) : [];
  return out;
}

export function contextsFromEnvironmentRecord(state, threatLearning, learnedControllability, record) {
  if (record == null) {
    record = learnedControllability;
    learnedControllability = null;
  }
  const event = record && record.world_event;
  if (!event || !event.world) return [];
  const cues = cuesFromEnvironmentRecord(record);
  if (!cues.length) return [];
  const explicitOutcomes = explicitOutcomeMap(event);
  const outcomeClasses = outcomeClassesFor(event, cues, threatLearning);
  const transitions = [];
  for (const outcomeClass of outcomeClasses) {
    const outcomeStatus = explicitOutcomes.get(outcomeClass) || 'unknown';
    const learnedAssociations = learnedAssociationsFor(
      cues,
      outcomeClass,
      explicitOutcomes.has(outcomeClass) || explicitDefensiveFacts(event).adverse_outcome_classes?.includes(outcomeClass),
      threatLearning,
    );
    if (!learnedAssociations.length) continue;
    const { contextId, contextKey } = contextIdentity(event, outcomeClass);
    const actionFacts = event.world && event.world.action_opportunity;
    const availableActions = actionFacts && Array.isArray(actionFacts.available_actions)
      ? actionFacts.available_actions : [];
    const learnedActionOutcomeContingency = contingenciesForContext(
      learnedControllability,
      contextId,
      availableActions,
    );
    const previous = state && state.contexts ? state.contexts[contextKey] : null;
    const temporal = temporalStatus(event, outcomeStatus);
    const resolution = resolutionStatus(event, outcomeStatus);
    const at = timestampOf(event);
    const sourceEvents = [...new Set([
      ...((previous && previous.sourceEnvironmentEventIds) || []),
      ...((event.world.context && event.world.context.previous_event_ids) || []),
      event.id,
    ].map(String).filter(Boolean))];
    const transition = {
      contextKey,
      contextId,
      outcomeClass,
      openedAt: previous ? previous.openedAt : at,
      updatedAt: at,
      resolvedAt: temporal === 'RESOLVED' ? at : null,
      active: temporal !== 'RESOLVED',
      activeCues: cues.map((cue) => ({ cueId: cue.id, cueType: cue.type, presence: 'PRESENT_EXTERNAL_CUE' })),
      learnedAssociations,
      learnedPosteriorAtOpen: previous ? clone(previous.learnedPosteriorAtOpen) : clone(learnedAssociations),
      worldAmbiguity: worldAmbiguity(record),
      objectiveControllability: objectiveControllability(event),
      perceivedControllability: 'NOT_MODELLED',
      learnedActionOutcomeContingency,
      causalActionOutcomeControl: 'NOT_MODELLED',
      temporalStatus: temporal,
      outcomeStatus,
      resolutionStatus: resolution,
      sourceEnvironmentEventIds: sourceEvents,
      fieldProvenance: {
        activeCues: 'STRUCTURED_WORLD_FACT',
        learnedAssociations: 'GROUNDED_LEARNED_POSTERIOR',
        worldAmbiguity: 'ENGINEERING_ONTOLOGY_FROM_STRUCTURED_OBSERVATION_CERTAINTY',
        objectiveControllability: 'STRUCTURED_WORLD_FACT',
        learnedActionOutcomeContingency: 'GROUNDED_OBSERVATIONAL_CONTINGENCY_POSTERIORS',
        temporalStatus: 'ENGINEERING_ONTOLOGY_FROM_STRUCTURED_WORLD_FACT',
        outcomeStatus: 'STRUCTURED_WORLD_FACT',
        resolutionStatus: 'STRUCTURED_WORLD_FACT',
      },
    };
    transitions.push(transition);
  }
  return transitions;
}

export function observeCurrentDefensiveContextRecord(state, threatLearning, learnedControllability, record) {
  if (record == null) {
    record = learnedControllability;
    learnedControllability = null;
  }
  if (!state || !record) return { updated: false, reason: 'invalid_record', transitions: [] };
  const transitions = contextsFromEnvironmentRecord(state, threatLearning, learnedControllability, record);
  for (const transition of transitions) {
    state.contexts[transition.contextKey] = clone(transition);
    state.history.push(clone(transition));
  }
  return {
    modelId: DEFENSIVE_CONTEXT_MODEL_ID,
    modelVersion: DEFENSIVE_CONTEXT_MODEL_VERSION,
    provenance: DEFENSIVE_CONTEXT_PROVENANCE,
    sourceEnvironmentEventId: record.world_event && record.world_event.id || null,
    updated: transitions.length > 0,
    transitions,
  };
}

function publicAssociation(association) {
  const adverse = association.posterior.alpha - THREAT_LEARNING_PRIOR.alpha;
  const safe = association.posterior.beta - THREAT_LEARNING_PRIOR.beta;
  return {
    cueId: association.cueId,
    cueType: association.cueType,
    outcomeClass: association.outcomeClass,
    evidence: association.posterior.resolvedObservations === 0 ? 'NO_RESOLVED_OBSERVATIONS'
      : adverse > safe ? 'ADVERSE_MORE_OFTEN'
        : safe > adverse ? 'SAFE_MORE_OFTEN' : 'EVENLY_SPLIT',
  };
}

export function currentDefensiveContextInspection(state) {
  const contexts = Object.values((state && state.contexts) || {}).map(clone);
  return {
    status: 'implemented',
    publicLabel: 'LIVE',
    meaning: 'Separate event-driven facts about present external cues, learned adverse-outcome expectations, ambiguity, imminence, objective control and resolution.',
    modelId: DEFENSIVE_CONTEXT_MODEL_ID,
    modelVersion: DEFENSIVE_CONTEXT_MODEL_VERSION,
    provenance: DEFENSIVE_CONTEXT_PROVENANCE,
    activeContexts: contexts.filter((context) => context.active),
    contexts,
    history: clone((state && state.history) || []),
    notModelled: ['anxiety', 'fear intensity', 'salience ranking', 'remembered or imagined cue activation', 'perceived controllability', 'causal action-outcome control', 'brain activation'],
  };
}

export function currentDefensiveContextSnapshot(state) {
  const exact = currentDefensiveContextInspection(state);
  return {
    status: exact.status,
    publicLabel: exact.publicLabel,
    meaning: exact.meaning,
    modelId: exact.modelId,
    modelVersion: exact.modelVersion,
    provenance: exact.provenance,
    activeContexts: exact.activeContexts.map((context) => ({
      outcomeClass: context.outcomeClass,
      activeCues: clone(context.activeCues),
      learnedEvidence: context.learnedAssociations.map(publicAssociation),
      worldAmbiguity: context.worldAmbiguity,
      objectiveControllability: context.objectiveControllability,
      perceivedControllability: context.perceivedControllability,
      learnedActionOutcomeContingency: clone(context.learnedActionOutcomeContingency || []),
      causalActionOutcomeControl: context.causalActionOutcomeControl,
      temporalStatus: context.temporalStatus,
      outcomeStatus: context.outcomeStatus,
      resolutionStatus: context.resolutionStatus,
    })),
    notModelled: exact.notModelled,
  };
}
