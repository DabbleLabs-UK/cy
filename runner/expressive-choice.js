// expressive-choice.js - subjective character choice between real outward forms.
//
// This is deliberately not a psychological, Soma, reward, utility or action-value
// model. Grounded Soma facts are supplied without converting them to emotions, and
// the language model may choose only from the expressive capabilities offered by
// the runner. Instrumental world actions are outside this module.

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
// Existing capability gates, retained as engineering scheduling constraints.
export const EXPRESSIVE_DRAW_COOLDOWN_MS = 45 * 60 * 1000;
export const EXPRESSIVE_SILENCE_COOLDOWN_MS = 15 * 60 * 1000;

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
} = {}) {
  const actions = normaliseAvailableActions(availableActions);
  const incident = cleanText(currentIncidentContext);
  const memory = provisionalMemoryCandidate && typeof provisionalMemoryCandidate === 'object'
    ? {
        classification: 'PROVISIONAL MEMORY CANDIDATE',
        id: 'memory:provisional',
        text: cleanText(provisionalMemoryCandidate.text),
        entities: Array.isArray(provisionalMemoryCandidate.entities)
          ? provisionalMemoryCandidate.entities.map(cleanText).filter(Boolean) : [],
        outcome: provisionalMemoryCandidate.outcome == null
          ? null : cleanText(provisionalMemoryCandidate.outcome),
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
  };
}

export function expressiveChoiceModelCall(request) {
  const payload = {
    grounded_current_state: request.groundedDirective || '[UNKNOWN] No grounded Soma state is available.',
    current_or_recent_incident_context: request.currentIncidentContext || '[NONE SUPPLIED]',
    provisional_memory_candidate: request.provisionalMemoryCandidate || '[NONE SUPPLIED]',
    available_expressive_actions: request.availableActions,
    allowed_focus_refs: request.allowedFocusRefs,
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
