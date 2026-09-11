import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTONOMOUS_SILENCE_SECONDS } from './run.js';
import {
  buildDirectives,
  buildPrompt,
  options,
} from './prompt.js';
import {
  buildExpressiveChoiceRequest,
  chooseExpressiveAction,
} from './expressive-choice.js';
import { mishearChance, OVERHEARD_AMBIGUOUS_VARIANT_CHANCE } from './cast.js';
import { moodSnapshot, resolveRequest } from './draw.js';
import {
  observeSomaOutput,
  provisionalCognitiveDirective,
  provisionalMemoryCandidate,
  reconcileSoma,
  somaSnapshot,
} from './soma.js';
import { INSTRUMENTAL_ACTION_SELECTION } from './instrumental-agency.js';

const NOW = Date.parse('2026-09-11T18:00:00.000Z');
const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');

function traceableMemoryState() {
  const state = reconcileSoma(null, { now: NOW });
  state.memory.episodes = [{
    id: 7,
    kind: 'lived_event',
    name: 'cell_search',
    text: 'Mr Proctor searched the cell and took the folded postcard',
    ts: '2026-09-11T17:00:00.000Z',
    sourceType: 'structured_environment_event',
    sourceEventId: 'world-event-7',
    heuristicSummary: 'Cy knows Proctor hates him',
  }];
  state.memory.selectedId = 7;
  state.memory.selectedActivation = 0.9;
  return state;
}

// A. Silence uses one fixed engineering interval, not provisional Rest.
assert.equal(AUTONOMOUS_SILENCE_SECONDS, 45);
assert.doesNotMatch(runSource, /45\s*\+\s*180/);
assert.doesNotMatch(runSource, /AUTONOMOUS_SILENCE_SECONDS\s*[*+/-]/);

// B. All eight provisional visitor metrics are absent from prompt, expressive
// choice inputs and timing. Waking generation options remain fixed as well.
const calm = reconcileSoma(null, { now: NOW });
const extreme = reconcileSoma(JSON.parse(JSON.stringify(calm)), { now: NOW });
for (const metric of Object.values(extreme.experienced.metrics)) metric.value = 100;
extreme.drives.rest = 1;
extreme.drives.food = 1;
extreme.appraisal.threat = 1;
extreme.circuits.attention = 1;
assert.equal(buildDirectives({ cognition: calm }, 'journal'), buildDirectives({ cognition: extreme }, 'journal'));
assert.deepEqual(options(calm, 4, 'journal'), options(extreme, 4, 'journal'));
const choiceArgs = {
  groundedContext: { sections: [] },
  groundedDirective: '<GROUNDED_CURRENT_STATE>same facts</GROUNDED_CURRENT_STATE>',
  currentIncidentContext: 'the same real incident',
  availableActions: ['journal', 'draw', 'silence'],
};
assert.equal(Object.keys(extreme.experienced.metrics).length, 8);
assert.deepEqual(
  buildExpressiveChoiceRequest({ ...choiceArgs, provisionalExperiencedState: calm.experienced }),
  buildExpressiveChoiceRequest({ ...choiceArgs, provisionalExperiencedState: extreme.experienced }),
);
assert.equal(AUTONOMOUS_SILENCE_SECONDS, 45);

// C/D. The only live provisional memory form is exact material traceable to a
// structured environment event. A heuristic interpretation is not emitted.
const remembered = traceableMemoryState();
const candidate = provisionalMemoryCandidate(remembered);
assert.deepEqual(candidate, {
  classification: 'PROVISIONAL MEMORY CANDIDATE',
  sourceEventId: 'world-event-7',
  sourceTimestamp: '2026-09-11T17:00:00.000Z',
  sourceKind: 'cell_search',
  archivedEventText: 'Mr Proctor searched the cell and took the folded postcard',
});
const memoryDirective = provisionalCognitiveDirective(remembered);
assert.match(memoryDirective, /source event: world-event-7/);
assert.match(memoryDirective, /archived event material: Mr Proctor searched the cell/);
assert.doesNotMatch(memoryDirective, /hates him/);
assert.equal(buildExpressiveChoiceRequest({
  ...choiceArgs,
  provisionalMemoryCandidate: { heuristicSummary: 'Cy knows Proctor hates him' },
}).provisionalMemoryCandidate, null);

// E/F. Numeric attention and learned-word associations remain inspectable but
// cannot leave Soma as live prompt or action-selection context.
const diagnosticOnly = reconcileSoma(null, { now: NOW });
diagnosticOnly.attention = {
  memoryId: null,
  text: 'force this topic',
  source: 'heuristic',
  salience: 1,
  sinceMs: NOW,
  tokens: ['force'],
  entities: [],
};
diagnosticOnly.associations.force = {
  threat: 1,
  affiliation: 1,
  deprivation: 1,
  controlLoss: 1,
  exposures: 999,
  lastSeenMs: NOW,
};
assert.equal(provisionalCognitiveDirective(diagnosticOnly), '');
assert.doesNotMatch(buildDirectives({ cognition: diagnosticOnly }, 'journal'), /force this topic|salience|999/);

// G. Generated wording can update expression diagnostics but cannot create a
// memory, move attention, choose an action, or mutate any grounded substrate.
const outputState = reconcileSoma(null, { now: NOW });
const beforeOutput = somaSnapshot(outputState);
observeSomaOutput(outputState, 'PROCTOR PROCTOR. i am starving. keep repeating this.', { now: NOW + 1000 });
const afterOutput = somaSnapshot(outputState);
assert.deepEqual(afterOutput.sleepHomeostasis, beforeOutput.sleepHomeostasis);
assert.deepEqual(afterOutput.circadianProcessC, beforeOutput.circadianProcessC);
assert.deepEqual(afterOutput.threatLearning, beforeOutput.threatLearning);
assert.deepEqual(afterOutput.currentDefensiveContext, beforeOutput.currentDefensiveContext);
assert.deepEqual(afterOutput.feeding, beforeOutput.feeding);
assert.deepEqual(afterOutput.learnedControllability, beforeOutput.learnedControllability);
assert.deepEqual(afterOutput.somaticNociceptive, beforeOutput.somaticNociceptive);
assert.deepEqual(afterOutput.socialContact, beforeOutput.socialContact);
assert.deepEqual(afterOutput.memory, beforeOutput.memory);
assert.deepEqual(afterOutput.attention, beforeOutput.attention);
assert.deepEqual(afterOutput.action, beforeOutput.action);

// H. Ambiguity/mishearing is a fixed fictional-world probability.
assert.equal(mishearChance({ predictionError: 0, uncertainty: 0 }), OVERHEARD_AMBIGUOUS_VARIANT_CHANCE);
assert.equal(mishearChance({ predictionError: 1, uncertainty: 1 }), OVERHEARD_AMBIGUOUS_VARIANT_CHANCE);

// I. Once DRAW is chosen, provisional emotional metrics do not alter the
// explicit requested subject or the renderer compatibility snapshot.
const request = { subject: 'the exercise yard', visitor_id: 'visitor-1' };
assert.deepEqual(resolveRequest(request, calm), resolveRequest(request, extreme));
assert.deepEqual(moodSnapshot(calm), moodSnapshot(extreme));
assert.doesNotMatch(runSource, /\bdrawDecision\s*\(/);

// J/K. Bounded recent prose remains in Zone B and grounded current state remains
// in Zone C; neither is replaced by heuristic scalar claims.
const prompt = buildPrompt('what i actually wrote recently', 'journal', null,
  '<GROUNDED_CURRENT_STATE>factual state</GROUNDED_CURRENT_STATE>');
assert.match(prompt, /what i actually wrote recently/);
assert.match(prompt, /<GROUNDED_CURRENT_STATE>factual state/);

// L. Handoff-12 model-mediated expressive choice still selects an available
// action without a heuristic score.
const expressiveRequest = buildExpressiveChoiceRequest(choiceArgs);
const expressive = await chooseExpressiveAction(expressiveRequest, {
  generate: async () => JSON.stringify({
    action: 'draw',
    focusRefs: ['incident:current'],
    reasonType: 'subjective_character_choice',
  }),
});
assert.equal(expressive.selectedAction, 'draw');
assert.equal(expressive.selectionMechanism, 'MODEL-MEDIATED SUBJECTIVE CHARACTER CHOICE');

// M. The Handoff-8 instrumental world-action selector remains the declared
// engineering round-robin mechanism.
assert.equal(INSTRUMENTAL_ACTION_SELECTION, 'ENGINEERING_ROUND_ROBIN_NOT_PSYCHOLOGICAL');

// Source-level guards for formerly live legacy helpers.
assert.doesNotMatch(runSource, /\bchooseSomaAction\s*\(/);
assert.doesNotMatch(runSource, /\bgrudgeDirective\s*\(/);
assert.doesNotMatch(runSource, /\bcastForPrompt\s*\(/);
assert.doesNotMatch(runSource, /\bamplifiedDirective\s*\(/);
assert.doesNotMatch(runSource, /mishearChance\s*\([^)]*(?:soma|vitals|prediction|uncertainty)/);

console.log('behavioural-leakage.test.js: all checks passed');
