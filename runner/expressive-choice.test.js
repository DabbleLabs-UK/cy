import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildExpressiveChoiceRequest,
  chooseExpressiveAction,
  expressiveChoiceModelCall,
  performExpressiveChoice,
  EXPRESSIVE_CHOICE_CLASSIFICATION,
  EXPRESSIVE_CHOICE_FALLBACK_ACTION,
  EXPRESSIVE_CHOICE_FALLBACK_CLASSIFICATION,
  EXPRESSIVE_CHOICE_MECHANISM,
  EXPRESSIVE_CHOICE_MODEL_OPTIONS,
  EXPRESSIVE_CHOICE_RETRY_COUNT,
  EXPRESSIVE_DRAW_COOLDOWN_MS,
  EXPRESSIVE_SILENCE_COOLDOWN_MS,
} from './expressive-choice.js';
import { INSTRUMENTAL_ACTION_SELECTION } from './instrumental-agency.js';
import { implementationEntry } from './implementation-registry.js';
import { reconcileSoma, recordExpressiveChoice } from './soma.js';
import { prepareSomaGeneration } from './soma-cycle.js';

const groundedContext = {
  schema: 'cy.grounded-prose-context',
  sections: [{
    id: 'defensive',
    title: 'CURRENT DEFENSIVE CONTEXT',
    entries: [{ epistemicStatus: 'OBSERVED FACT', fact: 'active_external_context' }],
  }],
  omitted: [],
};
const groundedDirective = [
  '<GROUNDED_CURRENT_STATE>',
  '- [OBSERVED FACT] current_defensive_context.active_external_context = {"actor":"proctor"}',
  '</GROUNDED_CURRENT_STATE>',
].join('\n');
const base = {
  groundedContext,
  groundedDirective,
  currentIncidentContext: 'INCIDENTS (3 most recent): cell search in progress',
  provisionalMemoryCandidate: {
    sourceEventId: 'env-17',
    sourceTimestamp: '2026-09-10T10:00:00.000Z',
    sourceKind: 'cell_search',
    archivedEventText: 'Proctor moved the blue postcard',
  },
  availableActions: ['journal', 'draw', 'silence'],
};

// A/B/J. Old metrics are not accepted by the request builder. Grounded facts and
// the separately labelled memory candidate are the only Soma/cognitive inputs.
const lowMetrics = buildExpressiveChoiceRequest({
  ...base,
  provisionalMetrics: { anxiety: 0, hunger: 0, fatigue: 0 },
  drives: { expression: 0, rest: 0 },
});
const highMetrics = buildExpressiveChoiceRequest({
  ...base,
  provisionalMetrics: { anxiety: 100, hunger: 100, fatigue: 100 },
  drives: { expression: 1, rest: 1 },
});
assert.deepEqual(highMetrics, lowMetrics, 'A: provisional metrics and drives do not enter expressive choice');
assert.equal(lowMetrics.groundedDirective, groundedDirective, 'B: grounded context reaches chooser request');
assert.equal(lowMetrics.provisionalMemoryCandidate.classification, 'PROVISIONAL MEMORY CANDIDATE',
  'J: heuristic memory is visibly provisional');
assert.deepEqual(lowMetrics.allowedFocusRefs,
  ['grounded:defensive', 'incident:current', 'memory:event:env-17']);
let legacySelectorCalled = false;
const prepared = prepareSomaGeneration({
  tick() {},
  chooseAction() { legacySelectorCalled = true; throw new Error('legacy selector called'); },
  groundedDirective() { return { context: groundedContext, directive: groundedDirective }; },
  provisionalDirective() { return '<PROVISIONAL_RETRIEVAL_CANDIDATE />'; },
  provisionalMemoryCandidate() { return base.provisionalMemoryCandidate; },
}, { now: 1000 });
assert.equal(legacySelectorCalled, false, 'A: pre-language preparation never invokes the legacy selector');
assert.equal(prepared.groundedDirective, groundedDirective);

const call = expressiveChoiceModelCall(lowMetrics);
assert.match(call.system, /subjective character choice, not psychological measurement/i);
assert.match(call.system, /Do not provide reasoning, explanation or chain of thought/i);
assert.match(call.prompt, /GROUNDED_CURRENT_STATE/);
assert.match(call.prompt, /PROVISIONAL MEMORY CANDIDATE/);
assert.doesNotMatch(call.prompt, /"anxiety"|"hunger"|"fatigue"|"drives"/i);
assert.deepEqual(call.options, EXPRESSIVE_CHOICE_MODEL_OPTIONS);

// C. Only a supplied real capability can be selected and focus references are
// restricted to material actually supplied to the chooser.
const valid = await chooseExpressiveAction(lowMetrics, {
  generate: async () => JSON.stringify({
    action: 'draw',
    focusRefs: ['incident:current', 'invented:dead-bird'],
    reasonType: 'anything the model tried to write',
  }),
});
assert.equal(valid.selectedAction, 'draw');
assert.deepEqual(valid.focusRefs, ['incident:current']);
assert.equal(valid.reasonType, 'subjective_character_choice');
assert.equal(valid.selectionMechanism, EXPRESSIVE_CHOICE_MECHANISM);
assert.equal(valid.fallbackUsed, false);

// D/K. Invalid output or a provider failure uses the fixed engineering journal
// fallback, not an emotion, drive, salience or utility calculation.
for (const generate of [
  async () => '{"action":"fight"}',
  async () => 'not json',
  async () => { throw new Error('provider unavailable'); },
]) {
  const fallback = await chooseExpressiveAction(lowMetrics, { generate });
  assert.equal(fallback.selectedAction, EXPRESSIVE_CHOICE_FALLBACK_ACTION);
  assert.equal(fallback.fallbackUsed, true);
  assert.equal(fallback.fallback.classification, EXPRESSIVE_CHOICE_FALLBACK_CLASSIFICATION);
}

// E/F/G. The selected ID dispatches exactly one existing outward path. Silence
// does not invoke journal generation; a fabricated drawing reference is already
// absent before the existing drawing handler receives the choice.
const calls = [];
await performExpressiveChoice({ ...valid, selectedAction: 'journal' }, {
  journal: ({ focusRefs }) => calls.push(['journal', focusRefs]),
  draw: () => calls.push(['draw']),
  silence: () => calls.push(['silence']),
});
await performExpressiveChoice(valid, {
  journal: () => calls.push(['journal']),
  draw: ({ focusRefs }) => calls.push(['draw', focusRefs]),
  silence: () => calls.push(['silence']),
});
await performExpressiveChoice({ ...valid, selectedAction: 'silence' }, {
  journal: () => calls.push(['hidden-journal-generation']),
  draw: () => calls.push(['draw']),
  silence: ({ focusRefs }) => calls.push(['silence', focusRefs]),
});
assert.deepEqual(calls, [
  ['journal', ['incident:current']],
  ['draw', ['incident:current']],
  ['silence', ['incident:current']],
]);

// H. The world-changing instrumental chooser remains the Handoff-8 engineering
// round robin and is not exposed as an expressive choice.
assert.equal(INSTRUMENTAL_ACTION_SELECTION, 'ENGINEERING_ROUND_ROBIN_NOT_PSYCHOLOGICAL');
assert.deepEqual(lowMetrics.availableActions.map((item) => item.id), ['journal', 'draw', 'silence']);

// I. Recording character behaviour changes only the factual last-choice record.
// It cannot update any grounded subsystem as psychological evidence.
const soma = reconcileSoma(null, { now: 1000 });
const groundedBefore = JSON.stringify({
  sleep: soma.sleepHomeostasis,
  circadian: soma.circadianProcessC,
  threat: soma.threatLearning,
  defensive: soma.currentDefensiveContext,
  feeding: soma.feeding,
  controllability: soma.learnedControllability,
  somatic: soma.somaticNociceptive,
  social: soma.socialContact,
});
recordExpressiveChoice(soma, valid, { now: 2000 });
assert.equal(JSON.stringify({
  sleep: soma.sleepHomeostasis,
  circadian: soma.circadianProcessC,
  threat: soma.threatLearning,
  defensive: soma.currentDefensiveContext,
  feeding: soma.feeding,
  controllability: soma.learnedControllability,
  somatic: soma.somaticNociceptive,
  social: soma.socialContact,
}), groundedBefore);
assert.equal(soma.action.score, null);

// L and live wiring. The scientific/grounded action selector remains explicitly
// absent; the subjective layer is implemented; legacy drive choice is not called.
assert.deepEqual(EXPRESSIVE_CHOICE_CLASSIFICATION,
  ['SUBJECTIVE_CHARACTER_LAYER', 'NOT_SCIENTIFIC_PSYCHOLOGICAL_MODEL']);
assert.equal(implementationEntry('soma_subsystems', 'model_mediated_expressive_choice').implementation_status,
  'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'grounded_soma_action_selection').implementation_status,
  'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'grounded_instrumental_action_selection').implementation_status,
  'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'heuristic_drive_expressive_selector').lifecycle_status,
  'DISABLED_LEGACY');
const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
assert.doesNotMatch(runSource, /soma\.chooseAction\(/);
assert.doesNotMatch(runSource, /soma\.completeAction\(/);
assert.match(runSource, /kind: 'expressive_choice'/);
assert.match(runSource, /recordCompletedSilence/);
assert.match(runSource, /doDraw\(\{ cognition, incidentContext \}\)/);

assert.equal(EXPRESSIVE_CHOICE_RETRY_COUNT, 0);
assert.equal(EXPRESSIVE_DRAW_COOLDOWN_MS, 45 * 60 * 1000);
assert.equal(EXPRESSIVE_SILENCE_COOLDOWN_MS, 15 * 60 * 1000);

console.log('expressive-choice.test.js: all checks passed');
