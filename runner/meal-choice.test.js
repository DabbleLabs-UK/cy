import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MEAL_ACTIONS, MEAL_CHOICE_FORMAT, mealChoiceState, mealContext, liveMeal,
  openMeal, mealModelCall, parseMealChoice, decideMeal, applyCommittedMeal,
  closeMealWithoutDecision, expireMeals, recoverMeals, stageMealEvent,
  acknowledgeMealEvents, flushMealEvents,
} from './meal-choice.js';
import { chooseMealEvent, materialiseMealConsumption, mealUnknownConsumption } from './environment.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { createSomaRuntime } from './soma-runtime.js';
import { observeEnvironmentRecord } from './grounded-environment-transition.js';
import { Client } from './client.js';

const BASE = Date.parse('2026-10-23T06:30:00Z');
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture(raw = null) {
  const state = mealChoiceState(raw);
  const world = {
    nowMs: BASE, date: '2026-10-23', phase: 'day', asleep: false,
    location: { id: 'CELL', entered_at: BASE - 1000, source_event_id: 'env-cell' },
    nextBoundaryAt: BASE + 60_000,
  };
  const snapshots = [];
  const calls = { checkpoint: 0, generate: [], apply: [], unknown: [], diagnostic: [] };
  const hooks = {};
  const callbacks = {
    readContext: () => mealContext(world),
    checkpoint: async () => {
      calls.checkpoint++;
      await hooks.checkpoint?.(calls.checkpoint);
      snapshots.push(clone(state));
    },
    generate: async (request) => {
      calls.generate.push(request);
      return hooks.generate ? hooks.generate(request) : '{"action":"eat"}';
    },
    apply: (episode) => {
      calls.apply.push(episode.id);
      return hooks.apply?.(episode);
    },
    unknown: (episode) => {
      calls.unknown.push(episode.id);
      hooks.unknown?.(episode);
    },
    diagnostic: (...args) => calls.diagnostic.push(args),
  };
  const open = (options = {}) => openMeal(state, {
    id: '2026-10-23:breakfast', meal: 'breakfast', available: true,
    availabilityEventId: 'env-availability', context: callbacks.readContext(), ...options,
  });
  return { state, world, snapshots, calls, hooks, callbacks, open };
}

function committed(f, options = {}) {
  const episode = f.open(options).episode;
  episode.offeredAt = new Date(BASE).toISOString();
  episode.offeredActions = [...MEAL_ACTIONS];
  episode.decision = { id: `decision:${episode.id}`, mealId: episode.id,
    action: 'eat', committedAt: new Date(BASE).toISOString() };
  episode.effectEventId = `env-effect:${episode.id}`;
  episode.phase = 'COMMITTED';
  return episode;
}

function recordFor(built, id, now = BASE) {
  return createEnvironmentRecord(createEnvironmentEvent(built.archetypeId, {
    id, timestamp: new Date(now).toISOString(), eventType: built.name,
    world: built.world, observation: built.observation,
  }));
}

test('meal checkpoints round-trip independently and reject unknown formats', () => {
  const f = fixture();
  f.open();
  stageMealEvent(f.state, { delivery_id: 'receipt-1', payload: { id: 'env-1' } });
  const restored = mealChoiceState(f.state);
  assert.deepEqual(restored, f.state);
  restored.episodes[0].meal = 'tea';
  restored.pendingEvents[0].payload.id = 'changed';
  assert.equal(f.state.episodes[0].meal, 'breakfast');
  assert.equal(f.state.pendingEvents[0].payload.id, 'env-1');
  for (const invalid of [{}, { ...f.state, version: 2 }, { ...f.state, pendingEvents: null }]) {
    assert.throws(() => mealChoiceState(invalid), /Unrecognised meal-choice checkpoint/);
  }
});

test('available and unavailable episodes retain the first availability fact without rerolling', async () => {
  const f = fixture();
  const first = f.open();
  assert.equal(first.created, true);
  assert.equal(first.episode.phase, 'AVAILABLE');
  const duplicate = f.open({ available: false, availabilityEventId: 'replacement' });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.episode, first.episode);
  assert.equal(duplicate.episode.available, true);
  assert.equal(duplicate.episode.availabilityEventId, 'env-availability');
  const unavailable = f.open({ id: '2026-10-23:lunch', meal: 'lunch', available: false }).episode;
  assert.equal(unavailable.phase, 'UNAVAILABLE');
  assert.equal(await decideMeal(f.state, unavailable, f.callbacks), false);
  assert.equal(f.calls.generate.length, 0);
  assert.equal(f.calls.apply.length, 0);
  assert.equal(f.calls.unknown.length, 0);
});

test('live permission is fenced by time, day, location, sleep, regime and restriction identity', () => {
  const f = fixture();
  const { episode } = f.open();
  assert.equal(liveMeal(episode, f.callbacks.readContext()), true);
  for (const patch of [
    { nowMs: BASE - 1 }, { nowMs: episode.expiresAt }, { date: '2026-10-24' },
    { asleep: true }, { restricted: true }, { restrictionIdentity: 'new-restriction' },
    { phase: 'night' }, { location: { ...f.world.location, id: 'YARD' } },
    { location: { ...f.world.location, entered_at: BASE } },
    { location: { ...f.world.location, source_event_id: 'another-entry' } },
  ]) {
    assert.equal(liveMeal(episode, mealContext({ ...f.world, ...patch })), false, JSON.stringify(patch));
  }
});

test('the bounded model request has exactly eat/decline and no invented ingredients', () => {
  const f = fixture();
  const request = mealModelCall(f.open({ meal: 'supper_snack' }).episode, {
    bodily: 'Possible stomach fullness: full.', location: 'cell', regime: 'day',
  });
  assert.equal(request.format, MEAL_CHOICE_FORMAT);
  assert.deepEqual(request.format.properties.action.enum, ['eat', 'decline']);
  assert.equal(request.format.additionalProperties, false);
  const prompt = JSON.parse(request.prompt);
  assert.match(prompt.present, /supper snack.*available/);
  assert.match(prompt.present, /No specific ingredients/);
  assert.deepEqual(Object.keys(prompt.choices), ['eat', 'decline']);
  assert.equal(prompt.body, 'Possible stomach fullness: full.');
});

test('only an exact supported JSON action is accepted', () => {
  assert.equal(parseMealChoice('{"action":"eat"}'), 'eat');
  assert.equal(parseMealChoice(' {"action":"decline"}\n'), 'decline');
  for (const text of ['eat', 'null', '[]', '[{"action":"eat"}]', '{}',
    '{"action":"EAT"}', '{"action":"partial"}', '{"action":"eat","story":"ate"}',
    '```json\n{"action":"eat"}\n```', 'I ate the meal.']) {
    assert.equal(parseMealChoice(text), null, text);
  }
});

for (const action of MEAL_ACTIONS) {
  test(`${action} is offered once and persisted before its single effect`, async () => {
    const f = fixture();
    const { episode } = f.open();
    f.hooks.generate = () => {
      assert.equal(f.snapshots.at(-1).episodes[0].phase, 'OFFERED');
      assert.deepEqual(f.snapshots.at(-1).episodes[0].offeredActions, ['eat', 'decline']);
      return JSON.stringify({ action });
    };
    f.hooks.apply = (current) => {
      const durable = f.snapshots.at(-1).episodes[0];
      assert.equal(durable.phase, 'COMMITTED');
      assert.deepEqual(durable.decision, current.decision);
      assert.equal(durable.effectEventId, current.effectEventId);
    };
    assert.equal(await decideMeal(f.state, episode, f.callbacks), true);
    assert.deepEqual(f.snapshots.map((snapshot) => snapshot.episodes[0].phase), ['OFFERED', 'COMMITTED', 'APPLIED']);
    assert.equal(episode.decision.action, action);
    assert.equal(episode.decision.mealId, episode.id);
    assert.ok(episode.decision.id);
    assert.ok(episode.effectEventId);
    assert.equal(await decideMeal(f.state, episode, f.callbacks), false);
    assert.equal(applyCommittedMeal(episode, f.callbacks), false);
    assert.equal(f.calls.generate.length, 1);
    assert.deepEqual(f.calls.apply, [episode.id]);
    assert.equal(f.calls.unknown.length, 0);
  });
}

test('concurrent offers cannot create a second provider call', async () => {
  const f = fixture();
  const { episode } = f.open();
  let finish;
  f.hooks.generate = () => new Promise((resolve) => { finish = resolve; });
  const pending = decideMeal(f.state, episode, f.callbacks);
  assert.equal(await decideMeal(f.state, episode, f.callbacks), false);
  while (!finish) await Promise.resolve();
  finish('{"action":"eat"}');
  assert.equal(await pending, true);
  assert.equal(f.calls.generate.length, 1);
  assert.equal(f.calls.apply.length, 1);
});

for (const [label, generate] of [
  ['provider failure', () => { throw new Error('provider unavailable'); }],
  ['invalid JSON', () => 'I ate it.'],
  ['unsupported action', () => '{"action":"partial"}'],
  ['extra provider fields', () => '{"action":"eat","explanation":"hungry"}'],
]) {
  test(`${label} records unknown intake without fabricating a choice`, async () => {
    const f = fixture();
    const { episode } = f.open();
    f.hooks.generate = generate;
    assert.equal(await decideMeal(f.state, episode, f.callbacks), false);
    assert.equal(episode.phase, 'NO_DECISION');
    assert.equal(episode.failure, 'NO_VALID_PROVIDER_RESULT');
    assert.equal(episode.decision, null);
    assert.equal(episode.effectEventId, null);
    assert.equal(f.calls.apply.length, 0);
    assert.deepEqual(f.calls.unknown, [episode.id]);
    assert.equal(closeMealWithoutDecision(episode, 'retry', f.callbacks), false);
    assert.equal(await decideMeal(f.state, episode, f.callbacks), false);
    assert.equal(f.calls.generate.length, 1);
    assert.equal(f.calls.unknown.length, 1);
  });
}

test('stale permission before the offer never calls the provider', async () => {
  const f = fixture();
  const { episode } = f.open();
  f.world.asleep = true;
  assert.equal(await decideMeal(f.state, episode, f.callbacks), false);
  assert.equal(episode.failure, 'STALE_BEFORE_OFFER');
  assert.equal(f.calls.generate.length, 0);
  assert.equal(f.snapshots.at(-1).episodes[0].phase, 'NO_DECISION');
});

test('a cancelled offer checkpoints unknown intake without inference', async () => {
  const f = fixture();
  const { episode } = f.open();
  const controller = new AbortController();
  controller.abort();
  assert.equal(await decideMeal(f.state, episode, { ...f.callbacks, signal: controller.signal }), false);
  assert.equal(episode.failure, 'STALE_BEFORE_INFERENCE');
  assert.equal(f.calls.generate.length, 0);
  assert.equal(f.calls.apply.length, 0);
  assert.deepEqual(f.calls.unknown, [episode.id]);
});

for (const reason of ['time', 'sleep', 'location', 'regime', 'restriction', 'cancel']) {
  test(`${reason} change while generating discards the returned action`, async () => {
    const f = fixture();
    const { episode } = f.open();
    const controller = new AbortController();
    f.hooks.generate = () => {
      if (reason === 'time') f.world.nowMs = episode.expiresAt;
      if (reason === 'sleep') f.world.asleep = true;
      if (reason === 'location') f.world.location = { ...f.world.location, id: 'YARD' };
      if (reason === 'regime') f.world.phase = 'night';
      if (reason === 'restriction') f.world.restricted = true;
      if (reason === 'cancel') controller.abort();
      return '{"action":"eat"}';
    };
    assert.equal(await decideMeal(f.state, episode, { ...f.callbacks, signal: controller.signal }), false);
    assert.equal(episode.failure, 'STALE_OR_CANCELLED_RESULT');
    assert.equal(episode.decision, null);
    assert.equal(f.calls.apply.length, 0);
    assert.equal(f.calls.unknown.length, 1);
  });
}

for (const checkpointNumber of [1, 2]) {
  test(`permission expiring during checkpoint ${checkpointNumber} prevents a later effect`, async () => {
    const f = fixture();
    const { episode } = f.open();
    f.hooks.checkpoint = (number) => {
      if (number === checkpointNumber) f.world.nowMs = episode.expiresAt;
    };
    assert.equal(await decideMeal(f.state, episode, f.callbacks), false);
    assert.equal(episode.failure, checkpointNumber === 1 ? 'STALE_BEFORE_INFERENCE' : 'STALE_BEFORE_EFFECT');
    assert.equal(f.calls.generate.length, checkpointNumber - 1);
    assert.equal(f.calls.apply.length, 0);
    assert.equal(f.calls.unknown.length, 1);
  });
}

for (const boundary of ['offer', 'result', 'commit']) {
  test(`losing admission at ${boundary} prevents a consumption effect`, async () => {
    const f = fixture();
    const { episode } = f.open();
    let admitted = true;
    f.hooks.checkpoint = (number) => {
      if ((boundary === 'offer' && number === 1) || (boundary === 'commit' && number === 2)) admitted = false;
    };
    f.hooks.generate = () => {
      if (boundary === 'result') admitted = false;
      return '{"action":"eat"}';
    };
    assert.equal(await decideMeal(f.state, episode, { ...f.callbacks, isAdmitted: () => admitted }), false);
    assert.equal(episode.phase, 'NO_DECISION');
    assert.equal(f.calls.apply.length, 0);
    assert.equal(f.calls.unknown.length, 1);
    assert.equal(f.calls.generate.length, boundary === 'offer' ? 0 : 1);
  });
}

test('concurrent expiration during a commit checkpoint cannot apply or close twice', async () => {
  const f = fixture();
  const { episode } = f.open();
  f.hooks.checkpoint = (number) => {
    if (number !== 2) return;
    f.world.nowMs = episode.expiresAt;
    assert.equal(expireMeals(f.state, f.callbacks.readContext(), f.callbacks), true);
  };
  assert.equal(await decideMeal(f.state, episode, f.callbacks), false);
  assert.equal(episode.phase, 'NO_DECISION');
  assert.equal(expireMeals(f.state, f.callbacks.readContext(), f.callbacks), false);
  assert.equal(f.calls.apply.length, 0);
  assert.deepEqual(f.calls.unknown, [episode.id]);
});

test('a committed decision recovers once without another model offer', () => {
  const f = fixture();
  const original = committed(f);
  const restarted = fixture(f.state);
  assert.equal(recoverMeals(restarted.state, restarted.callbacks), true);
  assert.equal(recoverMeals(restarted.state, restarted.callbacks), false);
  assert.equal(restarted.state.episodes[0].phase, 'APPLIED');
  assert.deepEqual(restarted.calls.apply, [original.id]);
  assert.equal(restarted.calls.generate.length, 0);
  assert.equal(restarted.calls.unknown.length, 0);
});

for (const phase of ['AVAILABLE', 'OFFERED']) {
  test(`restart with ${phase} and no durable commit never resends inference`, async () => {
    const f = fixture();
    f.open().episode.phase = phase;
    const restarted = fixture(f.state);
    assert.equal(recoverMeals(restarted.state, restarted.callbacks), true);
    const episode = restarted.state.episodes[0];
    assert.equal(episode.failure, 'RESTART_WITHOUT_APPLICABLE_COMMIT');
    assert.equal(await decideMeal(restarted.state, episode, restarted.callbacks), false);
    assert.equal(restarted.calls.generate.length, 0);
    assert.equal(restarted.calls.apply.length, 0);
    assert.deepEqual(restarted.calls.unknown, [episode.id]);
  });
}

test('a committed decision cannot recover after its opportunity expires', () => {
  const f = fixture();
  const episode = committed(f);
  f.world.nowMs = episode.expiresAt;
  assert.equal(recoverMeals(f.state, f.callbacks), true);
  assert.equal(episode.phase, 'NO_DECISION');
  assert.equal(f.calls.apply.length, 0);
  assert.equal(f.calls.unknown.length, 1);
});

test('replaying meal A decision on meal B cannot consume meal B', () => {
  const f = fixture();
  const a = committed(f);
  const b = committed(f, { id: '2026-10-23:lunch', meal: 'lunch' });
  b.decision = clone(a.decision);
  assert.equal(applyCommittedMeal(b, f.callbacks), false);
  assert.equal(f.calls.apply.length, 0);
  assert.equal(recoverMeals(f.state, f.callbacks), true);
  assert.deepEqual(f.calls.apply, [a.id]);
  assert.equal(b.phase, 'NO_DECISION');
  assert.deepEqual(f.calls.unknown, [b.id]);
});

test('offer and commit checkpoint failures prevent inference or effects beyond durable state', async () => {
  for (const failureAt of [1, 2]) {
    const f = fixture();
    const { episode } = f.open();
    f.hooks.checkpoint = (number) => {
      if (number === failureAt) throw new Error('checkpoint failed');
    };
    await assert.rejects(decideMeal(f.state, episode, f.callbacks), /checkpoint failed/);
    assert.equal(f.calls.generate.length, failureAt - 1);
    assert.equal(f.calls.apply.length, 0);
    assert.equal(f.snapshots.length, failureAt - 1);
    assert.equal(await decideMeal(f.state, episode, f.callbacks), false);
    assert.equal(f.calls.generate.length, failureAt - 1);
    if (failureAt === 2) {
      assert.equal(episode.phase, 'COMMITTED');
      assert.equal(episode.decision.action, 'eat');
      const restarted = fixture(f.snapshots[0]);
      recoverMeals(restarted.state, restarted.callbacks);
      assert.equal(restarted.calls.apply.length, 0);
      assert.equal(restarted.calls.unknown.length, 1);
      await f.callbacks.checkpoint();
      const recoveredCommit = fixture(f.snapshots.at(-1));
      assert.equal(recoverMeals(recoveredCommit.state, recoveredCommit.callbacks), true);
      assert.equal(recoverMeals(recoveredCommit.state, recoveredCommit.callbacks), false);
      assert.deepEqual(recoveredCommit.calls.apply, [episode.id]);
      assert.equal(recoveredCommit.calls.generate.length, 0);
      assert.equal(f.calls.generate.length, 1);
    }
  }
});

test('a failed final checkpoint is retried without repeating its in-memory effect', async () => {
  const f = fixture();
  const { episode } = f.open();
  f.hooks.checkpoint = (number) => {
    if (number === 3) throw new Error('final checkpoint failed');
  };
  await assert.rejects(decideMeal(f.state, episode, f.callbacks), /final checkpoint failed/);
  assert.equal(episode.phase, 'APPLIED');
  await f.callbacks.checkpoint();
  assert.equal(recoverMeals(f.state, f.callbacks), false);
  assert.equal(await decideMeal(f.state, episode, f.callbacks), false);
  assert.equal(f.calls.apply.length, 1);
  assert.equal(f.snapshots.at(-1).episodes[0].phase, 'APPLIED');
});

test('pending event receipts survive restart, enqueue once per process and acknowledge exact deliveries', async () => {
  const f = fixture();
  const first = stageMealEvent(f.state, { delivery_id: 'delivery-a', payload: { id: 'event-a' } });
  stageMealEvent(f.state, first);
  const second = stageMealEvent(f.state, { payload: { id: 'event-b' } });
  assert.ok(second.delivery_id);
  assert.equal(f.state.pendingEvents.length, 2);
  const enqueued = new Set();
  const sent = [];
  const flush = () => flushMealEvents(f.state, {
    checkpoint: f.callbacks.checkpoint, enqueued,
    enqueue: (event) => {
      assert.deepEqual(f.snapshots.at(-1).pendingEvents, f.state.pendingEvents);
      sent.push(event);
    },
  });
  await flush();
  await flush();
  assert.equal(sent.length, 2);
  const restarted = fixture(f.snapshots.at(-1));
  assert.deepEqual(restarted.state.pendingEvents, [first, second]);
  assert.equal(acknowledgeMealEvents(restarted.state, [{ delivery_id: 'unrelated' }]), false);
  assert.equal(acknowledgeMealEvents(restarted.state, [first]), true);
  assert.deepEqual(restarted.state.pendingEvents, [second]);
  assert.equal(acknowledgeMealEvents(restarted.state, [first]), false);
  const resent = [];
  await flushMealEvents(restarted.state, {
    checkpoint: restarted.callbacks.checkpoint, enqueue: (event) => resent.push(event), enqueued: new Set(),
  });
  assert.deepEqual(resent, [second]);
});

test('a failed outbox checkpoint never enqueues an unpersisted event', async () => {
  const f = fixture();
  stageMealEvent(f.state, { delivery_id: 'delivery-a', payload: { id: 'event-a' } });
  const sent = [];
  const enqueued = new Set();
  await assert.rejects(flushMealEvents(f.state, {
    checkpoint: async () => { throw new Error('outbox checkpoint failed'); },
    enqueue: (event) => sent.push(event), enqueued,
  }), /outbox checkpoint failed/);
  assert.deepEqual(sent, []);
  assert.equal(enqueued.size, 0);
  assert.equal(f.state.pendingEvents.length, 1);
});

test('events appended during an outbox checkpoint wait for the next durable flush', async () => {
  const f = fixture();
  const first = stageMealEvent(f.state, { delivery_id: 'delivery-a', payload: { id: 'event-a' } });
  const sent = [];
  const enqueued = new Set();
  let second;
  f.hooks.checkpoint = (number) => {
    if (number === 1) second = stageMealEvent(f.state, { delivery_id: 'delivery-b', payload: { id: 'event-b' } });
  };
  const flush = () => flushMealEvents(f.state, {
    checkpoint: f.callbacks.checkpoint, enqueue: (event) => sent.push(event), enqueued,
  });
  await flush();
  assert.deepEqual(sent, [first]);
  assert.equal(enqueued.has('delivery-b'), false);
  await flush();
  assert.deepEqual(sent, [first, second]);
});

test('the real client preserves checkpointed meal receipt IDs and acknowledges only delivered entries', async () => {
  const f = fixture();
  const mealId = f.open().episode.id;
  const events = [
    { kind: 'world_event_record', payload: { world_event: { id: 'env-intake' } },
      delivery_id: '11111111-1111-4111-8111-111111111111' },
    { kind: 'event', payload: { name: 'breakfast_eaten', environment_event_id: 'env-intake' },
      delivery_id: '22222222-2222-4222-8222-222222222222' },
  ].map((event) => stageMealEvent(f.state, { ...event, meal_episode_id: mealId, ts: '2026-10-23 07:30:00.000' }));
  const sent = [];
  const delivered = [];
  const client = new Client({ dryRun: false, apiBase: 'http://example.invalid', ingestKey: 'test' }, '.');
  client._drainQueue = async () => {};
  client._send = async (batch) => {
    assert.equal(f.state.pendingEvents.length, 2, 'queued or in-flight entries have no delivery receipt yet');
    sent.push(clone(batch));
  };
  client.onDelivered = (batch) => {
    delivered.push(...batch);
    acknowledgeMealEvents(f.state, batch);
  };
  await flushMealEvents(f.state, {
    checkpoint: f.callbacks.checkpoint, enqueue: (event) => client.enqueueMealEpisodeEvent(event), enqueued: new Set(),
  });
  assert.deepEqual(client.batch, events);
  assert.deepEqual(delivered, []);
  await client.flush();
  assert.deepEqual(sent, [events]);
  assert.deepEqual(delivered, events);
  assert.deepEqual(f.state.pendingEvents, []);
  const restarted = fixture(f.snapshots.at(-1));
  const replayClient = new Client({ dryRun: false }, '.');
  await flushMealEvents(restarted.state, {
    checkpoint: restarted.callbacks.checkpoint,
    enqueue: (event) => replayClient.enqueueMealEpisodeEvent(event), enqueued: new Set(),
  });
  assert.deepEqual(replayClient.batch, events, 'an acknowledged but uncheckpointed receipt retains its ingest IDs');
  for (const patch of [{ delivery_id: null }, { meal_episode_id: '2026-10-24:invented' }, { kind: 'journal' }]) {
    assert.throws(() => client.enqueueMealEpisodeEvent({ ...events[0], ...patch }), /identified checkpointed meal event required/);
  }
});

test('runner gives meals their bounded foreground turn after inbox/sleep gates and retains the canonical intake path', () => {
  const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const loop = source.slice(source.indexOf('async function genLoop()'));
  const gates = ['maintenance.enter(', 'if (client.paused)', 'if (pendingWarden.length)',
    'if (pendingPostcards.length)', 'if (asleep)', 'if (await serviceMealChoice()) continue;', "const mode = 'journal';"];
  let previous = -1;
  for (const gate of gates) {
    const index = loop.indexOf(gate);
    assert.ok(index > previous, `${gate} retains priority before ordinary prose`);
    previous = index;
  }
  const service = source.slice(source.indexOf('async function serviceMealChoice()'),
    source.indexOf('// ---- deterministic environment scheduler'));
  assert.match(service, /generate: \(call\) => rawGenerate\(/);
  assert.match(service, /purpose: 'meal_choice', accountingMode: 'meal_choice'/);
  assert.match(service, /num_predict: 80/);
  assert.match(service, /timeoutMs: FOREGROUND_INFERENCE_TIMEOUT_MS, signal: controller.signal/);
  assert.match(service, /isEligible: \(\) => isAdmitted\(\) && liveMeal\(episode, currentMealContext\(\)\)/);
  const intake = source.slice(source.indexOf('function recordScheduledOutcome('), source.indexOf('function currentMealContext('));
  assert.ok(intake.indexOf('captureEnvironmentEvent(') < intake.indexOf("recordIncident('environment'"));
  assert.match(intake, /body: provisional.body/);
  assert.match(intake, /if \(captureOptions.mealEpisodeId\)[\s\S]*stageMealEvent\(/);
  assert.match(source, /enqueue: \(event\) => \{\s*client.enqueueMealEpisodeEvent\(event\)/);
  assert.match(source, /if \(acknowledgeMealEvents\(vitals.mealChoice, events\)\) urgentVitalsDirty = true/);
});

for (const action of MEAL_ACTIONS) {
  test(`real Soma ${action} uses canonical intake exactly once and unchanged physiology`, async () => {
    const f = fixture();
    const { episode } = f.open();
    const actual = createSomaRuntime(null, { now: BASE });
    const direct = createSomaRuntime(null, { now: BASE });
    assert.equal(actual.available, true);
    const emotions = clone({ appraisal: actual.state.appraisal, experienced: actual.state.experienced });
    const availability = recordFor(chooseMealEvent('breakfast', () => 0, { mealId: episode.id }), 'env-availability');
    observeEnvironmentRecord(actual, availability);
    assert.equal(actual.state.feeding.records.length, 0);
    assert.equal(actual.state.physiologicalSatiety.intakeHistory.length, 0);
    let intake;
    f.hooks.generate = () => JSON.stringify({ action });
    f.hooks.apply = (current) => {
      const built = materialiseMealConsumption(current.meal, current.decision.action, {
        mealId: current.id, availabilityEventId: current.availabilityEventId, decisionId: current.decision.id,
      });
      intake = recordFor(built, current.effectEventId);
      observeEnvironmentRecord(actual, intake);
      stageMealEvent(f.state, { delivery_id: current.effectEventId, payload: intake });
    };
    assert.equal(await decideMeal(f.state, episode, f.callbacks), true);
    observeEnvironmentRecord(direct, intake);
    assert.deepEqual(actual.state.feeding, direct.state.feeding);
    assert.deepEqual(actual.state.physiologicalSatiety, direct.state.physiologicalSatiety);
    assert.deepEqual(actual.state.learnedControllability, direct.state.learnedControllability);
    assert.deepEqual({ appraisal: actual.state.appraisal, experienced: actual.state.experienced }, emotions);
    assert.equal(actual.state.feeding.records.length, 1);
    assert.equal(actual.state.physiologicalSatiety.intakeHistory.length, 1);
    const feeding = actual.state.feeding.records[0];
    assert.equal(feeding.intakeOutcome, action === 'eat' ? 'FULLY_CONSUMED' : 'REFUSED');
    assert.equal(feeding.consumedFraction, action === 'eat' ? 1 : 0);
    assert.equal(feeding.consumedEnergyKcal, action === 'eat' ? feeding.fullMealEnergyKcal : 0);
    if (action === 'eat') {
      assert.equal(actual.state.feeding.lastKnownIntakeEventId, episode.effectEventId);
      assert.ok(actual.state.physiologicalSatiety.tracks.length > 0);
    } else {
      assert.equal(actual.state.feeding.lastKnownIntakeEventId, null);
      assert.equal(actual.state.physiologicalSatiety.tracks.length, 0);
    }
    assert.equal(recoverMeals(f.state, f.callbacks), false);
    assert.equal(await decideMeal(f.state, episode, f.callbacks), false);
    observeEnvironmentRecord(actual, intake);
    assert.equal(actual.state.feeding.records.length, 1);
    assert.equal(actual.state.physiologicalSatiety.intakeHistory.length, 1);
    assert.equal(f.state.pendingEvents.length, 1);
    assert.equal(f.snapshots.at(-1).pendingEvents[0].payload.world_event.id, episode.effectEventId);
  });
}

test('real Soma records failed inference as unknown without zero intake or a fabricated action', async () => {
  const f = fixture();
  const { episode } = f.open();
  const soma = createSomaRuntime(null, { now: BASE });
  f.hooks.generate = () => '{"action":"invented"}';
  let record;
  f.hooks.unknown = (current) => {
    record = recordFor(mealUnknownConsumption(current.meal, {
      mealId: current.id, availabilityEventId: current.availabilityEventId,
    }), 'env-unknown');
    observeEnvironmentRecord(soma, record);
  };
  assert.equal(await decideMeal(f.state, episode, f.callbacks), false);
  const intake = soma.state.feeding.records[0];
  assert.equal(intake.intakeOutcome, 'UNKNOWN');
  assert.equal(intake.consumedFraction, null);
  assert.equal(intake.consumedEnergyKcal, null);
  assert.equal(record.world_event.world.action_opportunity.id, null);
  assert.equal(record.world_event.world.action_opportunity.chosen_action, 'unknown');
  assert.deepEqual(record.world_event.world.action_opportunity.available_actions, []);
  assert.equal(soma.state.learnedControllability.history.length, 0);
  assert.equal(soma.state.feeding.lastKnownIntakeEventId, null);
});
