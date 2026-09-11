// action-outcome-contingency.js - grounded observational contingency learning.
//
// This subsystem learns only from explicit structured action opportunities.
// It estimates separate adverse-outcome probabilities for an executed action
// and for deliberate non-performance when that action was genuinely available.
// It does not infer causality, perceived control, helplessness, policy or brain
// activation.

import {
  THREAT_OUTCOME_CLASSES,
  posteriorMean,
  posteriorVariance,
} from './probabilistic-threat-learning.js';

export const ACTION_OPPORTUNITY_SCHEMA = 'cy.action-opportunity';
export const ACTION_OPPORTUNITY_VERSION = 1;
export const CONTROLLABILITY_STATE_SCHEMA = 'cy.action-outcome-contingency';
export const CONTROLLABILITY_STATE_VERSION = 1;
export const CONTROLLABILITY_MODEL_ID = 'experienced-action-outcome-contingency';
export const CONTROLLABILITY_MODEL_VERSION = 'action-outcome-contingency-v1';
export const CONTROLLABILITY_PROVENANCE = 'config/model-specs/action-outcome-contingency.json';
export const CONTROLLABILITY_PRIOR = Object.freeze({ alpha: 1, beta: 1 });

export const ACTION_EXECUTION_STATUSES = Object.freeze([
  'INTENDED',
  'ATTEMPTED',
  'EXECUTED',
  'PREVENTED',
  'NONE',
  'UNKNOWN',
  'NOT_AVAILABLE',
]);

export const OPPORTUNITY_RESOLUTION_STATUSES = Object.freeze([
  'UNRESOLVED',
  'RESOLVED',
  'UNKNOWN',
]);

export const CONTINGENCY_OUTCOME_STATUSES = Object.freeze([
  'OCCURRED',
  'DID_NOT_OCCUR',
  'UNKNOWN',
]);

const VALID_ACTION = /^action:[a-z0-9][a-z0-9_-]*$/;
const VALID_CONTEXT = /^[a-z0-9][a-z0-9:_-]*$/;
const VALID_EXECUTION = new Set(ACTION_EXECUTION_STATUSES);
const VALID_RESOLUTION = new Set(OPPORTUNITY_RESOLUTION_STATUSES);
const VALID_OUTCOME = new Set(THREAT_OUTCOME_CLASSES);
const VALID_OUTCOME_STATUS = new Set(CONTINGENCY_OUTCOME_STATUSES);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function canonicalPart(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function canonicalAction(value) {
  const candidate = canonicalPart(value);
  return VALID_ACTION.test(candidate) ? candidate : null;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function posterior(alpha = CONTROLLABILITY_PRIOR.alpha, beta = CONTROLLABILITY_PRIOR.beta) {
  return {
    alpha,
    beta,
    mean: posteriorMean(alpha, beta),
    variance: posteriorVariance(alpha, beta),
    resolvedObservations: alpha + beta - CONTROLLABILITY_PRIOR.alpha - CONTROLLABILITY_PRIOR.beta,
  };
}

function validPosterior(raw) {
  const alpha = Number(raw && raw.alpha);
  const beta = Number(raw && raw.beta);
  return Number.isInteger(alpha) && alpha >= CONTROLLABILITY_PRIOR.alpha
    && Number.isInteger(beta) && beta >= CONTROLLABILITY_PRIOR.beta
    ? posterior(alpha, beta) : null;
}

function conditionSnapshot(raw) {
  return validPosterior(raw) || posterior();
}

function outcomeStatus(value) {
  const mapped = {
    occurred: 'OCCURRED',
    did_not_occur: 'DID_NOT_OCCUR',
    unknown: 'UNKNOWN',
  }[String(value || '').trim().toLowerCase()];
  return mapped || 'UNKNOWN';
}

function unavailableActions(raw) {
  const result = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const actionId = canonicalAction(item && typeof item === 'object' ? item.action_id : item);
    if (!actionId) continue;
    result.push({
      actionId,
      reason: canonicalPart(item && typeof item === 'object' ? item.reason : 'unknown') || 'unknown',
    });
  }
  return result;
}

function resolvedOutcomes(raw) {
  const result = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || !VALID_OUTCOME.has(item.outcome_class)) continue;
    const status = outcomeStatus(item.status);
    if (!VALID_OUTCOME_STATUS.has(status)) continue;
    result.push({ outcomeClass: item.outcome_class, status });
  }
  return result;
}

export function actionOpportunityFromEnvironment(record) {
  const event = record && record.world_event;
  const raw = event && event.world && event.world.action_opportunity;
  if (!event || !raw || typeof raw !== 'object') return null;
  const opportunityId = canonicalPart(raw.id);
  const contextId = canonicalPart(raw.context_id);
  if (!opportunityId || !VALID_CONTEXT.test(contextId)) return null;
  const availableActions = uniqueStrings(
    uniqueStrings(raw.available_actions).map(canonicalAction).filter(Boolean),
  );
  const unavailable = unavailableActions(raw.unavailable_actions);
  const suppliedAction = String(raw.chosen_action || '').trim().toUpperCase();
  const chosenAction = suppliedAction === 'NONE' || suppliedAction === 'UNKNOWN'
    ? suppliedAction : canonicalAction(raw.chosen_action) || 'UNKNOWN';
  const suppliedExecuted = String(raw.action_actually_executed || '').trim().toUpperCase();
  const actionActuallyExecuted = ['NONE', 'UNKNOWN', 'NOT_AVAILABLE'].includes(suppliedExecuted)
    ? suppliedExecuted : canonicalAction(raw.action_actually_executed) || 'UNKNOWN';
  const executionStatus = String(raw.execution_status || 'UNKNOWN').toUpperCase();
  const resolutionStatus = String(raw.resolution_status || 'UNKNOWN').toUpperCase();
  return {
    schema: ACTION_OPPORTUNITY_SCHEMA,
    version: ACTION_OPPORTUNITY_VERSION,
    opportunityId,
    contextId,
    contextType: canonicalPart(raw.context_type) || 'unknown',
    availableActions,
    unavailableActions: unavailable,
    chosenAction,
    actionActuallyExecuted,
    executionStatus: VALID_EXECUTION.has(executionStatus) ? executionStatus : 'UNKNOWN',
    onsetAt: typeof raw.onset_at === 'string' && raw.onset_at ? raw.onset_at : null,
    resolvedAt: typeof raw.resolved_at === 'string' && raw.resolved_at ? raw.resolved_at : null,
    resolutionStatus: VALID_RESOLUTION.has(resolutionStatus) ? resolutionStatus : 'UNKNOWN',
    linkedEnvironmentEventIds: uniqueStrings([
      ...(Array.isArray(raw.linked_event_ids) ? raw.linked_event_ids : []),
      event.id,
    ]),
    outcomeResolution: resolvedOutcomes(raw.outcome_resolution),
    sourceEnvironmentEventIds: [event.id],
    fieldProvenance: {
      opportunity: 'STRUCTURED_WORLD_FACT',
      actionAvailability: 'STRUCTURED_WORLD_FACT',
      chosenAction: 'STRUCTURED_WORLD_FACT',
      actionActuallyExecuted: 'STRUCTURED_WORLD_FACT',
      executionStatus: 'STRUCTURED_WORLD_FACT',
      outcomes: 'STRUCTURED_WORLD_FACT',
    },
  };
}

export function createControllabilityState(now = Date.now()) {
  return {
    schema: CONTROLLABILITY_STATE_SCHEMA,
    version: CONTROLLABILITY_STATE_VERSION,
    modelId: CONTROLLABILITY_MODEL_ID,
    modelVersion: CONTROLLABILITY_MODEL_VERSION,
    provenance: CONTROLLABILITY_PROVENANCE,
    installedAtMs: now,
    opportunities: {},
    opportunityHistory: [],
    resolvedOpportunityIds: [],
    pairs: {},
    history: [],
  };
}

function validOpportunity(raw) {
  if (!(raw && raw.schema === ACTION_OPPORTUNITY_SCHEMA
    && raw.version === ACTION_OPPORTUNITY_VERSION
    && typeof raw.opportunityId === 'string' && raw.opportunityId
    && typeof raw.contextId === 'string' && VALID_CONTEXT.test(raw.contextId)
    && Array.isArray(raw.availableActions)
    && raw.availableActions.every((actionId) => VALID_ACTION.test(actionId))
    && VALID_EXECUTION.has(raw.executionStatus)
    && VALID_RESOLUTION.has(raw.resolutionStatus)
    && Array.isArray(raw.outcomeResolution)
    && raw.outcomeResolution.every((item) => item && VALID_OUTCOME.has(item.outcomeClass)
      && VALID_OUTCOME_STATUS.has(item.status)))) return false;
  const unavailableIds = new Set((raw.unavailableActions || []).map((item) => item.actionId));
  if (raw.availableActions.some((actionId) => unavailableIds.has(actionId))) return false;
  if (raw.executionStatus === 'EXECUTED') {
    return VALID_ACTION.test(raw.chosenAction)
      && raw.availableActions.includes(raw.chosenAction)
      && raw.actionActuallyExecuted === raw.chosenAction;
  }
  if (raw.executionStatus === 'NONE') {
    return raw.chosenAction === 'NONE' && raw.actionActuallyExecuted === 'NONE';
  }
  if (raw.executionStatus === 'NOT_AVAILABLE') return raw.actionActuallyExecuted === 'NOT_AVAILABLE';
  return raw.actionActuallyExecuted === 'NONE' || raw.actionActuallyExecuted === 'UNKNOWN';
}

function pairKey(contextId, actionId, outcomeClass) {
  return `${contextId}|${actionId}|${outcomeClass}`;
}

function validPair(raw, key) {
  if (!raw || raw.pairKey !== key || !VALID_CONTEXT.test(raw.contextId)
      || !VALID_ACTION.test(raw.actionId) || !VALID_OUTCOME.has(raw.outcomeClass)) return null;
  const action = validPosterior(raw.action);
  const noAction = validPosterior(raw.noAction);
  return action && noAction ? {
    pairKey: key,
    contextId: raw.contextId,
    actionId: raw.actionId,
    outcomeClass: raw.outcomeClass,
    action,
    noAction,
    lastUpdatedAt: raw.lastUpdatedAt || null,
  } : null;
}

export function reconcileControllabilityState(raw, { now = Date.now() } = {}) {
  const out = createControllabilityState(now);
  if (!raw || raw.schema !== CONTROLLABILITY_STATE_SCHEMA
      || raw.version !== CONTROLLABILITY_STATE_VERSION) return out;
  out.installedAtMs = Number.isFinite(raw.installedAtMs) ? raw.installedAtMs : now;
  for (const [id, opportunity] of Object.entries(raw.opportunities || {})) {
    if (validOpportunity(opportunity) && opportunity.opportunityId === id) {
      out.opportunities[id] = clone(opportunity);
    }
  }
  out.opportunityHistory = Array.isArray(raw.opportunityHistory)
    ? raw.opportunityHistory.filter(validOpportunity).map(clone) : [];
  out.resolvedOpportunityIds = uniqueStrings(raw.resolvedOpportunityIds)
    .filter((id) => Boolean(out.opportunities[id]));
  for (const [key, value] of Object.entries(raw.pairs || {})) {
    const clean = validPair(value, key);
    if (clean) out.pairs[key] = clean;
  }
  out.history = Array.isArray(raw.history) ? clone(raw.history) : [];
  return out;
}

function pairFor(state, contextId, actionId, outcomeClass) {
  const key = pairKey(contextId, actionId, outcomeClass);
  return state.pairs[key] || {
    pairKey: key,
    contextId,
    actionId,
    outcomeClass,
    action: posterior(),
    noAction: posterior(),
    lastUpdatedAt: null,
  };
}

function updatePair(state, opportunity, actionId, outcome, condition) {
  const current = pairFor(state, opportunity.contextId, actionId, outcome.outcomeClass);
  const before = conditionSnapshot(current[condition]);
  const u = outcome.status === 'OCCURRED' ? 1 : 0;
  const after = posterior(before.alpha + u, before.beta + (1 - u));
  const next = { ...current, [condition]: after, lastUpdatedAt: opportunity.resolvedAt };
  state.pairs[next.pairKey] = next;
  const conditionId = condition === 'action' ? actionId : `NOT_ACTION:${actionId}`;
  const update = {
    timestamp: opportunity.resolvedAt,
    opportunityId: opportunity.opportunityId,
    contextId: opportunity.contextId,
    contextType: opportunity.contextType,
    availableActions: clone(opportunity.availableActions),
    performedAction: opportunity.actionActuallyExecuted,
    executionStatus: opportunity.executionStatus,
    condition,
    conditionId,
    comparatorCondition: condition === 'action' ? `NOT_ACTION:${actionId}` : actionId,
    actionId,
    outcomeClass: outcome.outcomeClass,
    outcomeStatus: outcome.status,
    u,
    before,
    after,
    sourceEnvironmentEventIds: clone(opportunity.linkedEnvironmentEventIds),
  };
  state.history.push(update);
  return update;
}

function trialCondition(opportunity, actionId) {
  if (!opportunity.availableActions.includes(actionId)) return null;
  if (opportunity.executionStatus === 'EXECUTED') {
    return opportunity.chosenAction === actionId ? 'action' : 'noAction';
  }
  if (opportunity.executionStatus === 'NONE' && opportunity.chosenAction === 'NONE') return 'noAction';
  return null;
}

export function observeControllabilityRecord(state, record) {
  if (!state || !record) return { updated: false, reason: 'invalid_record', updates: [] };
  const opportunity = actionOpportunityFromEnvironment(record);
  if (!opportunity) return { updated: false, reason: 'no_action_opportunity', updates: [] };
  if (!validOpportunity(opportunity)) {
    return { updated: false, reason: 'invalid_action_opportunity', opportunity: clone(opportunity), updates: [] };
  }
  if (state.opportunityHistory.some((item) => item.sourceEnvironmentEventIds.includes(record.world_event.id))) {
    return { updated: false, reason: 'duplicate_event', opportunity: clone(opportunity), updates: [] };
  }
  state.opportunities[opportunity.opportunityId] = clone(opportunity);
  state.opportunityHistory.push(clone(opportunity));
  if (opportunity.resolutionStatus !== 'RESOLVED') {
    return { updated: false, reason: 'unresolved_opportunity', opportunity: clone(opportunity), updates: [] };
  }
  if (!opportunity.resolvedAt) {
    return { updated: false, reason: 'missing_resolution_timestamp', opportunity: clone(opportunity), updates: [] };
  }
  if (state.resolvedOpportunityIds.includes(opportunity.opportunityId)) {
    return { updated: false, reason: 'duplicate_resolution', opportunity: clone(opportunity), updates: [] };
  }
  state.resolvedOpportunityIds.push(opportunity.opportunityId);
  const updates = [];
  for (const outcome of opportunity.outcomeResolution) {
    if (outcome.status === 'UNKNOWN') continue;
    for (const actionId of opportunity.availableActions) {
      const condition = trialCondition(opportunity, actionId);
      if (condition) updates.push(updatePair(state, opportunity, actionId, outcome, condition));
    }
  }
  return {
    modelId: CONTROLLABILITY_MODEL_ID,
    modelVersion: CONTROLLABILITY_MODEL_VERSION,
    provenance: CONTROLLABILITY_PROVENANCE,
    sourceEnvironmentEventId: record.world_event.id,
    updated: updates.length > 0,
    reason: updates.length ? 'resolved_observational_updates' : 'no_eligible_resolved_outcome',
    opportunity: clone(opportunity),
    updates,
  };
}

function contingencySummary(pair) {
  const action = conditionSnapshot(pair.action);
  const noAction = conditionSnapshot(pair.noAction);
  const difference = noAction.mean - action.mean;
  const direction = action.resolvedObservations === 0 || noAction.resolvedObservations === 0
    ? 'INSUFFICIENT_COMPARATOR_EVIDENCE'
    : difference > 0 ? 'ADVERSE_OUTCOME_LOWER_WITH_ACTION'
      : difference < 0 ? 'ADVERSE_OUTCOME_HIGHER_WITH_ACTION'
        : 'POSTERIOR_MEANS_EQUAL';
  return {
    contextId: pair.contextId,
    actionId: pair.actionId,
    outcomeClass: pair.outcomeClass,
    actionPosterior: action,
    noActionPosterior: noAction,
    contingencyDifference: difference,
    contingencyVariance: action.variance + noAction.variance,
    observationCounts: {
      actionPerformed: action.resolvedObservations,
      actionWithheld: noAction.resolvedObservations,
    },
    evidenceDescription: direction,
    lastUpdatedAt: pair.lastUpdatedAt,
    credibleInterval: 'NOT_MODELLED',
    causalStatus: 'NOT_ESTABLISHED',
    perceivedControl: 'NOT_MODELLED',
  };
}

export function contingenciesForContext(state, contextId, availableActions = null) {
  const actions = Array.isArray(availableActions) ? new Set(availableActions) : null;
  return Object.values((state && state.pairs) || {})
    .filter((pair) => pair.contextId === contextId && (!actions || actions.has(pair.actionId)))
    .map(contingencySummary);
}

export function controllabilityInspection(state) {
  return {
    status: 'implemented',
    publicLabel: 'LIVE',
    meaning: 'Experienced action-outcome contingency from explicit comparable structured opportunities. This is observational association, not causal or perceived control.',
    modelId: CONTROLLABILITY_MODEL_ID,
    modelVersion: CONTROLLABILITY_MODEL_VERSION,
    provenance: CONTROLLABILITY_PROVENANCE,
    prior: clone(CONTROLLABILITY_PRIOR),
    contingencies: Object.values((state && state.pairs) || {}).map(contingencySummary),
    opportunities: clone((state && state.opportunities) || {}),
    opportunityHistory: clone((state && state.opportunityHistory) || []),
    history: clone((state && state.history) || []),
    causalControlInference: 'NOT_MODELLED',
    perceivedControl: 'NOT_MODELLED',
    contextGeneralisation: 'NOT_MODELLED',
    bayesianControllabilityModelComparison: 'NOT_MODELLED',
    actionSelectionFromControl: 'NOT_MODELLED',
  };
}

export function controllabilitySnapshot(state) {
  const exact = controllabilityInspection(state);
  return {
    status: exact.status,
    publicLabel: exact.publicLabel,
    meaning: exact.meaning,
    modelId: exact.modelId,
    modelVersion: exact.modelVersion,
    provenance: exact.provenance,
    prior: exact.prior,
    contingencies: exact.contingencies,
    totalOpportunities: exact.opportunityHistory.length,
    totalResolvedUpdates: exact.history.length,
    causalControlInference: exact.causalControlInference,
    perceivedControl: exact.perceivedControl,
    contextGeneralisation: exact.contextGeneralisation,
    bayesianControllabilityModelComparison: exact.bayesianControllabilityModelComparison,
    actionSelectionFromControl: exact.actionSelectionFromControl,
  };
}
