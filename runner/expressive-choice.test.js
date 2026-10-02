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
  EXPRESSIVE_DRAW_MIN_JOURNALS,
  EXPRESSIVE_DRAW_MAX_JOURNALS,
  EXPRESSIVE_DRAW_OPPORTUNITY_MIN_MS,
  EXPRESSIVE_DRAW_OPPORTUNITY_SPREAD_MS,
  EXPRESSIVE_DRAW_RETRY_BASE_MS,
  EXPRESSIVE_DRAW_RETRY_MAX_MS,
  EXPRESSIVE_SILENCE_COOLDOWN_MS,
  eligibleExpressionGap,
  expressiveCadenceAvailability,
  reconcileExpressiveCadence,
  recordExpressiveDrawing,
  recordExpressiveDrawingFailure,
  recordExpressiveJournal,
  recordExpressiveOpportunity,
} from './expressive-choice.js';
import { availableExpressiveActions, LOCATIONS } from './location-regime.js';
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
assert.equal(EXPRESSIVE_SILENCE_COOLDOWN_MS, 15 * 60 * 1000);

// M. A sketch gets both the existing journal-count opportunity and an independent
// stochastic time opportunity. Neither a due sketch nor repeated failed sketches
// can remove journal from the available actions.
let cadence = reconcileExpressiveCadence(null);
assert.deepEqual(cadence, {
  journalsSinceDraw: 0,
  nextDrawOpportunityAtMs: 0,
  drawRetryNotBeforeMs: 0,
  consecutiveDrawFailures: 0,
  lastOpportunityAtMs: 0,
  lastPublishedAtMs: 0,
});
for (let count = 0; count < EXPRESSIVE_DRAW_MIN_JOURNALS; count++) {
  assert.deepEqual(expressiveCadenceAvailability(cadence, { nowMs: 1000 }), {
    journal: true,
    draw: false,
    phase: 'JOURNAL_INTERVAL',
  });
  cadence = recordExpressiveJournal(cadence, { nowMs: 1000 + count });
}
for (let count = EXPRESSIVE_DRAW_MIN_JOURNALS; count < EXPRESSIVE_DRAW_MAX_JOURNALS; count++) {
  assert.deepEqual(expressiveCadenceAvailability(cadence, { nowMs: 1000 }), {
    journal: true,
    draw: true,
    phase: 'DRAW_ELIGIBLE',
  });
  cadence = recordExpressiveJournal(cadence, { nowMs: 1000 + count });
}
assert.deepEqual(expressiveCadenceAvailability(cadence, { nowMs: 1000 }), {
  journal: true,
  draw: true,
  phase: 'DRAW_PREFERRED',
});
cadence = recordExpressiveDrawingFailure(cadence, { nowMs: 1000 });
assert.equal(cadence.drawRetryNotBeforeMs, 1000 + EXPRESSIVE_DRAW_RETRY_BASE_MS);
assert.deepEqual(expressiveCadenceAvailability(JSON.parse(JSON.stringify(cadence)),
  { nowMs: 1001 }), expressiveCadenceAvailability(cadence, { nowMs: 1001 }),
  'drawing cooldown survives checkpoint-style JSON round trips');
assert.deepEqual(expressiveCadenceAvailability(cadence, { nowMs: 1001 }), {
  journal: true, draw: false, phase: 'DRAW_COOLDOWN',
});
assert.deepEqual(availableExpressiveActions({ current: { id: LOCATIONS.CELL } },
  expressiveCadenceAvailability(cadence, { nowMs: 1001 })), ['journal', 'silence']);
assert.deepEqual(availableExpressiveActions({ current: { id: LOCATIONS.CELL } },
  expressiveCadenceAvailability(cadence, { nowMs: 1001 }), { silenceAvailable: false }), ['journal'],
  'after a failed drawing and a prolonged gap, the next available form is journal prose');
for (let failure = 2; failure <= 12; failure++) {
  cadence = recordExpressiveDrawingFailure(cadence, { nowMs: 1000 * failure });
  assert.equal(expressiveCadenceAvailability(cadence, { nowMs: 1000 * failure }).journal, true);
}
assert.equal(cadence.consecutiveDrawFailures, 10);
assert.equal(cadence.drawRetryNotBeforeMs, 12000 + EXPRESSIVE_DRAW_RETRY_MAX_MS);
assert.equal(expressiveCadenceAvailability(cadence,
  { nowMs: cadence.drawRetryNotBeforeMs }).draw, true);
cadence = recordExpressiveDrawing(cadence, { nowMs: 100000, random: () => 0.5 });
assert.equal(cadence.journalsSinceDraw, 0);
assert.equal(cadence.consecutiveDrawFailures, 0);
assert.equal(cadence.drawRetryNotBeforeMs, 0);
assert.equal(cadence.nextDrawOpportunityAtMs,
  100000 + EXPRESSIVE_DRAW_OPPORTUNITY_MIN_MS + EXPRESSIVE_DRAW_OPPORTUNITY_SPREAD_MS / 2);
assert.equal(cadence.lastPublishedAtMs, 100000,
  'a successful sketch preserves the waking publication clock');
assert.equal(expressiveCadenceAvailability(cadence,
  { nowMs: cadence.nextDrawOpportunityAtMs - 1 }).draw, false);
assert.deepEqual(expressiveCadenceAvailability(cadence,
  { nowMs: cadence.nextDrawOpportunityAtMs }), {
  journal: true, draw: true, phase: 'DRAW_PREFERRED',
});
assert.equal(recordExpressiveDrawing(cadence, { nowMs: 100000, random: () => 0 })
  .nextDrawOpportunityAtMs, 100000 + EXPRESSIVE_DRAW_OPPORTUNITY_MIN_MS);
assert.equal(recordExpressiveDrawing(cadence, { nowMs: 100000, random: () => 1 })
  .nextDrawOpportunityAtMs,
  100000 + EXPRESSIVE_DRAW_OPPORTUNITY_MIN_MS + EXPRESSIVE_DRAW_OPPORTUNITY_SPREAD_MS);
assert.equal(reconcileExpressiveCadence({ journalsSinceDraw: 999 }).journalsSinceDraw,
  EXPRESSIVE_DRAW_MAX_JOURNALS);
assert.equal(reconcileExpressiveCadence({ journalsSinceDraw: -4 }).journalsSinceDraw, 0);

// N. An overdue eligible gap removes chosen silence, but never fabricates a
// world incident, changes a model setting or forces an invalid text candidate.
const eligibleSinceMs = 1000;
const afterTenMinutes = eligibleSinceMs + 10 * 60 * 1000 + 1;
assert.equal(eligibleExpressionGap({ nowMs: afterTenMinutes,
  eligibleSinceMs, tempoSpeed: 30 }).prolonged, true);
assert.equal(eligibleExpressionGap({ nowMs: afterTenMinutes,
  eligibleSinceMs, tempoSpeed: 10 }).prolonged, false);
assert.equal(eligibleExpressionGap({ nowMs: eligibleSinceMs + 3 * 60 * 1000,
  eligibleSinceMs, tempoSpeed: 100 }).prolonged, true);
assert.equal(eligibleExpressionGap({ nowMs: afterTenMinutes,
  eligibleSinceMs: 0, tempoSpeed: 30 }).prolonged, false);
assert.equal(eligibleExpressionGap({ nowMs: afterTenMinutes,
  eligibleSinceMs, lastPublishedMs: afterTenMinutes - 1000,
  tempoSpeed: 30 }).prolonged, false);
cadence = recordExpressiveOpportunity(cadence, { nowMs: afterTenMinutes });
assert.equal(JSON.parse(JSON.stringify(cadence)).lastOpportunityAtMs, afterTenMinutes,
  'the next-opportunity clock survives a checkpoint/reload round trip');
assert.equal(reconcileExpressiveCadence(JSON.parse(JSON.stringify(cadence))).lastPublishedAtMs,
  cadence.lastPublishedAtMs, 'the publication clock survives a checkpoint/reload round trip');
const gapRequest = buildExpressiveChoiceRequest({
  ...base,
  drawingPhase: 'DRAW_PREFERRED',
  prolongedEligibleGap: true,
  currentIncidentContext: '',
});
const gapPrompt = expressiveChoiceModelCall(gapRequest).prompt;
assert.match(gapPrompt, /prolonged_eligible_waking_gap":true/);
assert.doesNotMatch(gapPrompt, /silence remains valid/i);
assert.match(gapPrompt, /Do not invent an external event/i);
assert.deepEqual(gapRequest.availableActions.map((action) => action.id), ['journal', 'draw', 'silence']);
assert.equal(gapRequest.currentIncidentContext, null);
assert.deepEqual(availableExpressiveActions({ current: { id: LOCATIONS.EXERCISE_YARD } },
  expressiveCadenceAvailability(cadence, { nowMs: cadence.nextDrawOpportunityAtMs })), []);
assert.match(runSource, /if \(asleep\) \{[\s\S]*?await dreamStep\(mins\);[\s\S]*?continue;/);
assert.ok(runSource.indexOf('if (pendingWarden.length) {') < runSource.indexOf('const cadence = expressiveCadenceAvailability'));
assert.ok(runSource.indexOf('if (pendingPostcards.length) {') < runSource.indexOf('const cadence = expressiveCadenceAvailability'));
assert.match(runSource, /if \(client\.regime === 'day'\) return false;/);
assert.match(runSource, /lastPublishedWakingExpressionMs = Date\.now\(\)/);
assert.match(runSource, /recordExpressiveDrawingFailure\(vitals\.expressiveCadence\)/);
assert.match(runSource, /logDrawFail\('unusable', line\);[\s\S]*?recordExpressiveDrawingFailure/);
assert.match(runSource, /logDrawFail\('empty', baseRaw\);[\s\S]*?recordExpressiveDrawingFailure/);
assert.match(runSource, /logDrawFail\('unusable', baseRaw\);[\s\S]*?recordExpressiveDrawingFailure/);
assert.match(runSource, /eligibleExpressionGap\(\{/);
assert.match(runSource, /const MAX_DISCARDS = 2;/);
assert.match(runSource, /recordExpressiveJournal\(vitals\.expressiveCadence, \{/);
assert.match(runSource, /recordExpressiveDrawing\(vitals\.expressiveCadence\)/);
assert.match(runSource, /silenceAvailable: silenceAvailable && !expressionGap\.prolonged/,
  'an overdue waking gap cannot be prolonged by repeated model-chosen silences');

console.log('expressive-choice.test.js: all checks passed');
