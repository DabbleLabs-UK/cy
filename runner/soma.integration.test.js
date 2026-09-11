import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as engine from './soma.js';
import { createSomaRuntime } from './soma-runtime.js';
import { prepareSomaGeneration } from './soma-cycle.js';
import { buildDirectives, buildPrompt, options } from './prompt.js';
import { loadVitals, saveVitals, vitalsLoadIssue } from './vitals.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';

const t0 = Date.parse('2026-09-10T12:00:00Z');
let persisted = null;
const runtime = createSomaRuntime(null, {
  now: t0,
  onState: (state) => { persisted = state; },
});
assert.equal(runtime.available, true);
assert.equal(persisted.memory.episodes.length, 0);

const groundedSearch = createEnvironmentRecord(createEnvironmentEvent('cell_search', {
  id: 'env-grounded-search', timestamp: '2026-09-10 12:00:00.000',
  world: { participants: { actor: 'proctor', relationship_ref: 'proctor' } },
}));
runtime.observeThreatLearningRecord(groundedSearch);
assert.equal(runtime.state.threatLearning.pairs['actor:proctor'].COERCIVE_LOSS_OF_CONTROL.alpha, 2);

const currentSearch = createEnvironmentRecord(createEnvironmentEvent('cell_search', {
  id: 'env-current-search', timestamp: '2026-09-10 12:00:01.000', eventType: 'officer_at_cell',
  world: {
    participants: { actor: 'proctor', relationship_ref: 'proctor' },
    situation: { control: 'none', resolution_status: 'unresolved' },
    associative_learning: {
      linkage: 'self_contained_event',
      outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'unknown' }],
    },
    defensive_context: {
      context_id: 'search:integration',
      temporal_status: 'IMMINENT',
      adverse_outcome_classes: ['COERCIVE_LOSS_OF_CONTROL'],
    },
  },
}));
const emotionsBeforeContext = JSON.stringify({
  appraisal: runtime.state.appraisal,
  experienced: runtime.state.experienced,
});
const directiveBeforeContext = runtime.directive();
runtime.observeCurrentDefensiveContextRecord(currentSearch);
assert.equal(runtime.state.currentDefensiveContext.contexts['search:integration|COERCIVE_LOSS_OF_CONTROL'].temporalStatus, 'IMMINENT');
assert.equal(JSON.stringify({ appraisal: runtime.state.appraisal, experienced: runtime.state.experienced }),
  emotionsBeforeContext, 'K: current defensive context does not calculate emotional state');
assert.equal(runtime.directive(), directiveBeforeContext,
  'K: current defensive context does not alter the provisional cognitive directive');
assert.match(runtime.groundedDirective({ now: t0 + 1000 }).directive, /search:integration/,
  'current defensive facts enter the separate grounded directive');

const controllableMeal = createEnvironmentRecord(createEnvironmentEvent('meal', {
  id: 'env-controllable-meal', timestamp: '2026-09-10 12:00:01.500',
  world: {
    action_opportunity: {
      id: 'meal:integration:lunch',
      context_id: 'meal:lunch',
      context_type: 'scheduled_meal',
      available_actions: ['action:accept_meal', 'action:refuse_meal'],
      unavailable_actions: [],
      chosen_action: 'action:accept_meal',
      action_actually_executed: 'action:accept_meal',
      execution_status: 'EXECUTED',
      onset_at: '2026-09-10 11:59:00.000',
      resolved_at: '2026-09-10 12:00:01.500',
      resolution_status: 'RESOLVED',
      linked_event_ids: [],
      outcome_resolution: [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'did_not_occur' }],
    },
  },
}));
const anxietyBeforeControl = JSON.stringify(runtime.state.experienced.metrics.anxiety);
const directiveBeforeControl = runtime.directive();
runtime.observeControllabilityRecord(controllableMeal);
assert.equal(runtime.state.learnedControllability.history.length, 2,
  'both available meal actions receive explicit action/no-action evidence');
assert.equal(JSON.stringify(runtime.state.experienced.metrics.anxiety), anxietyBeforeControl,
  'O: action-outcome evidence does not change provisional Anxiety');
assert.equal(runtime.directive(), directiveBeforeControl,
  'action-outcome evidence does not alter the prompt or action selection');

const groundedMeal = createEnvironmentRecord(createEnvironmentEvent('meal', {
  id: 'env-grounded-meal', timestamp: '2026-09-10 12:00:02.000',
  world: { physical: { food: {
    meal_type: 'lunch', scheduled: 'yes', offered: 'yes', available: 'yes', received: 'yes',
    consumed: 'full', intake_outcome: 'full_consumed', portion_category: 'full', portion_fraction: 1,
  } } },
}));
const hungerBeforeMeal = JSON.stringify(runtime.state.experienced.metrics.hunger);
const directiveBeforeMeal = runtime.directive();
runtime.observeFeedingRecord(groundedMeal);
assert.equal(runtime.state.feeding.lastKnownIntakeEventId, 'env-grounded-meal');
assert.equal(JSON.stringify(runtime.state.experienced.metrics.hunger), hungerBeforeMeal,
  'grounded ingestion does not modify the provisional Hunger value');
assert.equal(runtime.directive(), directiveBeforeMeal,
  'grounded ingestion does not alter the provisional cognitive directive');
assert.match(runtime.groundedDirective({ now: t0 + 2000 }).directive, /FULLY_CONSUMED/,
  'grounded intake enters the separate factual directive without a Hunger claim');

runtime.observe({
  name: 'cell_search',
  text: 'Mr Locke searched the cell and moved the blue postcard',
  tags: ['officer', 'search'],
  entities: ['Mr Locke'],
  outcome: 'blue postcard moved',
  environmentEventId: 'env-search-1',
}, { now: t0 + 1000 });
assert.equal(runtime.state.memory.episodes.length, 1);

runtime.observe({
  name: 'cell_search',
  text: 'Mr Locke moved the blue postcard again',
  tags: ['officer', 'search'],
  entities: ['Mr Locke'],
  outcome: 'blue postcard moved',
  environmentEventId: 'env-search-2',
}, { now: t0 + 2000 });
runtime.observe({
  name: 'cell_search',
  text: 'Mr Locke searched around the blue postcard',
  tags: ['officer', 'search'],
  entities: ['Mr Locke'],
  outcome: 'blue postcard moved',
  environmentEventId: 'env-search-3',
}, { now: t0 + 3000 });
runtime.observe({
  name: 'postcard',
  text: 'Jody sent the blue postcard back through the door',
  tags: ['mail', 'postcard'],
  entities: ['Jody'],
  outcome: 'postcard received',
  environmentEventId: 'env-postcard-1',
}, { now: t0 + 4000 });

assert.ok(runtime.state.prediction.error >= 0.6);
assert.ok(runtime.state.memory.selectedId, 'related later event selected an older episode');

runtime.tick({
  physical: { pain: 0.1, hunger: 0.7, fatigue: 0.82 },
  monotony: 0.3,
  asleep: false,
  lastMailMs: t0 + 4000,
  now: t0 + 5000,
});
const generation = prepareSomaGeneration(runtime, {
  canDraw: false,
  now: t0 + 6000,
  inputs: {
    physical: { pain: 0.1, hunger: 0.7, fatigue: 0.82 },
    monotony: 0.3,
    asleep: false,
    lastMailMs: t0 + 4000,
    now: t0 + 6000,
  },
});
const vitals = { cognition: runtime.state };
const zoneC = buildDirectives(vitals, 'journal', {
  groundedSoma: generation.groundedDirective,
  provisionalCognition: generation.provisionalDirective,
});
const prompt = buildPrompt('', 'journal', null, zoneC);
assert.match(prompt, /<GROUNDED_CURRENT_STATE>/);
assert.match(prompt, /<PROVISIONAL_RETRIEVAL_CANDIDATE>/);
assert.doesNotMatch(prompt, /output action selected:/);
assert.match(prompt, /source event: env-search-/);
assert.match(prompt, /archived event material:/);
assert.doesNotMatch(prompt, /was expected next/i);
assert.ok(prompt.indexOf('<GROUNDED_CURRENT_STATE>') > prompt.indexOf('ONE THING'));

const appraisalBeforeOutput = { ...runtime.state.appraisal };
const threatBeforeOutput = JSON.stringify(runtime.state.threatLearning);
const defensiveBeforeOutput = JSON.stringify(runtime.state.currentDefensiveContext);
const feedingBeforeOutput = JSON.stringify(runtime.state.feeding);
const controllabilityBeforeOutput = JSON.stringify(runtime.state.learnedControllability);
const somaticBeforeOutput = JSON.stringify(runtime.state.somaticNociceptive);
const socialBeforeOutput = JSON.stringify(runtime.state.socialContact);
runtime.observeOutput('locke and the blue postcard again. i will not forget it.', { mode: 'journal', now: t0 + 7000 });
assert.deepEqual(runtime.state.appraisal, appraisalBeforeOutput, 'own prose did not become an external event');
assert.equal(JSON.stringify(runtime.state.threatLearning), threatBeforeOutput, 'own prose did not update threat learning');
assert.equal(JSON.stringify(runtime.state.currentDefensiveContext), defensiveBeforeOutput,
  'own prose did not create a current defensive context');
assert.equal(JSON.stringify(runtime.state.feeding), feedingBeforeOutput,
  'own prose did not create feeding or deprivation evidence');
assert.equal(JSON.stringify(runtime.state.learnedControllability), controllabilityBeforeOutput,
  'K: own prose did not create an action opportunity or action-outcome evidence');
assert.equal(JSON.stringify(runtime.state.somaticNociceptive), somaticBeforeOutput,
  'own prose did not create or intensify a somatic record');
assert.equal(JSON.stringify(runtime.state.socialContact), socialBeforeOutput,
  'own prose did not create a social-contact record');
assert.ok(runtime.state.expression.themes.includes('locke') || runtime.state.expression.themes.includes('postcard'));

const persistenceDir = await mkdtemp(join(tmpdir(), 'cy-soma-persist-'));
let restarted;
try {
  const vitalsPath = join(persistenceDir, 'vitals.json');
  const diskVitals = await loadVitals(vitalsPath);
  diskVitals.cognition = JSON.parse(JSON.stringify(persisted));
  await saveVitals(vitalsPath, diskVitals);
  const loadedVitals = await loadVitals(vitalsPath);
  restarted = createSomaRuntime(loadedVitals.cognition, { now: t0 + 8000 });
} finally {
  await rm(persistenceDir, { recursive: true, force: true });
}
assert.equal(restarted.available, true);
assert.equal(restarted.state.memory.episodes.length, runtime.state.memory.episodes.length);
assert.equal(restarted.state.memory.selectedId, runtime.state.memory.selectedId);
assert.equal(restarted.state.expression.lastText, runtime.state.expression.lastText);
assert.deepEqual(restarted.state.threatLearning, runtime.state.threatLearning);
assert.deepEqual(restarted.state.currentDefensiveContext, runtime.state.currentDefensiveContext);
assert.deepEqual(restarted.state.feeding.records, runtime.state.feeding.records);
assert.deepEqual(restarted.state.learnedControllability, runtime.state.learnedControllability,
  'L: action opportunities and exact posteriors survive restart');
assert.equal(restarted.state.feeding.lastKnownIntakeEventId, runtime.state.feeding.lastKnownIntakeEventId);
assert.equal(restarted.state.feeding.unknownIntervals.at(-1).ingestionAssumption, 'NONE_MADE');

const failures = [];
const broken = createSomaRuntime(null, {
  now: t0,
  engine: {
    ...engine,
    observeSoma() { throw new Error('instrumented update failure'); },
  },
  logger: { error() {} },
  onFailure: (failure) => failures.push(failure),
});
broken.observe({ name: 'cell_search' }, { now: t0 + 1 });
assert.equal(broken.available, false);
assert.equal(broken.directive(), '');
assert.equal(broken.snapshot().status, 'unavailable');
assert.match(broken.snapshot().reason, /instrumented update failure/);
assert.match(prepareSomaGeneration(broken).groundedDirective, /No grounded Soma state is available/);
assert.equal(prepareSomaGeneration(broken).provisionalMemoryCandidate, null);
assert.equal(failures.length, 1);
assert.deepEqual(
  Object.fromEntries(Object.entries(options({ cognition: broken.state }, 2, 'journal')).filter(([key]) => !['stop', 'num_ctx', 'num_thread'].includes(key))),
  { temperature: 0.72, top_p: 0.86, repeat_penalty: 1.18, repeat_last_n: 160, num_predict: 62 },
);

const temp = await mkdtemp(join(tmpdir(), 'cy-soma-'));
try {
  const badVitalsPath = join(temp, 'vitals.json');
  await writeFile(badVitalsPath, '{not json');
  const badVitals = await loadVitals(badVitalsPath);
  assert.match(vitalsLoadIssue(badVitals), /could not be parsed/);
  await access(badVitalsPath + '.invalid.bak');
  const badLoadRuntime = createSomaRuntime(badVitals.cognition, {
    initialFailure: vitalsLoadIssue(badVitals),
    logger: { error() {} },
  });
  assert.equal(badLoadRuntime.snapshot().status, 'unavailable');
} finally {
  await rm(temp, { recursive: true, force: true });
}

const scenario = {
  afterLivedEvents: {
    episodes: runtime.state.memory.episodes.filter((episode) => episode.kind === 'lived_event').length,
    attention: runtime.state.attention.text,
    selectedMemory: engine.somaSnapshot(runtime.state).memory.selected.text,
    prediction: engine.somaSnapshot(runtime.state).prediction,
  },
  journal: {
    groundedSomaContext: generation.groundedDirective,
    provisionalCognitiveContext: generation.provisionalDirective,
  },
  afterOwnOutput: {
    expression: engine.somaSnapshot(runtime.state).expression,
    appraisalUnchanged: true,
  },
  restart: {
    episodes: restarted.state.memory.episodes.length,
    selectedMemoryId: restarted.state.memory.selectedId,
  },
  failure: broken.snapshot(),
};

console.log('soma.integration.test.js: all checks passed');
console.log(`SOMA_SCENARIO ${JSON.stringify(scenario)}`);
