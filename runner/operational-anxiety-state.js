// operational-anxiety-state.js - categorical threat anticipation for the public Soma view.
//
// This is a read-only projection of the existing current-defensive-context state.
// It introduces no probability threshold, score, decay, baseline, weighting or
// second threat system. Learned cue-outcome uncertainty, world ambiguity, timing
// and objective control remain separate fields.

import { THREAT_LEARNING_PRIOR } from './probabilistic-threat-learning.js';

export const OPERATIONAL_ANXIETY_SCHEMA = 'cy.operational-anxiety-state';
export const OPERATIONAL_ANXIETY_VERSION = 1;
export const OPERATIONAL_ANXIETY_MODEL_ID = 'operational-threat-anticipation-state';
export const OPERATIONAL_ANXIETY_MODEL_VERSION = 'operational-anxiety-state-v1';
export const OPERATIONAL_ANXIETY_PROVENANCE = 'config/model-specs/operational-anxiety-state.json';

export const OPERATIONAL_ANXIETY_STATES = Object.freeze([
  'QUIET',
  'ANTICIPATING',
  'THREAT_IMMINENT',
  'THREAT_ONGOING',
  'UNKNOWN',
]);

const PRIORITY = Object.freeze({
  UNKNOWN: 0,
  QUIET: 1,
  ANTICIPATING: 2,
  THREAT_IMMINENT: 3,
  THREAT_ONGOING: 4,
});

function stateForContext(context) {
  if (!context || !context.active) return 'QUIET';
  if (context.temporalStatus === 'ONGOING') return 'THREAT_ONGOING';
  if (context.temporalStatus === 'IMMINENT') return 'THREAT_IMMINENT';
  if (context.temporalStatus === 'POTENTIAL' || context.temporalStatus === 'UNKNOWN') {
    return 'ANTICIPATING';
  }
  return 'UNKNOWN';
}

function learnedEvidence(association) {
  const posterior = association && association.posterior;
  if (!posterior) return { status: 'UNKNOWN' };
  const resolvedObservations = Number.isInteger(posterior.resolvedObservations)
    ? posterior.resolvedObservations
    : posterior.alpha + posterior.beta - THREAT_LEARNING_PRIOR.alpha - THREAT_LEARNING_PRIOR.beta;
  if (resolvedObservations === 0) {
    return {
      status: 'NO_RESOLVED_LEARNING_HISTORY',
      prior: { ...THREAT_LEARNING_PRIOR },
      resolvedObservations: 0,
    };
  }
  return {
    status: 'LEARNED_HISTORY_AVAILABLE',
    posterior: {
      alpha: posterior.alpha,
      beta: posterior.beta,
      mean: posterior.mean,
      variance: posterior.variance,
      resolvedObservations,
      outcomesOccurred: posterior.alpha - THREAT_LEARNING_PRIOR.alpha,
      outcomesDidNotOccur: posterior.beta - THREAT_LEARNING_PRIOR.beta,
    },
  };
}

function publicCue(cue) {
  return {
    type: cue && cue.cueType || 'unknown',
    label: String(cue && cue.cueId || '').replace(/^[^:]+:/, '').replaceAll('_', ' ') || 'unknown cue',
    presence: cue && cue.presence || 'UNKNOWN',
  };
}

function concern(context) {
  const associations = (context.learnedAssociations || []).map((association) => ({
    cue: publicCue({ cueId: association.cueId, cueType: association.cueType, presence: 'PRESENT_EXTERNAL_CUE' }),
    outcomeClass: association.outcomeClass,
    evidence: learnedEvidence(association),
  }));
  return {
    outcomeClass: context.outcomeClass,
    state: stateForContext(context),
    openedAt: context.openedAt,
    updatedAt: context.updatedAt,
    activeCues: (context.activeCues || []).map(publicCue),
    learnedCueOutcomeEvidence: associations,
    worldAmbiguity: context.worldAmbiguity,
    temporalStatus: context.temporalStatus,
    temporalPredictability: ['IMMINENT', 'ONGOING'].includes(context.temporalStatus)
      ? 'SPECIFIC_STRUCTURED_TIMING'
      : context.temporalStatus === 'POTENTIAL'
        ? 'TEMPORALLY_UNCERTAIN'
        : 'UNKNOWN',
    temporalHazard: {
      status: 'NOT_AVAILABLE',
      reason: 'NO_EVENT_TIME_DISTRIBUTION',
    },
    objectiveControllability: context.objectiveControllability,
    outcomeStatus: context.outcomeStatus,
    resolutionStatus: context.resolutionStatus,
  };
}

function compareConcern(left, right) {
  const priority = PRIORITY[right.state] - PRIORITY[left.state];
  if (priority) return priority;
  const updated = String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
  if (updated) return updated;
  return String(left.outcomeClass || '').localeCompare(String(right.outcomeClass || ''));
}

export function operationalAnxietySnapshot(currentDefensiveContext) {
  if (!currentDefensiveContext || !currentDefensiveContext.contexts) {
    return {
      schema: OPERATIONAL_ANXIETY_SCHEMA,
      version: OPERATIONAL_ANXIETY_VERSION,
      modelId: OPERATIONAL_ANXIETY_MODEL_ID,
      modelVersion: OPERATIONAL_ANXIETY_MODEL_VERSION,
      provenance: OPERATIONAL_ANXIETY_PROVENANCE,
      status: 'UNKNOWN',
      publicLabel: 'LIVE',
      currentConcern: null,
      activeConcerns: [],
      temporalHazard: { status: 'NOT_AVAILABLE', reason: 'NO_EVENT_TIME_DISTRIBUTION' },
    };
  }
  const activeConcerns = Object.values(currentDefensiveContext.contexts)
    .filter((context) => context && context.active)
    .map(concern)
    .sort(compareConcern);
  const status = activeConcerns.length ? activeConcerns[0].state : 'QUIET';
  return {
    schema: OPERATIONAL_ANXIETY_SCHEMA,
    version: OPERATIONAL_ANXIETY_VERSION,
    modelId: OPERATIONAL_ANXIETY_MODEL_ID,
    modelVersion: OPERATIONAL_ANXIETY_MODEL_VERSION,
    provenance: OPERATIONAL_ANXIETY_PROVENANCE,
    implementationStatus: 'IMPLEMENTED',
    publicLabel: 'LIVE',
    status,
    currentConcern: activeConcerns[0] || null,
    activeConcerns,
    objectiveControllability: activeConcerns[0]
      ? activeConcerns[0].objectiveControllability : 'NOT_APPLICABLE',
    perceivedControllability: 'NOT_IMPLEMENTED',
    subjectiveAnxietyMagnitude: 'NOT_IMPLEMENTED',
    temporalHazard: { status: 'NOT_AVAILABLE', reason: 'NO_EVENT_TIME_DISTRIBUTION' },
  };
}

export function operationalAnxietyTransition(currentDefensiveContext, contextResult) {
  const snapshot = operationalAnxietySnapshot(currentDefensiveContext);
  const transitions = Array.isArray(contextResult && contextResult.transitions)
    ? contextResult.transitions : [];
  return {
    ...snapshot,
    recordedAt: transitions.length ? transitions[transitions.length - 1].updatedAt : null,
    sourceEnvironmentEventIds: [...new Set(transitions.flatMap(
      (item) => item.sourceEnvironmentEventIds || [],
    ))],
  };
}
