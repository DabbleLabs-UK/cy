// probabilistic-threat-learning.js - parameter-free Beta-Bernoulli learning.
//
// This subsystem learns only from explicit structured cue/outcome trials in
// environment records. It does not read generated prose, sentiment, legacy
// appraisal magnitudes, relationship scores, or visitor-facing Soma values.

export const THREAT_LEARNING_SCHEMA = 'cy.probabilistic-threat-learning';
export const THREAT_LEARNING_VERSION = 1;
export const THREAT_LEARNING_MODEL_ID = 'tzovara-beta-bernoulli-threat-learning';
export const THREAT_LEARNING_MODEL_VERSION = 'probabilistic-threat-learning-v1';
export const THREAT_LEARNING_PROVENANCE = 'config/model-specs/probabilistic-threat-learning.json';
export const THREAT_LEARNING_PRIOR = Object.freeze({ alpha: 1, beta: 1 });

export const THREAT_OUTCOME_CLASSES = Object.freeze([
  'PHYSICAL_HARM',
  'COERCIVE_LOSS_OF_CONTROL',
  'SOCIAL_HOSTILITY',
  'DEPRIVATION_OR_LOSS',
]);

export const THREAT_OUTCOME_STATUSES = Object.freeze([
  'occurred',
  'did_not_occur',
  'unknown',
]);

const VALID_OUTCOMES = new Set(THREAT_OUTCOME_CLASSES);
const VALID_STATUSES = new Set(THREAT_OUTCOME_STATUSES);
const VALID_CUE = /^(actor|event|location|signal):[a-z0-9][a-z0-9_-]*$/;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function posteriorMean(alpha, beta) {
  return alpha / (alpha + beta);
}

export function posteriorVariance(alpha, beta) {
  const total = alpha + beta;
  return (alpha * beta) / (total * total * (total + 1));
}

function posterior(alpha = 1, beta = 1) {
  return {
    alpha,
    beta,
    mean: posteriorMean(alpha, beta),
    variance: posteriorVariance(alpha, beta),
    resolvedObservations: alpha + beta - THREAT_LEARNING_PRIOR.alpha - THREAT_LEARNING_PRIOR.beta,
  };
}

export function createThreatLearning(now = Date.now()) {
  return {
    schema: THREAT_LEARNING_SCHEMA,
    version: THREAT_LEARNING_VERSION,
    modelId: THREAT_LEARNING_MODEL_ID,
    modelVersion: THREAT_LEARNING_MODEL_VERSION,
    provenance: THREAT_LEARNING_PROVENANCE,
    installedAtMs: now,
    pairs: {},
    history: [],
  };
}

function validPosterior(raw) {
  const alpha = Number(raw && raw.alpha);
  const beta = Number(raw && raw.beta);
  if (!Number.isInteger(alpha) || alpha < 1 || !Number.isInteger(beta) || beta < 1) return null;
  return posterior(alpha, beta);
}

export function reconcileThreatLearning(raw, { now = Date.now() } = {}) {
  const out = createThreatLearning(now);
  if (!raw || raw.schema !== THREAT_LEARNING_SCHEMA || raw.version !== THREAT_LEARNING_VERSION) return out;
  out.installedAtMs = Number.isFinite(raw.installedAtMs) ? raw.installedAtMs : now;
  for (const [cueId, byOutcome] of Object.entries(raw.pairs || {})) {
    if (!VALID_CUE.test(cueId) || !byOutcome || typeof byOutcome !== 'object') continue;
    for (const [outcomeClass, value] of Object.entries(byOutcome)) {
      if (!VALID_OUTCOMES.has(outcomeClass)) continue;
      const clean = validPosterior(value);
      if (!clean) continue;
      if (!out.pairs[cueId]) out.pairs[cueId] = {};
      out.pairs[cueId][outcomeClass] = {
        ...clean,
        cueId,
        cueType: cueId.split(':', 1)[0],
        outcomeClass,
        lastUpdatedAt: value.lastUpdatedAt || null,
      };
    }
  }
  out.history = Array.isArray(raw.history) ? clone(raw.history) : [];
  return out;
}

function canonicalPart(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

export function cuesFromEnvironmentRecord(record) {
  const event = record && record.world_event;
  const world = event && event.world;
  if (!event || !world) return [];
  const cues = [];
  const add = (type, value) => {
    const part = canonicalPart(value);
    const id = `${type}:${part}`;
    if (part && VALID_CUE.test(id) && !cues.some((cue) => cue.id === id)) cues.push({ id, type });
  };
  add('event', event.event_type);
  if (event.event_family !== 'mail') {
    const actor = world.participants && (world.participants.relationship_ref || world.participants.actor);
    add('actor', actor);
  }
  add('location', world.context && world.context.location);
  for (const signal of (world.associative_learning && world.associative_learning.explicit_signals) || []) {
    add('signal', signal);
  }
  return cues;
}

export function trialsFromEnvironmentRecord(record) {
  const event = record && record.world_event;
  const learning = event && event.world && event.world.associative_learning;
  if (!event || !learning || learning.linkage !== 'self_contained_event') return [];
  const cues = cuesFromEnvironmentRecord(record);
  const trials = [];
  for (const outcome of Array.isArray(learning.outcomes) ? learning.outcomes : []) {
    if (!outcome || !VALID_OUTCOMES.has(outcome.outcome_class) || !VALID_STATUSES.has(outcome.status)) continue;
    for (const cue of cues) {
      trials.push({
        cueId: cue.id,
        cueType: cue.type,
        outcomeClass: outcome.outcome_class,
        status: outcome.status,
        timestamp: event.timestamp,
        sourceEnvironmentEventIds: [event.id],
      });
    }
  }
  return trials;
}

export function updateThreatLearning(state, trial) {
  if (!state || !trial || !VALID_CUE.test(String(trial.cueId || ''))
      || !VALID_OUTCOMES.has(trial.outcomeClass) || !VALID_STATUSES.has(trial.status)) {
    return { updated: false, reason: 'invalid_trial' };
  }
  if (trial.status === 'unknown') return { updated: false, reason: 'unknown_outcome', trial: clone(trial) };
  const u = trial.status === 'occurred' ? 1 : 0;
  const current = state.pairs[trial.cueId] && state.pairs[trial.cueId][trial.outcomeClass]
    ? state.pairs[trial.cueId][trial.outcomeClass]
    : posterior();
  const before = posterior(current.alpha, current.beta);
  const after = posterior(current.alpha + u, current.beta + (1 - u));
  const probability = u === 1 ? before.mean : 1 - before.mean;
  const update = {
    timestamp: trial.timestamp,
    cueId: trial.cueId,
    cueType: trial.cueType || trial.cueId.split(':', 1)[0],
    outcomeClass: trial.outcomeClass,
    outcomeStatus: trial.status,
    u,
    before,
    after,
    outcomeSurprisal: -Math.log(probability),
    surprisalMeaning: 'information-theoretic outcome surprisal before update; no behavioural effect',
    sourceEnvironmentEventIds: [...new Set((trial.sourceEnvironmentEventIds || []).map(String).filter(Boolean))],
  };
  if (!state.pairs[trial.cueId]) state.pairs[trial.cueId] = {};
  state.pairs[trial.cueId][trial.outcomeClass] = {
    ...after,
    cueId: trial.cueId,
    cueType: update.cueType,
    outcomeClass: trial.outcomeClass,
    lastUpdatedAt: trial.timestamp,
  };
  state.history.push(update);
  return { updated: true, update: clone(update) };
}

export function observeThreatLearningRecord(state, record) {
  const trials = trialsFromEnvironmentRecord(record);
  const results = trials.map((trial) => updateThreatLearning(state, trial));
  return {
    modelId: THREAT_LEARNING_MODEL_ID,
    modelVersion: THREAT_LEARNING_MODEL_VERSION,
    provenance: THREAT_LEARNING_PROVENANCE,
    sourceEnvironmentEventId: record && record.world_event ? record.world_event.id : null,
    trialsExamined: trials.length,
    updatesApplied: results.filter((result) => result.updated).length,
    results,
  };
}

export function threatLearningInspection(state) {
  const associations = [];
  for (const [cueId, byOutcome] of Object.entries((state && state.pairs) || {})) {
    for (const [outcomeClass, value] of Object.entries(byOutcome || {})) {
      const history = (state.history || []).filter((row) => row.cueId === cueId && row.outcomeClass === outcomeClass)
        .map((row) => ({ timestamp: row.timestamp, u: row.u, mean: row.after.mean, variance: row.after.variance }));
      associations.push({ ...clone(value), cueId, outcomeClass, history });
    }
  }
  associations.sort((a, b) => b.resolvedObservations - a.resolvedObservations
    || String(b.lastUpdatedAt || '').localeCompare(String(a.lastUpdatedAt || ''))
    || a.cueId.localeCompare(b.cueId) || a.outcomeClass.localeCompare(b.outcomeClass));
  return {
    status: 'implemented',
    publicLabel: 'LIVE',
    meaning: 'Learned probability that a structured cue predicts a particular adverse outcome class.',
    modelId: THREAT_LEARNING_MODEL_ID,
    modelVersion: THREAT_LEARNING_MODEL_VERSION,
    provenance: THREAT_LEARNING_PROVENANCE,
    prior: { ...THREAT_LEARNING_PRIOR, mean: 0.5, variance: 1 / 12 },
    assumptions: ['binary outcome', 'stationary contingency', 'independent resolved observations'],
    notModelled: ['volatility', 'forgetting', 'recency weighting', 'context switching', 'contextual inference', 'cue generalisation'],
    resolvedUpdates: (state && state.history && state.history.length) || 0,
    associations,
  };
}

export function threatLearningSnapshot(state) {
  const exact = threatLearningInspection(state);
  const mostObservedByOutcome = [];
  const representedOutcomes = new Set();
  for (const association of exact.associations) {
    if (representedOutcomes.has(association.outcomeClass)) continue;
    representedOutcomes.add(association.outcomeClass);
    mostObservedByOutcome.push(association);
  }
  return {
    status: exact.status,
    publicLabel: exact.publicLabel,
    meaning: exact.meaning,
    modelId: exact.modelId,
    modelVersion: exact.modelVersion,
    provenance: exact.provenance,
    assumptions: exact.assumptions,
    notModelled: exact.notModelled,
    hasResolvedObservations: exact.resolvedUpdates > 0,
    associations: mostObservedByOutcome.map((association) => {
      const adverse = association.alpha - THREAT_LEARNING_PRIOR.alpha;
      const safe = association.beta - THREAT_LEARNING_PRIOR.beta;
      return {
        cueId: association.cueId,
        cueType: association.cueType,
        outcomeClass: association.outcomeClass,
        evidenceBalance: adverse > safe ? 'adverse_more_often'
          : safe > adverse ? 'safe_more_often' : 'evenly_split',
      };
    }),
  };
}
