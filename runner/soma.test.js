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

observeSoma(soma, {
  name: 'cell_search',
  text: 'Mr Locke searched the cell and took the folded postcard',
  tags: ['officer', 'search'],
}, { now: t0 + 1000 });
assert.equal(soma.memory.episodes.length, 1);
assert.ok(soma.appraisal.threat > 0.5);
assert.ok(soma.appraisal.controlLoss > 0.5);
assert.ok(soma.prediction.error > 0.5);
assert.match(soma.attention.text, /searched the cell/);

// Repeated lived pairings teach a bounded cheap word association. Seeing the word
// in Cy's own later output reactivates attention but does not manufacture appraisal.
observeSoma(soma, { name: 'cell_search', text: 'Mr Locke took the folded postcard', tags: ['officer', 'search'] }, { now: t0 + 2000 });
const threatBeforeOutput = soma.appraisal.threat;
observeSomaOutput(soma, 'locke. the folded thing again. i will remember that.', { now: t0 + 3000 });
assert.ok(soma.expression.triggerActivation > 0);
assert.equal(soma.expression.commitment, true);
assert.equal(soma.appraisal.threat, threatBeforeOutput, 'self-output must not manufacture appraisal');
assert.ok(soma.memory.episodes.some((episode) => episode.family === 'expression'));

tickSoma(soma, {
  physical: { pain: 0.2, hunger: 0.8, fatigue: 0.35 },
  monotony: 0.4,
  asleep: false,
  lastMailMs: t0 - 18 * 3600000,
  now: t0 + 5000,
});
assert.equal(soma.drives.food, 0.8);
assert.ok(soma.circuits.interoception >= 0.8);
assert.ok(soma.circuits.memoryRecall > 0);

const action = chooseSomaAction(soma, { now: t0 + 6000 });
assert.ok(['investigate', 'remember', 'connect', 'draw', 'write', 'observe'].includes(action.name));
assert.ok(action.reason.length > 20);
assert.notEqual(chooseSomaAction(soma, { canDraw: false, now: t0 + 7000 }).name, 'draw');
assert.equal(chooseSomaAction(soma, { forceDraw: true, now: t0 + 8000 }).name, 'draw');
const before = soma.drives.understanding;
completeSomaAction(soma, 'investigate');
assert.ok(soma.drives.understanding < before);

const directive = somaDirective(soma);
assert.match(directive, /computed before language/);
assert.doesNotMatch(directive, /anxiety|despair|STATE:/i);
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
assert.equal(snapshot.status, 'implemented');
assert.ok(snapshot.memory.episodes >= 4);
assert.equal(snapshot.circuits.predictionError.source.includes('expectation'), true);
assert.ok(snapshot.associations.learned > 0);
assert.equal(snapshot.expression.commitment, true);

const restored = reconcileSoma(JSON.parse(JSON.stringify(soma)), { now: t0 + 9000 });
assert.equal(restored.memory.episodes.length, soma.memory.episodes.length);
assert.equal(restored.selfModel.evidence.length, soma.selfModel.evidence.length);

console.log('soma.test.js: all checks passed');
