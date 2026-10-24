import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  mealChoiceState, mealContext, openMeal, liveMeal, decideMeal, recoverMeals,
} from './meal-choice.js';
import { PRISON_SCHEDULE, chooseMealEvent, materialiseMealConsumption } from './environment.js';
import {
  reconcileLocationRegimeState, reconcileRegimeLocation, startLockdownEpisode,
  advanceLockdownEpisode, canStartScheduledRoutine, awgLocationEligible,
} from './location-regime.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { createSomaRuntime } from './soma-runtime.js';
import { observeEnvironmentRecord } from './grounded-environment-transition.js';

const BASE = Date.parse('2026-10-24T06:30:00Z');
const DATE = '2026-10-24';
const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
const begin = source.indexOf('  function currentMealContext() {');
const end = source.indexOf('  function mealDiagnostic(', begin);
assert.ok(begin >= 0 && end > begin);
// Exercise the actual production projection without importing/starting run.js.
// Only clock, sleep and regime inputs are controlled; restriction logic is not
// copied into a test helper where it could diverge from the deployed path.
const contextFactory = new Function('Date', 'londonParts', 'PRISON_SCHEDULE',
  'currentRegime', 'effectiveAsleep', 'vitals', 'client', 'mealContext',
  `${source.slice(begin, end)}; return currentMealContext;`);
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function londonParts(date) {
  const p = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: +p.hour % 24 * 60 + +p.minute };
}

function fixture({ lockdown = true, available = true, asleep = false } = {}) {
  const world = { now: BASE, asleep, phase: 'unlock_slop' };
  let location = reconcileLocationRegimeState(null, { nowMs: BASE, date: DATE, minutes: 450 });
  if (lockdown) location = startLockdownEpisode(location, {
    nowMs: BASE - 60_000, durationMs: 30 * 60_000,
  }).state;
  const vitals = { locationRegime: location };
  const client = { regime: 'auto' };
  class Clock extends Date { static now() { return world.now; } }
  const context = contextFactory(Clock, londonParts, PRISON_SCHEDULE,
    () => ({ phase: world.phase }), () => world.asleep, vitals, client, mealContext);
  const state = mealChoiceState();
  const episode = openMeal(state, { id: `${DATE}:breakfast`, meal: 'breakfast', available,
    context: context(), availabilityEventId: 'available-breakfast' }).episode;
  const calls = { generate: 0, apply: 0, unknown: 0, snapshots: [] };
  const hooks = {};
  const soma = createSomaRuntime(null, { now: BASE });
  const callbacks = {
    readContext: context,
    checkpoint: async () => {
      calls.snapshots.push(JSON.parse(JSON.stringify(state)));
      await hooks.checkpoint?.(calls.snapshots.length);
    },
    generate: async () => { calls.generate++; return hooks.generate ? hooks.generate() : '{"action":"eat"}'; },
    unknown: () => { calls.unknown++; },
    apply: (current, at) => {
      calls.apply++;
      assert.equal(calls.snapshots.at(-1).episodes[0].phase, 'COMMITTED');
      const built = materialiseMealConsumption(current.meal, current.decision.action, {
        mealId: current.id, availabilityEventId: current.availabilityEventId, decisionId: current.decision.id,
      });
      const record = createEnvironmentRecord(createEnvironmentEvent(built.archetypeId, {
        id: current.effectEventId, timestamp: new Date(at).toISOString(),
        eventType: built.name, world: built.world, observation: built.observation,
      }));
      observeEnvironmentRecord(soma, record);
    },
  };
  return { world, vitals, client, context, state, episode, calls, hooks, soma, callbacks };
}

for (const lockdown of [true, false]) {
  for (const action of ['eat', 'decline']) {
    test(`delivered CELL meal: lockdown=${lockdown}, ${action} commits before its one canonical effect`, async () => {
      const f = fixture({ lockdown });
      const delivery = chooseMealEvent('breakfast', () => 0, { mealId: f.episode.id });
      assert.equal(delivery.world.meal_availability.available, true);
      assert.equal(delivery.world.context.location, 'cell');
      assert.equal(liveMeal(f.episode, f.context()), true);
      f.hooks.generate = () => JSON.stringify({ action });
      assert.equal(await decideMeal(f.state, f.episode, f.callbacks), true);
      assert.equal(f.episode.phase, 'APPLIED');
      assert.deepEqual(f.calls.snapshots.map((s) => s.episodes[0].phase), ['OFFERED', 'COMMITTED', 'APPLIED']);
      assert.deepEqual(f.episode.offeredActions, ['eat', 'decline']);
      assert.equal(f.soma.state.feeding.records.length, 1);
      const intake = f.soma.state.feeding.records[0];
      assert.equal(intake.consumedFraction, action === 'eat' ? 1 : 0);
      assert.equal(intake.intakeOutcome, action === 'eat' ? 'FULLY_CONSUMED' : 'REFUSED');
      assert.equal(intake.consumedEnergyKcal, action === 'eat' ? intake.fullMealEnergyKcal : 0);
      const restored = mealChoiceState(f.state);
      assert.equal(recoverMeals(restored, f.callbacks), false);
      assert.equal(await decideMeal(f.state, f.episode, f.callbacks), false);
      assert.equal(f.calls.generate, 1);
      assert.equal(f.calls.apply, 1);
    });
  }
}

for (const [label, options, patch] of [
  ['sleep', { asleep: true }, () => {}],
  ['unavailable meal', { available: false }, () => {}],
  ['missed delivery', { available: false }, () => {}],
  ['away from food', {}, (f) => { f.vitals.locationRegime.current.id = 'EXERCISE_YARD'; }],
  ['active search', {}, (f) => { f.vitals.locationRegime.searchEpisode = { id: 'search', stage: 'SEARCH_ONGOING' }; }],
  ['active routine', {}, (f) => { f.vitals.locationRegime.activeRoutineEpisode = { id: 'routine', status: 'ACTIVE' }; }],
]) {
  test(`${label} remains ineligible during lockdown`, async () => {
    const f = fixture(options);
    patch(f);
    if (label === 'missed delivery') {
      assert.equal(chooseMealEvent('breakfast', () => 0.95).name, 'breakfast_missed');
    }
    assert.equal(liveMeal(f.episode, f.context()), false);
    assert.equal(await decideMeal(f.state, f.episode, f.callbacks), false);
    assert.equal(f.calls.generate, 0);
    assert.equal(f.calls.apply, 0);
    assert.equal(f.episode.decision, null);
  });
}

for (const change of ['lockdown ends', 'lockdown begins', 'unavailable', 'location', 'sleep',
  'search', 'routine', 'expiry', 'phase', 'owner override', 'cancel']) {
  test(`${change} during inference still discards a returned eat`, async () => {
    const f = fixture({ lockdown: change !== 'lockdown begins' });
    const controller = new AbortController();
    f.hooks.generate = () => {
      if (change === 'lockdown ends') {
        const release = Date.parse(f.vitals.locationRegime.lockdownEpisode.scheduled_release_at);
        f.world.now = release;
        f.vitals.locationRegime = advanceLockdownEpisode(f.vitals.locationRegime, { nowMs: release }).state;
      }
      if (change === 'lockdown begins') {
        f.vitals.locationRegime = startLockdownEpisode(f.vitals.locationRegime, { nowMs: f.world.now }).state;
      }
      if (change === 'unavailable') f.episode.available = false;
      if (change === 'location') f.vitals.locationRegime.current.id = 'EXERCISE_YARD';
      if (change === 'sleep') f.world.asleep = true;
      if (change === 'search') f.vitals.locationRegime.searchEpisode = { id: 'search', stage: 'SEARCH_ONGOING' };
      if (change === 'routine') f.vitals.locationRegime.activeRoutineEpisode = { id: 'routine', status: 'ACTIVE' };
      if (change === 'expiry') f.world.now = f.episode.expiresAt;
      if (change === 'phase') f.world.phase = 'work_assoc';
      if (change === 'owner override') f.client.regime = 'night';
      if (change === 'cancel') controller.abort();
      return '{"action":"eat"}';
    };
    assert.equal(await decideMeal(f.state, f.episode, { ...f.callbacks, signal: controller.signal }), false);
    assert.equal(f.episode.phase, 'NO_DECISION');
    assert.equal(f.episode.failure, 'STALE_OR_CANCELLED_RESULT');
    assert.equal(f.episode.decision, null);
    assert.equal(f.calls.apply, 0);
    assert.equal(f.calls.unknown, 1);
    assert.equal(f.soma.state.feeding.records.length, 0);
  });
}

for (const result of ['', '{"action":"partial"}', null]) {
  test(`invalid/no result ${JSON.stringify(result)} during lockdown preserves unknown consumption`, async () => {
    const f = fixture();
    f.hooks.generate = () => { if (result === null) throw new Error('provider unavailable'); return result; };
    assert.equal(await decideMeal(f.state, f.episode, f.callbacks), false);
    assert.equal(f.episode.failure, 'NO_VALID_PROVIDER_RESULT');
    assert.equal(f.episode.decision, null);
    assert.equal(f.episode.effectEventId, null);
    assert.equal(f.calls.unknown, 1);
    assert.equal(f.calls.apply, 0);
    assert.equal(f.soma.state.feeding.records.length, 0);
    assert.equal(f.soma.state.physiologicalSatiety.intakeHistory.length, 0);
  });
}

test('lockdown release during commit IO still prevents the effect', async () => {
  const f = fixture();
  f.hooks.checkpoint = (number) => {
    if (number === 2) f.vitals.locationRegime.lockdownEpisode.status = 'COMPLETE';
  };
  assert.equal(await decideMeal(f.state, f.episode, f.callbacks), false);
  assert.equal(f.episode.failure, 'STALE_BEFORE_EFFECT');
  assert.equal(f.calls.apply, 0);
  assert.equal(f.calls.unknown, 1);
});

test('a checkpointed commit can recover under the same lockdown without another offer', async () => {
  const f = fixture();
  f.hooks.checkpoint = (number) => {
    if (number === 2) throw new Error('simulated death after persisted commit');
  };
  await assert.rejects(decideMeal(f.state, f.episode, f.callbacks), /simulated death/);
  const restored = mealChoiceState(f.calls.snapshots.at(-1));
  assert.equal(restored.episodes[0].phase, 'COMMITTED');
  assert.equal(f.calls.apply, 0);
  assert.equal(recoverMeals(restored, f.callbacks), true);
  assert.equal(recoverMeals(restored, f.callbacks), false);
  assert.equal(restored.episodes[0].phase, 'APPLIED');
  assert.equal(f.calls.generate, 1);
  assert.equal(f.calls.apply, 1);
  assert.equal(f.calls.unknown, 0);
  assert.equal(f.soma.state.feeding.records.length, 1);
});

test('meal admission does not unlock routines, exercise or unrelated AWG during lockdown', () => {
  const f = fixture();
  assert.equal(liveMeal(f.episode, f.context()), true);
  for (const routine of ['shower', 'phone', 'association']) {
    assert.equal(canStartScheduledRoutine(f.vitals.locationRegime, DATE, routine), false);
  }
  assert.equal(awgLocationEligible(f.vitals.locationRegime), false);
  const reconciled = reconcileRegimeLocation(f.vitals.locationRegime, {
    nowMs: BASE + 7 * 60 * 60_000, date: DATE, minutes: 14 * 60 + 30,
  });
  assert.equal(reconciled.state.current.id, 'CELL');
  assert.equal(reconciled.state.current.regime_activity, 'LOCKDOWN');
  assert.equal(reconciled.state.activeExerciseEpisode, null);
});
