import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import * as incidents from './incidents.js';
import { initialVitals, applyEvent, ampOf, clamp } from './vitals.js';

const BASE = 'd335e0f';
const current = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const old = execFileSync('git', ['show', `${BASE}:runner/run.js`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
const oldIncidentSource = execFileSync('git', ['show', `${BASE}:runner/incidents.js`], { encoding: 'utf8' })
  .replace(/from '(\.\/[^']+)'/g, (_match, path) => `from '${new URL(path, import.meta.url).href}'`);
const oldIncidents = await import('data:text/javascript;base64,' + Buffer.from(oldIncidentSource).toString('base64'));
const AT = Date.parse('2026-10-25T14:00:00.000Z');
function extract(text, start, end) {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `missing runtime boundary: ${start}`);
  return text.slice(first, last).trim();
}

function fixture(text = current, module = incidents, { overheard = false } = {}) {
  const calls = { events: [], captures: [], observations: [], applied: [], neighbors: [] };
  const vitals = initialVitals();
  vitals.ledger = [];
  vitals.locationRegime = { current: { id: 'CELL' }, activeExerciseEpisode: null };
  vitals.mealChoice = { pendingEvents: [] };
  vitals.lastMailMs = AT;
  let randoms = [];
  const maths = Object.create(Math);
  maths.random = () => {
    assert.ok(randoms.length, 'unexpected scheduler random call');
    return randoms.shift();
  };
  class Clock extends Date { static now() { return AT; } }
  const env = { Date: Clock, Math: maths, vitals, console,
    worldSchedulerInFlight: false, dayRolloverInFlight: false,
    prevDate: '2026-10-25', prevMins: 840, firstExerciseTick: false,
    exerciseCheckpointPending: false, EXERCISE_REGIME: { startMinutes: 870, endMinutes: 915 },
    londonParts: () => ({ date: '2026-10-25', mins: 840 }), effectiveAsleep: () => false,
    resolvePendingInstrumentalIncidents: () => {}, checkpointExerciseEvents: async () => {},
    prepareExerciseAdmission: (state) => ({ state, changed: false, events: [] }),
    reconcileExerciseAfterCheckpoint: async ({ reconcile, preparedAtMs }) => { reconcile(preparedAtMs); return { deferred: false }; },
    processLocationRegime: () => {}, advanceCellSearch: () => {}, advanceLockdown: () => {},
    PRISON_SCHEDULE: [], REGIME: [], DEVIATIONS: {}, crossed: () => false,
    expireMeals: () => false, currentMealContext: () => ({}), mealCallbacks: {}, checkpointMeals: async () => {},
    currentRegime: () => ({ phase: 'bangup' }), LOCATIONS: { CELL: 'CELL' },
    maybeWingNoise: () => {}, CELL_SEARCH_TICK_CHANCE: 0.001,
    beginCellSearch: () => calls.neighbors.push('search'), beginLockdown: () => false,
    INMATE_SOCIAL_COMPATIBLE_LOCATION: 'ASSOCIATION', fireSocial: () => calls.neighbors.push('social'),
    fireOfficer: () => calls.neighbors.push('officer'),
    makeIncident: (kind, ctx) => module.makeIncident(kind, { ...ctx, rnd: () => 0.9 }),
    pushIncident: module.pushIncident, incidentLine: module.incidentLine,
    tsNow: () => new Date(AT).toISOString(),
    soma: { observe: (observation) => calls.observations.push(observation) },
    ampOf, clamp,
    applyEvent: (state, name, options) => { calls.applied.push(name); return applyEvent(state, name, options); },
    captureEnvironmentEvent: (archetype, options) => {
      calls.captures.push({ archetype, ...options });
      return { world_event: { id: `test-world-${calls.captures.length}` }, soma_input: { fixture: true } };
    },
    emit: (event) => calls.events.push(event),
    pickOverheard: () => ({ source: 'unknown', heard: 'two quiet voices', mis: 'the wrong words', who: [] }),
    mishearChance: () => 0, overheardCue: null,
  };
  env.recordIncident = runInNewContext(`(${extract(text, 'function recordIncident(', '  // Persist the facts,')})`, env);
  env.structuredEventForName = runInNewContext(`(${extract(text, 'function structuredEventForName(', '  // Capture real postcard/news')})`, env);
  env.fireEvent = runInNewContext(`(${extract(text, 'function fireEvent(', '  function inmateSocialFacts(')})`, env);
  env.fireOverheard = runInNewContext(`(${extract(text, 'function fireOverheard(', '  // Wing noise:')})`, env);
  const scheduler = runInNewContext(`(${extract(text, 'async function scheduler(', '  // ---- vitals tick')})`, env);
  const hasOldProducer = text.includes("const trivial = ['no_eggs', 'cold_tea']");
  return { calls, env, vitals, async tick(index = 0) {
    // Independent random sites are forced explicitly. Both revisions suppress
    // unrelated search/lockdown/officer/texture draws; the old food admission
    // is always selected, alternating its two outcomes. No retired block or
    // its recordIncident/fireEvent callbacks is replaced by a stub.
    randoms = hasOldProducer
      ? [0.9, 0.9, 0, index % 2 ? 0.9 : 0, 0.9, overheard ? 0 : 0.9]
      : [0.9, 0.9, 0.9, overheard ? 0 : 0.9];
    if (overheard) randoms.push(0.9);
    randoms.push(0.9);
    await scheduler(AT + index * 5000);
    assert.equal(randoms.length, 0, 'all declared random sites consumed');
  } };
}

test('pinned production reproduces 100 no-eggs and 100 cold-tea outcomes; retired scheduler emits zero', async () => {
  const control = fixture(old, oldIncidents);
  const retired = fixture();
  for (let i = 0; i < 200; i++) {
    await control.tick(i);
    await retired.tick(i);
  }
  const counts = (f, name) => f.calls.events.filter((event) => event.payload.name === name).length;
  assert.equal(counts(control, 'no_eggs'), 100);
  assert.equal(counts(control, 'cold_tea'), 100);
  assert.equal(control.calls.captures.length, 200);
  assert.equal(control.calls.observations.length, 400);
  assert.equal(control.calls.applied.length, 200);
  assert.equal(retired.calls.events.length, 0);
  assert.equal(retired.calls.captures.length, 0);
  assert.equal(retired.calls.observations.length, 0);
  assert.equal(retired.calls.applied.length, 0);
  assert.deepEqual(retired.vitals.ledger, []);
  console.log('offline control: no_eggs=100 cold_tea=100; candidate: both=0');
});

test('direct retired event mapping cannot create meal/deprivation records', () => {
  const control = fixture(old, oldIncidents);
  const retired = fixture();
  for (const name of ['no_eggs', 'cold_tea']) {
    assert.ok(control.env.structuredEventForName(name));
    assert.equal(retired.env.structuredEventForName(name), null);
  }
  assert.equal(control.calls.captures.length, 2);
  assert.equal(retired.calls.captures.length, 0);
});

test('stale direct trivial incident admission is a no-op, not a replacement texture incident', () => {
  for (const sub of ['no_eggs', 'cold_tea', 'unknown', null]) {
    const f = fixture();
    const before = JSON.stringify(f.vitals);
    assert.equal(incidents.makeIncident('trivial', { sub, rnd: () => 0 }), null);
    assert.equal(f.env.recordIncident('trivial', { sub }), null);
    assert.equal(JSON.stringify(f.vitals), before);
    assert.equal(f.calls.observations.length, 0);
    assert.equal(f.calls.captures.length, 0);
    assert.equal(f.calls.events.length, 0);
  }
});

test('real neighboring overheard path remains reachable with incident, observation and public event', async () => {
  const f = fixture(current, incidents, { overheard: true });
  await f.tick();
  assert.equal(f.calls.events.length, 1);
  assert.equal(f.calls.events[0].payload.name, 'overheard');
  assert.equal(f.calls.captures[0].archetype, 'ambiguous_overheard_remark');
  assert.equal(f.vitals.ledger.length, 1);
  assert.equal(f.calls.observations.length, 1);
  assert.equal(f.calls.observations[0].name, 'overheard');
});

test('historical tray incidents remain readable and are not erased or rewritten', () => {
  const original = ['no_eggs', 'cold_tea'].map((sub) => ({
    ...oldIncidents.makeIncident('trivial', { sub, rnd: () => 0.9 }), ts: '2026-10-24T14:00:00.000Z',
  }));
  const before = JSON.stringify(original);
  const restored = incidents.reconcileLedger(original);
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(restored, original);
  for (let i = 0; i < restored.length; i++) {
    assert.equal(incidents.incidentLine(restored[i]), oldIncidents.incidentLine(original[i]));
  }
  assert.equal(incidents.incidentsDirective(restored, { rnd: () => 0.9 }),
    oldIncidents.incidentsDirective(original, { rnd: () => 0.9 }));
});

test('genuine meal, consumption choice and physiology modules remain byte-identical to production', () => {
  for (const path of ['runner/environment.js', 'runner/meal-choice.js', 'runner/feeding-homeostasis.js',
    'runner/physiological-satiety.js', 'runner/satiety-restart-recovery.js', 'runner/vitals.js']) {
    const baseline = execFileSync('git', ['show', `${BASE}:${path}`]);
    const file = readFileSync(new URL('../' + path, import.meta.url));
    // Git checkout line endings are not runtime behavior; compare source bytes
    // after the repository's normal CRLF checkout conversion only.
    assert.equal(file.toString('utf8').replace(/\r\n/g, '\n'), baseline.toString('utf8').replace(/\r\n/g, '\n'), path);
  }
});
