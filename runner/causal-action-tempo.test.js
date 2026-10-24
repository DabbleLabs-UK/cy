import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { InferenceTempoPacer, tempoIdleMs, wakingTempoIdleMs } from './tempo.js';
import { InferenceCoordinator } from './inference-coordinator.js';
import { InferenceWaitTrace } from './inference-wait.js';
import { GenerationCancellationRegistry, abortWithReason, cancellationReason, cancellationError } from './inference-cancellation.js';
import { requireInferenceEligibility } from './dream-regime.js';
import { withAbortTimeout } from './run.js';
import { mealContext, mealChoiceState, openMeal, decideMeal, recoverMeals } from './meal-choice.js';
import { materialiseMealConsumption, mealUnknownConsumption } from './environment.js';
import { createSomaRuntime } from './soma-runtime.js';
import { observeEnvironmentRecord } from './grounded-environment-transition.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';

const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
function functionBody(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last).trim();
}
const waitCode = functionBody('async function waitForInferenceTempo(', '  soma.observe(');
const rawCode = functionBody('async function rawGenerate(', '  function brokerItems(');
const BASE = Date.parse('2026-10-24T15:51:54.083Z');

function fixture() {
  const world = { now: BASE, date: '2026-10-24', phase: 'tea', asleep: false,
    location: { id: 'CELL', entered_at: BASE - 1000, source_event_id: 'cell' },
    restrictionIdentity: ['search', 'AFTERMATH_OBSERVED', 'lockdown', 'ACTIVE', 'auto'],
    nextBoundaryAt: BASE + 60 * 60_000 };
  class Clock extends Date { static now() { return world.now; } }
  const pacer = new InferenceTempoPacer();
  pacer.record(BASE - 124_000, BASE - 3_833, { purpose: 'memory_formation', result: 'aborted' });
  const calls = { sleep: [], provider: [], shared: [], release: 0, checkpoints: [], diagnostics: [], unknown: 0, apply: 0 };
  const hooks = {};
  const registry = new GenerationCancellationRegistry();
  const coordinator = new InferenceCoordinator({ now: () => world.now });
  const provider = {
    model: 'mock-no-inference',
    acquireSharedLease: async (request) => {
      calls.shared.push(request);
      if (hooks.shared) await hooks.shared(request);
      return { profile: { num_ctx: 3072, num_thread: 4 }, release: async () => { calls.release++; } };
    },
    applySharedProfile: (opts, lease) => ({ ...opts, ...lease.profile }),
    rawGenerate: async (request) => {
      calls.provider.push(request);
      if (hooks.provider) return hooks.provider(request);
      return { ok: true, text: '{"action":"eat"}' };
    },
  };
  const env = { Date: Clock, AbortController, DOMException, InferenceWaitTrace,
    generationCancellation: registry, activeProvider: () => provider,
    autobiographicalMemory: null, currentMemoryAbort: null,
    abortWithReason, cancellationReason, cancellationError, inferenceCoordinator: coordinator,
    inferenceMeta: ({ purpose, background, transport }) => ({ purpose, background, transport }),
    requireInferenceEligibility, withAbortTimeout,
    recordSpend: async () => {}, inferenceStats: () => ({}),
    inferenceTempoPacer: pacer, client: { tempo: { speed: 5 } },
    recordInferenceDiagnostic: (record) => calls.diagnostics.push(record),
    recordTempoDiagnostic: () => {}, tempoIdleMs, wakingTempoIdleMs,
    sleep: async (ms) => { calls.sleep.push(ms); world.now += ms; },
  };
  const wait = runInNewContext(`(${waitCode})`, env);
  env.waitForInferenceTempo = wait;
  const raw = runInNewContext(`(${rawCode})`, env);
  const state = mealChoiceState();
  const readContext = () => mealContext({ ...world, nowMs: world.now });
  const episode = openMeal(state, { id: '2026-10-24:tea', meal: 'tea', available: true,
    context: readContext(), availabilityEventId: 'meal-availability' }).episode;
  const soma = createSomaRuntime(null, { now: BASE });
  function observe(built, id) {
    observeEnvironmentRecord(soma, createEnvironmentRecord(createEnvironmentEvent(built.archetypeId, {
      id, timestamp: new Date(world.now).toISOString(), eventType: built.name,
      world: built.world, observation: built.observation,
    })));
  }
  const controller = new AbortController();
  const callbacks = {
    readContext, signal: controller.signal,
    checkpoint: async () => calls.checkpoints.push(JSON.parse(JSON.stringify(state))),
    generate: (call) => raw({ ...call, opts: { num_predict: 80 }, purpose: 'meal_choice',
      timeoutMs: 600_000, signal: controller.signal,
      isEligible: () => {
        const context = readContext();
        return episode.available && !context.asleep && context.location === 'CELL'
          && context.fence === episode.fence && context.nowMs < episode.expiresAt;
      } }),
    apply: (meal) => {
      assert.equal(calls.checkpoints.at(-1).episodes[0].phase, 'COMMITTED');
      calls.apply++;
      observe(materialiseMealConsumption(meal.meal, meal.decision.action, {
        mealId: meal.id, availabilityEventId: meal.availabilityEventId, decisionId: meal.decision.id,
      }), meal.effectEventId);
    },
    unknown: (meal) => { calls.unknown++; observe(mealUnknownConsumption(meal.meal, { mealId: meal.id }), 'unknown-tea'); },
  };
  return { world, env, pacer, wait, raw, calls, hooks, registry, coordinator, controller, state, episode, soma, callbacks };
}

test('bounded causal action and existing human/operator purposes skip only deliberate Tempo quiet', async () => {
  for (const purpose of ['meal_choice', 'postcard', 'warden']) {
    const f = fixture();
    assert.ok(f.pacer.remaining(BASE, 5) > 600_000);
    assert.equal(await f.wait(f.controller.signal, purpose), 0);
    assert.equal(f.calls.sleep.length, 0);
  }
});

for (const purpose of ['journal', 'drawing', 'expressive_choice', 'dream', 'unknown-purpose']) {
  test(`${purpose} retains its existing expressive/generic pacing`, async () => {
    const f = fixture();
    const idleFor = ['journal', 'drawing', 'expressive_choice'].includes(purpose) ? wakingTempoIdleMs : tempoIdleMs;
    const expected = f.pacer.remaining(BASE, 5, idleFor);
    assert.equal(await f.wait(f.controller.signal, purpose), expected);
    assert.equal(f.calls.sleep.reduce((a, b) => a + b, 0), expected);
    assert.ok(expected > 0);
  });
}

test('actual raw transport still waits for its coordinator and shared resource lease', async () => {
  const f = fixture();
  const owner = await f.coordinator.acquire({ purpose: 'postcard', background: false });
  const pending = decideMeal(f.state, f.episode, f.callbacks);
  await nextTurn();
  assert.equal(f.coordinator.owner.record.purpose, 'postcard');
  assert.equal(f.calls.shared.length, 0);
  assert.equal(f.calls.provider.length, 0);
  owner.finish();
  assert.equal(await pending, true);
  assert.equal(f.calls.sleep.length, 0);
  assert.equal(f.calls.shared.length, 1);
  assert.equal(f.calls.shared[0].purpose, 'meal_choice');
  assert.equal(f.calls.shared[0].preemptible, false);
  assert.equal(f.calls.provider[0].opts.num_ctx, 3072);
  assert.equal(f.calls.provider[0].opts.num_thread, 4);
  assert.equal(f.calls.release, 1);
  assert.deepEqual(f.calls.checkpoints.map((s) => s.episodes[0].phase), ['OFFERED', 'COMMITTED', 'APPLIED']);
  assert.equal(recoverMeals(f.state, f.callbacks), false);
  assert.equal(await decideMeal(f.state, f.episode, f.callbacks), false);
  assert.equal(f.calls.apply, 1);
  assert.equal(f.calls.provider.length, 1);
  assert.equal(f.soma.state.feeding.records[0].intakeOutcome, 'FULLY_CONSUMED');
});

for (const stage of ['coordinator', 'arbiter']) {
  test(`wing noise while awaiting ${stage} still cancels to unknown before any model call`, async () => {
    const f = fixture();
    f.registry.register('visible', f.controller, { purpose: 'meal_choice' });
    let owner;
    if (stage === 'coordinator') owner = await f.coordinator.acquire({ purpose: 'postcard', background: false });
    if (stage === 'arbiter') f.hooks.shared = ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(cancellationError(signal)), { once: true });
    });
    const pending = decideMeal(f.state, f.episode, f.callbacks);
    await nextTurn();
    if (stage === 'arbiter') assert.equal(f.calls.shared.length, 1);
    f.registry.abort('visible', 'WING_NOISE_MID');
    assert.equal(await pending, false);
    owner?.finish();
    assert.equal(f.episode.phase, 'NO_DECISION');
    assert.equal(f.calls.provider.length, 0);
    assert.equal(f.calls.apply, 0);
    assert.equal(f.calls.unknown, 1);
    assert.equal(f.soma.state.feeding.records[0].consumedEnergyKcal, null);
    assert.equal(f.soma.state.feeding.records[0].intakeOutcome, 'UNKNOWN');
    assert.equal(f.calls.diagnostics.find((v) => v.event === 'wait').abort_reason, 'WING_NOISE_MID');
  });
}

for (const change of ['sleep', 'location', 'lockdown', 'unavailable']) {
  test(`${change} during actual raw model path still invalidates its returned action`, async () => {
    const f = fixture();
    f.hooks.provider = async () => {
      if (change === 'sleep') f.world.asleep = true;
      if (change === 'location') f.world.location.id = 'EXERCISE_YARD';
      if (change === 'lockdown') f.world.restrictionIdentity[3] = 'COMPLETE';
      if (change === 'unavailable') f.episode.available = false;
      return { ok: true, text: '{"action":"eat"}' };
    };
    assert.equal(await decideMeal(f.state, f.episode, f.callbacks), false);
    assert.equal(f.calls.provider.length, 1);
    assert.equal(f.calls.release, 1);
    assert.equal(f.calls.apply, 0);
    assert.equal(f.calls.unknown, 1);
    assert.equal(f.episode.decision, null);
  });
}

test('an invalid action still yields unknown without repair or repeat inference', async () => {
  const f = fixture();
  f.hooks.provider = async () => ({ ok: true, text: '{"action":"partial"}' });
  assert.equal(await decideMeal(f.state, f.episode, f.callbacks), false);
  assert.equal(await decideMeal(f.state, f.episode, f.callbacks), false);
  assert.equal(f.calls.provider.length, 1);
  assert.equal(f.calls.apply, 0);
  assert.equal(f.calls.unknown, 1);
});

test('meal work still records pacing debt for subsequent expressive requests', async () => {
  const f = fixture();
  f.hooks.provider = async () => { f.world.now += 60_000; return { ok: true, text: '{"action":"eat"}' }; };
  assert.equal(await decideMeal(f.state, f.episode, f.callbacks), true);
  assert.equal(f.pacer.last.purpose, 'meal_choice');
  assert.equal(await f.wait(f.controller.signal, 'journal'), 450_000);
});
