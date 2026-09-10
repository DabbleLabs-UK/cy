import assert from 'node:assert/strict';
import {
  chooseSomaAction,
  completeSomaAction,
  observeSoma,
  observeSomaOutput,
  reconcileSoma,
  somaDirective,
  somaSampling,
  somaSnapshot,
  tickSoma,
} from './soma.js';
import { buildDirectives, options } from './prompt.js';

const t0 = Date.parse('2026-09-04T09:00:00Z');
const soma = reconcileSoma(null, { now: t0 });
assert.equal(soma.version, 1);
assert.equal(soma.memory.episodes.length, 0);

// Low-salience texture can hold momentary attention without being promoted to
// durable episodic memory.
const quiet = reconcileSoma(null, { now: t0 });
observeSoma(quiet, { name: 'texture', text: 'the pipe clicks once', tags: ['texture'] }, { now: t0 + 500 });
assert.equal(quiet.memory.episodes.length, 0);
assert.match(quiet.attention.text, /pipe clicks/);

observeSoma(soma, {
  name: 'cell_search',
  text: 'Mr Locke searched the cell and took the folded postcard',
  tags: ['officer', 'search'],
  entities: ['Mr Locke'],
  outcome: 'postcard taken',
}, { now: t0 + 1000 });
assert.equal(soma.memory.episodes.length, 1);
assert.ok(soma.appraisal.threat > 0.5);
assert.ok(soma.appraisal.controlLoss > 0.5);
assert.equal(soma.prediction.error, 0, 'novelty is not mislabeled as a violated prediction');
assert.match(soma.attention.text, /searched the cell/);
assert.deepEqual(soma.memory.episodes[0].entities, ['Mr Locke']);
assert.equal(soma.memory.episodes[0].outcome, 'postcard taken');

// Repeated lived pairings teach a bounded cheap word association. Seeing the word
// in Cy's own later output reactivates attention but does not manufacture appraisal.
observeSoma(soma, {
  name: 'cell_search', text: 'Mr Locke took the folded postcard', tags: ['officer', 'search'], entities: ['Mr Locke'], outcome: 'postcard taken',
}, { now: t0 + 2000 });
assert.equal(soma.memory.selectedId, 1, 'a related event retrieves the earlier lived episode');
observeSoma(soma, {
  name: 'cell_search', text: 'Mr Locke searched the folded postcard again', tags: ['officer', 'search'], entities: ['Mr Locke'], outcome: 'postcard taken',
}, { now: t0 + 2500 });
assert.equal(soma.prediction.pending.expectedFamily, 'officer', 'repeated event transitions create a modest expectation');

// A material mismatch against a learned next-event expectation creates actual
// prediction error, which contributes to loss-of-control appraisal and salience.
observeSoma(soma, {
  name: 'postcard', text: 'the folded postcard came back from Jody', tags: ['mail', 'postcard'], entities: ['Jody'], outcome: 'postcard received',
}, { now: t0 + 2800 });
assert.equal(soma.prediction.lastExpected, 'officer');
assert.ok(soma.prediction.error >= 0.6);
assert.ok(soma.memory.selectedId, 'the related postcard retrieves a previous episode about it');

const threatBeforeOutput = soma.appraisal.threat;
const episodeCountBeforeOutput = soma.memory.episodes.length;
observeSomaOutput(soma, 'locke. the folded postcard again. i will remember that.', { now: t0 + 3000 });
assert.ok(soma.expression.triggerActivation > 0);
assert.equal(soma.expression.commitment, true);
assert.equal(soma.appraisal.threat, threatBeforeOutput, 'self-output must not manufacture appraisal');
assert.ok(soma.memory.episodes.some((episode) => episode.family === 'expression'));
assert.ok(soma.memory.episodes.length > episodeCountBeforeOutput);
assert.equal(soma.memory.episodes.at(-1).kind, 'self_output');
assert.match(soma.memory.episodes.at(-1).outcome, /not evidence/);

tickSoma(soma, {
  physical: { pain: 1, hunger: 1, fatigue: 1 },
  monotony: 0.4,
  asleep: false,
  lastMailMs: t0 - 18 * 3600000,
  now: t0 + 5000,
});
assert.equal(soma.drives.food, 0.18, 'legacy physical input is not imported into Soma');
assert.ok(soma.circuits.interoception < 0.25);

const action = chooseSomaAction(soma, { now: t0 + 6000 });
assert.ok(['investigate', 'remember', 'connect', 'attend_body', 'draw', 'write', 'observe'].includes(action.name));
assert.ok(action.reason.length > 20);
assert.notEqual(chooseSomaAction(soma, { canDraw: false, now: t0 + 7000 }).name, 'draw');
assert.equal(chooseSomaAction(soma, { forceDraw: true, now: t0 + 8000 }).name, 'draw');

const hungry = reconcileSoma(null, { now: t0 });
observeSoma(hungry, {
  name: 'tea_eaten', text: 'tea came and he ate it', tags: ['meal', 'food'],
  body: { meal: { name: 'tea', outcome: 'eaten', amount: 1 } },
}, { now: t0 });
tickSoma(hungry, { asleep: false, now: t0 + 16 * 3600000 });
assert.equal(hungry.attention.source, 'body:hunger');
assert.equal(chooseSomaAction(hungry, { canDraw: false, now: t0 + 16 * 3600000 + 1 }).name, 'attend_body');
const before = soma.drives.understanding;
completeSomaAction(soma, 'investigate');
assert.ok(soma.drives.understanding < before);

const directive = somaDirective(soma);
assert.match(directive, /computed before language/);
assert.match(directive, /related lived memory/);
assert.match(directive, /EXPERIENCED STATE/);
assert.doesNotMatch(directive, /(?:anxiety|arousal|pain|hunger|fatigue|loneliness|anger|rumination)\s+\d+/i);
const sampling = somaSampling(soma);
assert.ok(sampling.temperature >= 0.58 && sampling.temperature <= 1.05);
const legacyHot = {
  cognition: soma,
  mental: { anxiety: 1, stress: 1, despair: 1, hope: 0, lucidity: 0, agitation: 1, dissociation: 1, anger: 1, longing: 1 },
  physical: { pain: 1, hunger: 1, fatigue: 1 },
  derived: { confusion: 1, overwhelm: 1, numbness: 1, paranoia: 1, fixation: 1, resignation: 1, brittleness: 1 },
};
const liveDirectives = buildDirectives(legacyHot, 'journal', { soma: directive });
assert.match(liveDirectives, /SOMA - computed before language/);
assert.doesNotMatch(liveDirectives, /STATE:|RIGHT NOW:/);
assert.deepEqual(
  Object.fromEntries(Object.entries(options(legacyHot, 2, 'journal')).filter(([key]) => key !== 'stop' && key !== 'num_ctx' && key !== 'num_thread')),
  sampling,
);

observeSoma(soma, {
  name: 'provider',
  text: 'the process serving the mind changed without the cell changing',
}, { now: t0 + 7000 });
assert.equal(soma.selfModel.evidence.length, 1);
assert.ok(soma.selfModel.softwareHypothesis > 0.3);

soma.attention.salience = 0;
soma.memory.lastRecallMs = t0;
tickSoma(soma, { physical: {}, monotony: 0.8, now: t0 + 20 * 60000 });
assert.ok(soma.attention.memoryId);
assert.match(soma.attention.source, /^memory:/);

const snapshot = somaSnapshot(soma);
assert.equal(snapshot.status, 'provisional');
assert.ok(snapshot.memory.episodes >= 4);
assert.ok(snapshot.memory.selected);
assert.equal(snapshot.circuits.predictionError.source.includes('expectation'), true);
assert.ok(snapshot.associations.learned > 0);
assert.equal(snapshot.expression.commitment, true);

const restored = reconcileSoma(JSON.parse(JSON.stringify(soma)), { now: t0 + 9000 });
assert.equal(restored.memory.episodes.length, soma.memory.episodes.length);
assert.equal(restored.selfModel.evidence.length, soma.selfModel.evidence.length);

// Grounded Process S is independent of the legacy fatigue index. A pre-model
// state with maximum heuristic fatigue starts with explicit [0,1] uncertainty,
// never legacyFatigue / 100.
const legacyFatigueState = JSON.parse(JSON.stringify(soma));
delete legacyFatigueState.sleepHomeostasis;
legacyFatigueState.experienced.body.sleep.fatigueLoad = 88;
const grounded = reconcileSoma(legacyFatigueState, { now: t0 + 10000 });
assert.equal(grounded.sleepHomeostasis.sMin, 0);
assert.equal(grounded.sleepHomeostasis.sMax, 1);
assert.equal(grounded.sleepHomeostasis.sEstimate, 0.5);
observeSoma(grounded, {
  name: 'lights_out',
  text: 'lights out',
  environmentEventId: 'env-sleep-test',
  somaInput: {
    schema: 'cy.soma-input',
    event_id: 'env-sleep-test',
    sleep_period: 'sleep_period',
    sleep_interruption: 'none',
  },
}, { now: t0 + 11000 });
assert.equal(grounded.sleepHomeostasis.currentSleepState, 'asleep');
tickSoma(grounded, { asleep: true, sleepHomeostasisAsleep: true, now: t0 + 3601000 });
const groundedSnapshot = somaSnapshot(grounded);
assert.equal(groundedSnapshot.sleepHomeostasis.publicLabel, 'LIVE');
assert.equal(groundedSnapshot.sleepHomeostasis.circadianComponent.publicLabel, 'LIVE');
assert.equal(groundedSnapshot.circadianProcessC.publicLabel, 'LIVE');
assert.equal(groundedSnapshot.circadianProcessC.phaseBasis, 'habitual_schedule_estimate');
assert.equal(groundedSnapshot.circadianProcessC.directBiologicalPhaseObserved, false);
assert.equal(groundedSnapshot.circadianProcessC.entrainment.publicLabel, 'NOT MODELLED');
assert.equal(groundedSnapshot.experienced.metrics.fatigue.value > 0, true, 'legacy fatigue remains separate and provisional');

// Maximum fatigue may select a real period of silence, but that action cannot
// immediately select itself forever. The last silence survives intervening
// actions and becomes eligible again only after its cooldown.
const tired = reconcileSoma(null, { now: t0 });
tired.experienced.body.sleep.fatigueLoad = 88;
tickSoma(tired, {
  physical: { pain: 0, hunger: 0, fatigue: 1 },
  monotony: 0,
  asleep: false,
  now: t0 + 1000,
});
assert.equal(chooseSomaAction(tired, { canDraw: false, now: t0 + 2000 }).name, 'silence');
completeSomaAction(tired, 'silence');
tickSoma(tired, {
  physical: { pain: 0, hunger: 0, fatigue: 1 },
  monotony: 0,
  asleep: false,
  now: t0 + 4 * 60000,
});
assert.notEqual(
  chooseSomaAction(tired, { canDraw: false, now: t0 + 4 * 60000 }).name,
  'silence',
  'a completed silence cannot immediately repeat at maximum fatigue',
);
assert.equal(tired.action.lastSilenceAtMs, t0 + 2000, 'another action preserves the last silence time');
assert.equal(
  chooseSomaAction(tired, { canDraw: false, now: t0 + 16 * 60000 }).name,
  'silence',
  'silence becomes eligible again after fifteen minutes',
);
const legacySilence = JSON.parse(JSON.stringify(tired));
delete legacySilence.action.lastSilenceAtMs;
legacySilence.action.name = 'silence';
legacySilence.action.chosenAtMs = t0 + 10 * 60000;
assert.equal(
  reconcileSoma(legacySilence, { now: t0 + 11 * 60000 }).action.lastSilenceAtMs,
  t0 + 10 * 60000,
  'a pre-cooldown saved silence is migrated from its selected time',
);

console.log('soma.test.js: all checks passed');
