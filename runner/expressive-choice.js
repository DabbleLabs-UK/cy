// expressive-choice.js - subjective character choice between real outward forms.
//
// This is deliberately not a psychological, Soma, reward, utility or action-value
// model. Grounded Soma facts are supplied without converting them to emotions, and
// the language model may choose only from the expressive capabilities offered by
// the runner. Instrumental world actions are outside this module.

import { wakingOpportunityIntervalMs } from './tempo.js';

export const EXPRESSIVE_CHOICE_SCHEMA = 'cy.model-mediated-expressive-choice';
export const EXPRESSIVE_CHOICE_VERSION = 1;
export const EXPRESSIVE_CHOICE_CLASSIFICATION = Object.freeze([
  'SUBJECTIVE_CHARACTER_LAYER',
  'NOT_SCIENTIFIC_PSYCHOLOGICAL_MODEL',
]);
export const EXPRESSIVE_CHOICE_MECHANISM = 'MODEL-MEDIATED SUBJECTIVE CHARACTER CHOICE';
export const EXPRESSIVE_CHOICE_FALLBACK_CLASSIFICATION = 'EXPRESSIVE CHOICE FALLBACK - ENGINEERING';
export const EXPRESSIVE_CHOICE_FALLBACK_ACTION = 'journal';

// ENGINEERING MODEL-CALL SETTINGS. These only constrain a short JSON response.
// They are not psychological parameters and do not encode action preferences.
export const EXPRESSIVE_CHOICE_MODEL_OPTIONS = Object.freeze({
  temperature: 0,
  top_p: 1,
  repeat_penalty: 1,
  repeat_last_n: 64,
  num_predict: 80,
});
export const EXPRESSIVE_CHOICE_RETRY_COUNT = 0;
// Existing silence capability gate, retained as an engineering scheduling constraint.
export const EXPRESSIVE_SILENCE_COOLDOWN_MS = 15 * 60 * 1000;

// ENGINEERING / PRESENTATION CADENCE. These are output-mix opportunities, not
// psychological or Soma parameters. The journal count keeps the existing early
// drawing opportunity at full tempo. Time supplies a separate opportunity when
// prose is slower. A failed drawing cools down drawing only, never writing.
export const EXPRESSIVE_DRAW_MIN_JOURNALS = 10;
export const EXPRESSIVE_DRAW_MAX_JOURNALS = 15;
export const EXPRESSIVE_DRAW_OPPORTUNITY_MIN_MS = 75 * 60 * 1000;
export const EXPRESSIVE_DRAW_OPPORTUNITY_SPREAD_MS = 60 * 60 * 1000;
export const EXPRESSIVE_DRAW_RETRY_BASE_MS = 3 * 60 * 1000;
export const EXPRESSIVE_DRAW_RETRY_MAX_MS = 30 * 60 * 1000;

function nonnegativeTimestamp(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function reconcileExpressiveCadence(value) {
  const journalsSinceDraw = Number.isInteger(value && value.journalsSinceDraw)
    && value.journalsSinceDraw >= 0
    ? Math.min(value.journalsSinceDraw, EXPRESSIVE_DRAW_MAX_JOURNALS) : 0;
  const consecutiveDrawFailures = Number.isInteger(value && value.consecutiveDrawFailures)
    && value.consecutiveDrawFailures >= 0
    ? Math.min(value.consecutiveDrawFailures, 10) : 0;
  return {
    journalsSinceDraw,
    nextDrawOpportunityAtMs: nonnegativeTimestamp(value && value.nextDrawOpportunityAtMs),
    drawRetryNotBeforeMs: nonnegativeTimestamp(value && value.drawRetryNotBeforeMs),
    consecutiveDrawFailures,
    lastOpportunityAtMs: nonnegativeTimestamp(value && value.lastOpportunityAtMs),
    lastPublishedAtMs: nonnegativeTimestamp(value && value.lastPublishedAtMs),
  };
}

export function recordExpressiveOpportunity(value, { nowMs = Date.now() } = {}) {
  return { ...reconcileExpressiveCadence(value), lastOpportunityAtMs: nonnegativeTimestamp(nowMs) };
}

export function expressiveCadenceAvailability(value, { nowMs = Date.now() } = {}) {
  const state = reconcileExpressiveCadence(value);
  const dueByJournal = state.journalsSinceDraw >= EXPRESSIVE_DRAW_MIN_JOURNALS;
  const dueByTime = state.nextDrawOpportunityAtMs > 0
    && nowMs >= state.nextDrawOpportunityAtMs;
  const retryReady = nowMs >= state.drawRetryNotBeforeMs;
  return {
    journal: true,
    draw: retryReady && (dueByJournal || dueByTime),
    phase: !retryReady && (dueByJournal || dueByTime)
      ? 'DRAW_COOLDOWN'
      : state.journalsSinceDraw >= EXPRESSIVE_DRAW_MAX_JOURNALS || dueByTime
        ? 'DRAW_PREFERRED'
        : dueByJournal ? 'DRAW_ELIGIBLE' : 'JOURNAL_INTERVAL',
  };
}

export function recordExpressiveJournal(value, { nowMs = Date.now() } = {}) {
  const state = reconcileExpressiveCadence(value);
  state.journalsSinceDraw = Math.min(EXPRESSIVE_DRAW_MAX_JOURNALS, state.journalsSinceDraw + 1);
  state.lastPublishedAtMs = nonnegativeTimestamp(nowMs);
  return state;
}

export function recordExpressiveDrawing(value, { nowMs = Date.now(), random = Math.random } = {}) {
  const state = reconcileExpressiveCadence(value);
  const draw = Math.min(1, Math.max(0, Number(random()) || 0));
  return {
    ...state,
    journalsSinceDraw: 0,
    nextDrawOpportunityAtMs: nowMs + EXPRESSIVE_DRAW_OPPORTUNITY_MIN_MS
      + Math.floor(draw * EXPRESSIVE_DRAW_OPPORTUNITY_SPREAD_MS),
    drawRetryNotBeforeMs: 0,
    consecutiveDrawFailures: 0,
    lastPublishedAtMs: nonnegativeTimestamp(nowMs),
  };
}

export function recordExpressiveDrawingFailure(value, { nowMs = Date.now() } = {}) {
  const state = reconcileExpressiveCadence(value);
  const failures = Math.min(10, state.consecutiveDrawFailures + 1);
  return {
    ...state,
    consecutiveDrawFailures: failures,
    drawRetryNotBeforeMs: nowMs + Math.min(
      EXPRESSIVE_DRAW_RETRY_MAX_MS,
      EXPRESSIVE_DRAW_RETRY_BASE_MS * (2 ** (failures - 1)),
    ),
  };
}

// Time since an actually published waking journal/sketch, counting only the
// current continuous eligible period. Two missed opportunities make silence
// unavailable for the next autonomous choice; a bad candidate is never forced
// through publication merely because the gap is long.
export function eligibleExpressionGap({ nowMs = Date.now(), eligibleSinceMs, lastPublishedMs = 0, tempoSpeed = 30 } = {}) {
  const thresholdMs = 2 * wakingOpportunityIntervalMs(tempoSpeed);
  const since = nonnegativeTimestamp(eligibleSinceMs);
  const latest = Math.max(since, nonnegativeTimestamp(lastPublishedMs));
  const elapsedMs = since ? Math.max(0, nowMs - latest) : 0;
  return { prolonged: since > 0 && elapsedMs >= thresholdMs, elapsedMs, thresholdMs };
}

export const EXPRESSIVE_ACTIONS = Object.freeze({
  journal: Object.freeze({
    id: 'journal',
    description: 'Write the next normal journal passage using the supplied context.',
  }),
  draw: Object.freeze({
    id: 'draw',
    description: 'Use the existing drawing path and draw only from supplied or already known material.',
  }),
  silence: Object.freeze({
    id: 'silence',
    description: 'Remain silent for the existing runner-controlled interval and record that real silence.',
  }),
});

const SYSTEM = [
  'You select one outward expressive behaviour for Cy, inmate 7734 in HMP ThinkPad.',
  'This is subjective character choice, not psychological measurement or scientific action selection.',
  'Use grounded facts only with their existing epistemic labels. Do not infer an emotion score.',
  'A provisional memory candidate is optional continuity material, not a fact or measured state.',
  'Select only an available action ID. Do not invent an event to justify journal, drawing or silence.',
  'Return one JSON object only. Do not provide reasoning, explanation or chain of thought.',
].join('\n');

function cleanText(value) {
  return value == null ? '' : String(value).trim();
}

function unique(values) {
  return [...new Set(values)];
}

function normaliseAvailableActions(values) {
  const ids = unique((values || [])
    .map((value) => typeof value === 'string' ? value : value && value.id)
    .filter((id) => Object.hasOwn(EXPRESSIVE_ACTIONS, id)));
  return ids.map((id) => ({ ...EXPRESSIVE_ACTIONS[id] }));
}

function groundedRefs(context) {
  return (context && Array.isArray(context.sections) ? context.sections : [])
    .map((section) => section && section.id ? `grounded:${section.id}` : null)
    .filter(Boolean);
}

export function buildExpressiveChoiceRequest({
  groundedContext = null,
  groundedDirective = '',
  currentIncidentContext = '',
  provisionalMemoryCandidate = null,
  availableActions = [],
  drawingPhase = 'JOURNAL_INTERVAL',
  prolongedEligibleGap = false,
} = {}) {
  const actions = normaliseAvailableActions(availableActions);
  const incident = cleanText(currentIncidentContext);
  const candidateIsTraceable = provisionalMemoryCandidate
    && typeof provisionalMemoryCandidate === 'object'
    && cleanText(provisionalMemoryCandidate.sourceEventId)
    && cleanText(provisionalMemoryCandidate.sourceTimestamp)
    && cleanText(provisionalMemoryCandidate.sourceKind)
    && cleanText(provisionalMemoryCandidate.archivedEventText);
  const memory = candidateIsTraceable
    ? {
        classification: 'PROVISIONAL MEMORY CANDIDATE',
        id: `memory:event:${cleanText(provisionalMemoryCandidate.sourceEventId)}`,
        sourceEventId: cleanText(provisionalMemoryCandidate.sourceEventId),
        sourceTimestamp: cleanText(provisionalMemoryCandidate.sourceTimestamp),
        sourceKind: cleanText(provisionalMemoryCandidate.sourceKind),
        archivedEventText: cleanText(provisionalMemoryCandidate.archivedEventText),
      }
    : null;
  const allowedFocusRefs = groundedRefs(groundedContext);
  if (incident) allowedFocusRefs.push('incident:current');
  if (memory) allowedFocusRefs.push(memory.id);
  return {
    schema: EXPRESSIVE_CHOICE_SCHEMA,
    version: EXPRESSIVE_CHOICE_VERSION,
    classification: [...EXPRESSIVE_CHOICE_CLASSIFICATION],
    identity: 'Cy, inmate 7734, held in HMP ThinkPad; outward expression only, no world-changing action.',
    groundedContext,
    groundedDirective: cleanText(groundedDirective),
    currentIncidentContext: incident || null,
    provisionalMemoryCandidate: memory,
    availableActions: actions,
    allowedFocusRefs: unique(allowedFocusRefs),
    drawingPhase,
    prolongedEligibleGap: !!prolongedEligibleGap,
  };
}

export function expressiveChoiceModelCall(request) {
  const payload = {
    grounded_current_state: request.groundedDirective || '[UNKNOWN] No grounded Soma state is available.',
    current_or_recent_incident_context: request.currentIncidentContext || '[NONE SUPPLIED]',
    provisional_memory_candidate: request.provisionalMemoryCandidate || '[NONE SUPPLIED]',
    available_expressive_actions: request.availableActions,
    allowed_focus_refs: request.allowedFocusRefs,
    expression_timing: {
      drawing_phase: request.drawingPhase,
      prolonged_eligible_waking_gap: request.prolongedEligibleGap,
      guidance: request.prolongedEligibleGap
        ? 'It has been a long eligible waking interval without a published journal or sketch. Use grounded ordinary experience for writing or drawing; do not invent an external event.'
        : request.drawingPhase === 'DRAW_PREFERRED'
          ? 'A sketch opportunity is due. Prefer a grounded sketch when it fits; writing and silence remain valid.'
          : 'Choose among available forms from grounded current context. No publication quota.',
    },
    output_schema: {
      action: request.availableActions.map((item) => item.id).join(' | '),
      focusRefs: 'array containing only allowed_focus_refs; may be empty',
      reasonType: 'subjective_character_choice',
    },
  };
  return {
    system: SYSTEM,
    prompt: JSON.stringify(payload),
    options: { ...EXPRESSIVE_CHOICE_MODEL_OPTIONS },
    purpose: 'expressive_choice',
  };
}

function extractObject(text) {
  const source = cleanText(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  if (!source) throw new Error('EMPTY_OR_UNAVAILABLE_PROVIDER_OUTPUT');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('NO_JSON_OBJECT');
  return JSON.parse(source.slice(start, end + 1));
}

function engineeringFallback(request, reason) {
  const allowedIds = request.availableActions.map((item) => item.id);
  const action = allowedIds.includes(EXPRESSIVE_CHOICE_FALLBACK_ACTION)
    ? EXPRESSIVE_CHOICE_FALLBACK_ACTION : (allowedIds[0] || EXPRESSIVE_CHOICE_FALLBACK_ACTION);
  return {
    action,
    focusRefs: [],
    reasonType: 'subjective_character_choice',
    selectionMechanism: EXPRESSIVE_CHOICE_MECHANISM,
    fallbackUsed: true,
    fallback: {
      classification: EXPRESSIVE_CHOICE_FALLBACK_CLASSIFICATION,
      reason: cleanText(reason) || 'UNKNOWN_CHOOSER_FAILURE',
    },
  };
}

export async function chooseExpressiveAction(request, { generate } = {}) {
  const call = expressiveChoiceModelCall(request);
  let parsed;
  try {
    if (typeof generate !== 'function') throw new Error('PROVIDER_UNAVAILABLE');
    parsed = extractObject(await generate(call));
  } catch (error) {
    const decision = engineeringFallback(request, error && error.message);
    return expressiveChoiceInspection(request, decision);
  }
  const allowedIds = request.availableActions.map((item) => item.id);
  if (!parsed || !allowedIds.includes(parsed.action)) {
    return expressiveChoiceInspection(request, engineeringFallback(request, 'INVALID_OR_UNAVAILABLE_ACTION'));
  }
  const allowedRefs = new Set(request.allowedFocusRefs);
  const focusRefs = unique(Array.isArray(parsed.focusRefs) ? parsed.focusRefs
    .map(cleanText).filter((ref) => allowedRefs.has(ref)) : []);
  return expressiveChoiceInspection(request, {
    action: parsed.action,
    focusRefs,
    reasonType: 'subjective_character_choice',
    selectionMechanism: EXPRESSIVE_CHOICE_MECHANISM,
    fallbackUsed: false,
    fallback: null,
  });
}

export function expressiveChoiceInspection(request, decision) {
  return {
    schema: EXPRESSIVE_CHOICE_SCHEMA,
    version: EXPRESSIVE_CHOICE_VERSION,
    classification: [...EXPRESSIVE_CHOICE_CLASSIFICATION],
    availableActions: request.availableActions,
    groundedContextSupplied: request.groundedContext,
    groundedDirectiveSupplied: request.groundedDirective,
    currentIncidentContextSupplied: request.currentIncidentContext,
    provisionalCognitiveContextSupplied: request.provisionalMemoryCandidate,
    selectedAction: decision.action,
    focusRefs: decision.focusRefs,
    reasonType: decision.reasonType,
    selectionMechanism: decision.selectionMechanism,
    fallbackUsed: decision.fallbackUsed,
    fallback: decision.fallback,
  };
}

export async function performExpressiveChoice(inspection, handlers = {}) {
  const action = inspection && inspection.selectedAction;
  const handler = action && handlers[action];
  if (typeof handler !== 'function') throw new Error(`No expressive handler for ${action || 'unknown action'}`);
  return handler({ focusRefs: inspection.focusRefs || [], inspection });
}
