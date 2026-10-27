import assert from 'node:assert/strict';
import test from 'node:test';
import {
  YARD_ACTIONS, YARD_CHOICE_FORMAT, yardContactState, yardTurnContext,
  qualifiesYardGreeting, openYardGreeting, liveYardTurn, yardChoiceCall, parseYardChoice,
  decideYardTurn, expireYardTurns, recoverYardTurns, flushYardTurns, acknowledgeYardDeliveries,
} from './yard-contact-choice.js';
import { CAST, OFFICERS } from './cast.js';
import { createSocialContactState, observeSocialContactRecord, socialContextState } from './social-contact-substrate.js';
import { actionOpportunityFromEnvironment } from './action-outcome-contingency.js';
import { tsNow } from './client.js';

const BASE = Date.parse('2026-10-27T14:20:00Z');
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture(raw = null) {
  const state = yardContactState(raw);
  const world = {
    nowMs: BASE, minutes: 860, asleep: false, regimeEpoch: 1, regime: 'auto',
    locationState: {
      current: { id: 'EXERCISE_YARD', regime_activity: 'DAILY_EXERCISE',
        entered_at: new Date(BASE - 1000).toISOString(), source_event_id: 'entry-yard' },
      activeExerciseEpisode: { id: 'exercise:2026-10-27', status: 'ACTIVE',
        started_at: new Date(BASE - 1000).toISOString(), ended_at: null },
      activeRegimeEpisode: { id: 'exercise:2026-10-27', status: 'ACTIVE', type: 'DAILY_EXERCISE' },
      activeRoutineEpisode: null, searchEpisode: null, lockdownEpisode: null,
    },
  };
  const snapshots = [];
  const calls = { generate: 0, checkpoint: 0, project: [], enqueue: [], remember: [] };
  const hooks = {};
  const callbacks = {
    readContext: () => yardTurnContext(world),
    checkpoint: async () => {
      calls.checkpoint++;
      const snapshot = clone(state);
      await hooks.checkpoint?.(calls.checkpoint);
      snapshots.push(snapshot);
    },
    generate: async () => { calls.generate++; return hooks.generate ? hooks.generate() : '{"action":"respond"}'; },
    project: (record) => { calls.project.push(record.world_event.id); return hooks.project?.(record); },
    enqueue: (event) => calls.enqueue.push(event),
    remember: (record) => calls.remember.push(record.world_event.id),
    enqueued: new Set(), remembered: new Set(),
  };
  const open = (id = 'greeting-1', cast = 'reg') => openYardGreeting(state, {
    id, cast, context: callbacks.readContext(),
  });
  return { state, world, snapshots, calls, callbacks, hooks, open };
}

test('state round trips without sharing mutable records and rejects unknown checkpoints', () => {
  const f = fixture();
  f.open();
  const restored = yardContactState(f.state);
  assert.deepEqual(restored, f.state);
  restored.encounters[0].opening.observation.summary = 'changed';
  assert.notEqual(f.state.encounters[0].opening.observation.summary, 'changed');
  for (const invalid of [{}, { ...f.state, version: 2 }, { ...f.state, encounters: [{}] }]) {
    assert.throws(() => yardContactState(invalid), /Unrecognised yard-contact checkpoint/);
  }
});

test('only canonical visible inmates and the existing conversation variant qualify', () => {
  for (const cast of CAST) assert.equal(qualifiesYardGreeting(cast, 'conversation'), !['root', 'daemon'].includes(cast.key));
  for (const cast of [...OFFICERS, { key: 'new', name: 'New' }, null]) {
    assert.equal(qualifiesYardGreeting(cast, 'conversation'), false);
  }
  for (const variant of ['quiet', 'company', 'avoided', 'greeting', null]) {
    assert.equal(qualifiesYardGreeting('reg', variant), false);
  }
  const f = fixture();
  assert.equal(f.open('bad', 'root'), null);
  assert.equal(f.open('bad', 'daemon'), null);
  const entry = f.open('canonical', { key: 'reg', name: 'Invented', blurb: 'Invented' });
  assert.equal(entry.castName, 'Reg');
  assert.doesNotMatch(yardChoiceCall(entry).prompt, /Invented/);
});

test('timetable alone, a stale exercise, sleep and every restriction cannot authorise a greeting', () => {
  const f = fixture();
  const entry = f.open();
  assert.equal(liveYardTurn(entry, f.callbacks.readContext()), true);
  const patches = [
    (w) => { w.minutes = 854; }, (w) => { w.minutes = 915; }, (w) => { w.asleep = true; },
    (w) => { w.regime = 'night'; }, (w) => { w.locationState.current.id = 'CELL'; },
    (w) => { w.locationState.current.regime_activity = 'CELL_TIME'; },
    (w) => { w.locationState.activeExerciseEpisode = null; },
    (w) => { w.locationState.activeExerciseEpisode.status = 'COMPLETE'; },
    (w) => { w.locationState.activeExerciseEpisode.ended_at = new Date(BASE).toISOString(); },
    (w) => { w.locationState.activeRegimeEpisode.id = 'different'; },
    (w) => { w.locationState.activeRegimeEpisode.type = 'OTHER'; },
    (w) => { w.locationState.searchEpisode = { id: 's', status: 'ACTIVE', stage: 'SEARCH_ONGOING' }; },
    (w) => { w.locationState.activeRoutineEpisode = { id: 'r', status: 'ACTIVE' }; },
    (w) => { w.locationState.lockdownEpisode = { id: 'l', status: 'ACTIVE' }; },
  ];
  for (const patch of patches) {
    const world = clone(f.world);
    patch(world);
    assert.equal(yardTurnContext(world).eligible, false);
    assert.equal(liveYardTurn(entry, yardTurnContext(world)), false);
  }
  for (const patch of [
    (w) => { w.regimeEpoch++; },
    (w) => { w.locationState.current.entered_at = new Date(BASE).toISOString(); },
    (w) => { w.locationState.current.source_event_id = 'returned-to-yard'; },
    (w) => { w.locationState.activeExerciseEpisode.id = 'later-exercise'; w.locationState.activeRegimeEpisode.id = 'later-exercise'; },
  ]) {
    const world = clone(f.world);
    patch(world);
    assert.equal(liveYardTurn(entry, yardTurnContext(world)), false);
  }
  assert.equal(yardTurnContext({ ...f.world, minutes: 855 }).eligible, true);
});

test('one canonical opening and replacement closes the earlier turn without a refusal', () => {
  const f = fixture();
  const entry = f.open();
  assert.equal(f.open(), entry);
  assert.equal(f.state.encounters.length, 1);
  const next = f.open('greeting-2', 'ping');
  assert.notEqual(next, entry);
  assert.equal(entry.phase, 'RESOLVED');
  assert.equal(entry.resolution.status, 'NO_DECISION');
  assert.equal(entry.resolution.action, null);
  assert.equal(entry.resolutionRecord.world_event.world.social.decision_action, 'UNKNOWN');
});

test('strict native schema and bounded grounding cannot turn a choice into prose', () => {
  const f = fixture();
  const request = yardChoiceCall(f.open(), { bodily: 'b'.repeat(2000), recent: 'r'.repeat(3000),
    grounding: 'g'.repeat(2000), journal: 'DO NOT INCLUDE', identity: 'a model' });
  assert.equal(request.format, YARD_CHOICE_FORMAT);
  assert.deepEqual(request.format.properties.action.enum, YARD_ACTIONS);
  assert.equal(request.format.additionalProperties, false);
  assert.match(request.system, /inmate 7734/);
  const prompt = JSON.parse(request.prompt);
  assert.equal(prompt.body.length, 1200);
  assert.equal(prompt.recent.length, 1600);
  assert.equal(prompt.grounding.length, 1200);
  assert.doesNotMatch(request.prompt, /DO NOT INCLUDE|a model/);
  assert.equal(parseYardChoice('{"action":"respond"}'), 'respond');
  assert.equal(parseYardChoice('{"action":"decline"}'), 'decline');
  for (const raw of ['{"action":"respond","text":"hello"}', '{"action":"wait"}',
    'hello', '```json\n{"action":"respond"}\n```', '[{"action":"respond"}]', 'null', '{}']) {
    assert.equal(parseYardChoice(raw), null);
  }
});

for (const action of YARD_ACTIONS) {
  test(`${action} is one private call, one commit and one resolved point, never dialogue or waiting`, async () => {
    const f = fixture();
    const entry = f.open();
    f.hooks.generate = () => { f.world.nowMs += 90_000; return JSON.stringify({ action }); };
    assert.equal(await decideYardTurn(f.state, entry, f.callbacks), true);
    assert.equal(f.calls.generate, 1);
    assert.deepEqual(f.snapshots.map((s) => s.encounters[0].phase), ['OFFERED', 'COMMITTED', 'RESOLVED']);
    assert.equal(entry.resolution.action, action);
    assert.equal(entry.resolution.status, 'EXECUTED');
    assert.equal(await decideYardTurn(f.state, entry, f.callbacks), false);
    assert.equal(f.calls.generate, 1);
    const opening = entry.opening.world_event;
    const terminal = entry.resolutionRecord.world_event;
    assert.equal(opening.world.social.episode_type, 'OPPORTUNITY');
    assert.equal(opening.world.social.opportunity_status, 'DECISION_PENDING');
    assert.equal(terminal.world.participants.actor, 'cy:7734');
    assert.equal(terminal.world.participants.target, 'reg');
    assert.equal(terminal.world.social.counterpart_id, 'reg');
    assert.equal(terminal.world.social.reciprocity, action === 'respond' ? 'RECIPROCAL' : 'NO_RESPONSE');
    assert.equal(terminal.world.social.character, 'ORDINARY');
    assert.notEqual(opening.world.social.episode_id, terminal.world.social.episode_id);
    for (const record of [opening, terminal]) {
      assert.equal(record.duration_ms, 0);
      assert.equal(record.world.social.start_at, record.world.social.end_at);
      assert.equal(record.world.social.resolution, 'COMPLETED');
      assert.equal(record.world.social.continuously_observed, false);
      assert.deepEqual(record.world.associative_learning.outcomes, []);
      assert.doesNotMatch(JSON.stringify(record), /waiting|ONGOING|hostile|supportive/);
    }
    const social = createSocialContactState(BASE);
    observeSocialContactRecord(social, entry.opening);
    observeSocialContactRecord(social, entry.resolutionRecord);
    assert.equal(social.episodes.length, 2);
    assert.deepEqual(social.episodes.map((e) => e.durationMs), [0, 0]);
    assert.equal(socialContextState(social), 'NO_CURRENT_EPISODE_OBSERVED');
    assert.equal(social.episodes[1].direction, 'INITIATED_BY_CY');
    assert.equal(entry.pendingEvents.length, 3);
    assert.equal(entry.pendingEvents.filter((event) => event.kind === 'event').length, 1);
    const openedOpportunity = actionOpportunityFromEnvironment(entry.opening);
    const resolvedOpportunity = actionOpportunityFromEnvironment(entry.resolutionRecord);
    assert.equal(openedOpportunity.executionStatus, 'INTENDED');
    assert.equal(openedOpportunity.resolutionStatus, 'UNRESOLVED');
    assert.equal(resolvedOpportunity.executionStatus, 'EXECUTED');
    assert.equal(resolvedOpportunity.resolutionStatus, 'RESOLVED');
    assert.equal(terminal.world.social.opportunity_status, action === 'respond' ? 'RESPONDED' : 'DECLINED');
    for (const event of entry.pendingEvents) assert.match(event.delivery_id, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  });
}

for (const result of ['invalid', '{"action":"respond","text":"hello"}', new Error('provider failed')]) {
  test(`provider ${String(result)} resolves without Cy action or a fabricated decline`, async () => {
    const f = fixture();
    const entry = f.open();
    f.hooks.generate = () => { if (result instanceof Error) throw result; return result; };
    assert.equal(await decideYardTurn(f.state, entry, f.callbacks), false);
    assert.equal(f.calls.generate, 1);
    assert.equal(entry.resolution.status, 'NO_DECISION');
    assert.equal(entry.resolution.action, null);
    assert.equal(entry.resolution.executionStatus, 'NOT_EXECUTED');
    assert.equal(entry.resolutionRecord.world_event.world.participants.actor, null);
    assert.equal(entry.resolutionRecord.world_event.world.social.reciprocity, 'UNKNOWN');
    assert.equal(entry.resolutionRecord.world_event.world.social.episode_type, 'OPPORTUNITY');
    assert.equal(entry.pendingEvents[2].payload.text, entry.opening.observation.summary);
    assert.doesNotMatch(entry.pendingEvents[2].payload.text, /provider|failed|declin|refus/i);
    assert.equal(actionOpportunityFromEnvironment(entry.resolutionRecord).executionStatus, 'UNKNOWN');
    assert.equal(actionOpportunityFromEnvironment(entry.resolutionRecord).resolutionStatus, 'RESOLVED');
    assert.equal(await decideYardTurn(f.state, entry, f.callbacks), false);
  });
}

for (const checkpoint of [1, 2, 3]) {
  test(`failed checkpoint ${checkpoint} never resets phase or retries inference`, async () => {
    const f = fixture();
    const entry = f.open();
    f.hooks.checkpoint = (count) => { if (count === checkpoint) throw new Error('disk'); };
    await assert.rejects(decideYardTurn(f.state, entry, f.callbacks), /disk/);
    assert.equal(entry.phase, ['OFFERED', 'COMMITTED', 'RESOLVED'][checkpoint - 1]);
    assert.equal(f.calls.generate, checkpoint === 1 ? 0 : 1);
    f.hooks.checkpoint = null;
    assert.equal(await decideYardTurn(f.state, entry, f.callbacks), false);
    assert.equal(f.calls.generate, checkpoint === 1 ? 0 : 1);
    assert.equal(f.calls.project.length, 0);
    assert.equal(f.calls.enqueue.length, 0);
    const recovered = yardContactState(f.snapshots.at(-1));
    recoverYardTurns(recovered, { nowMs: BASE + 1000 });
    if (recovered.encounters.length) {
      assert.equal(recovered.encounters[0].resolution.action, null);
      assert.equal(recovered.encounters[0].resolution.status, 'NO_DECISION');
    }
  });
}

test('concurrent decision callers cannot offer the same greeting twice', async () => {
  const f = fixture();
  const entry = f.open();
  await Promise.all([decideYardTurn(f.state, entry, f.callbacks), decideYardTurn(f.state, entry, f.callbacks)]);
  assert.equal(f.calls.generate, 1);
});

for (const barrier of ['before-call', 'after-call', 'after-commit']) {
  test(`movement at ${barrier} closes without an action`, async () => {
    const f = fixture();
    const entry = f.open();
    const move = () => { f.world.locationState.current.id = 'CELL'; };
    if (barrier === 'before-call') f.hooks.checkpoint = (n) => { if (n === 1) move(); };
    if (barrier === 'after-call') f.hooks.generate = () => { move(); return '{"action":"respond"}'; };
    if (barrier === 'after-commit') f.hooks.checkpoint = (n) => { if (n === 2) move(); };
    assert.equal(await decideYardTurn(f.state, entry, f.callbacks), false);
    assert.equal(entry.resolution.action, null);
    assert.equal(entry.resolution.executionStatus, 'NOT_EXECUTED');
    assert.equal(f.calls.generate, barrier === 'before-call' ? 0 : 1);
  });
}

test('cancellation and lost admission after the call never become a refusal', async () => {
  for (const mode of ['cancel', 'admission']) {
    const f = fixture();
    const entry = f.open();
    const controller = new AbortController();
    let admitted = true;
    f.hooks.generate = () => { if (mode === 'cancel') controller.abort(); else admitted = false; return '{"action":"decline"}'; };
    assert.equal(await decideYardTurn(f.state, entry, { ...f.callbacks,
      signal: controller.signal, isAdmitted: () => admitted }), false);
    assert.equal(entry.resolution.action, null);
  }
});

test('a new greeting during generation retires the old offer without applying its result', async () => {
  const f = fixture();
  const entry = f.open();
  f.hooks.generate = () => { f.open('new-greeting', 'nick'); return '{"action":"respond"}'; };
  assert.equal(await decideYardTurn(f.state, entry, f.callbacks), false);
  assert.equal(entry.resolution.status, 'NO_DECISION');
  assert.equal(entry.decision, null);
});

test('movement during resolution IO cannot undo the historical action already formed', async () => {
  const f = fixture();
  const entry = f.open();
  f.hooks.checkpoint = (n) => { if (n === 3) f.world.locationState.current.id = 'CELL'; };
  assert.equal(await decideYardTurn(f.state, entry, f.callbacks), true);
  assert.equal(entry.resolution.action, 'respond');
  assert.equal(expireYardTurns(f.state, f.callbacks.readContext()), false);
});

test('recovery closes every unresolved phase, including committed, without replaying action', async () => {
  for (const phase of ['AVAILABLE', 'OFFERED', 'COMMITTED']) {
    const f = fixture();
    const entry = f.open();
    entry.phase = phase;
    if (phase === 'COMMITTED') entry.decision = { id: 'd', action: 'respond', encounterId: entry.id };
    assert.equal(recoverYardTurns(f.state, { nowMs: BASE + 1000 }), true);
    assert.equal(entry.resolution.status, 'NO_DECISION');
    assert.equal(entry.resolution.action, null);
    const frozen = clone(entry);
    assert.equal(recoverYardTurns(f.state, { nowMs: BASE + 2000 }), false);
    assert.deepEqual(entry, frozen);
    assert.equal(await decideYardTurn(f.state, entry, f.callbacks), false);
    assert.equal(f.calls.generate, 0);
  }
});

test('much later restart closes knowledge privately but publishes only the original greeting at its original time', () => {
  const f = fixture();
  const entry = f.open();
  const originalOpening = clone(entry.opening);
  const later = BASE + 14 * 24 * 60 * 60_000;
  const restored = yardContactState(f.state);
  recoverYardTurns(restored, { nowMs: later });
  const closed = restored.encounters[0];
  const publicEvent = closed.pendingEvents.find((event) => event.kind === 'event');
  const terminalEvent = closed.pendingEvents.find((event) => event.kind === 'world_event_record'
    && event.payload.world_event.id === closed.resolutionRecord.world_event.id);
  assert.deepEqual(closed.opening, originalOpening);
  assert.equal(closed.resolution.action, null);
  assert.equal(closed.resolution.status, 'NO_DECISION');
  assert.equal(closed.resolution.executionStatus, 'NOT_EXECUTED');
  assert.equal(publicEvent.ts, tsNow(new Date(BASE)));
  assert.equal(publicEvent.payload.text, originalOpening.observation.summary);
  assert.equal(publicEvent.payload.environment_event_id, originalOpening.world_event.id);
  assert.equal(terminalEvent.ts, tsNow(new Date(later)));
  assert.equal(closed.resolutionRecord.world_event.timestamp, new Date(later).toISOString());
  assert.match(closed.resolutionRecord.observation.summary,
    /No executed Cy response or deliberate decline is established for Reg's recorded yard greeting/);
  assert.notEqual(closed.resolutionRecord.observation.summary, originalOpening.observation.summary);
  const world = closed.resolutionRecord.world_event.world;
  assert.equal(world.participants.actor, null);
  assert.equal(world.social.decision_action, 'UNKNOWN');
  assert.deepEqual(world.social.linked_event_ids, [originalOpening.world_event.id, closed.resolutionRecord.world_event.id]);
  assert.deepEqual(world.action_opportunity.linked_event_ids, world.social.linked_event_ids);
  assert.equal('cy_action' in closed.resolutionRecord.observation.observed_facts, false);
});

test('expiry uses world fences, never a fictional lifetime or wait interval', () => {
  const f = fixture();
  const entry = f.open();
  f.world.nowMs += 20 * 60_000;
  assert.equal(liveYardTurn(entry, f.callbacks.readContext()), true);
  assert.equal(expireYardTurns(f.state, f.callbacks.readContext()), false);
  f.world.minutes = 915;
  assert.equal(expireYardTurns(f.state, f.callbacks.readContext()), true);
  assert.equal(entry.resolution.status, 'NO_DECISION');
  assert.equal(entry.resolution.action, null);
  assert.equal('expiresAt' in entry, false);
  assert.equal('presence' in entry, false);
});

test('flush checkpoints envelope, then synchronous projection receipts, then external delivery and one terminal source', async () => {
  const f = fixture();
  const entry = f.open();
  await decideYardTurn(f.state, entry, f.callbacks);
  const order = [];
  f.hooks.checkpoint = () => order.push('checkpoint');
  const callbacks = { ...f.callbacks,
    project: (record) => { order.push('project'); f.callbacks.project(record); },
    enqueue: (event) => { order.push('enqueue'); f.callbacks.enqueue(event); },
    remember: (record) => { order.push('remember'); f.callbacks.remember(record); },
  };
  await flushYardTurns(f.state, callbacks);
  assert.deepEqual(order, ['checkpoint', 'project', 'project', 'checkpoint', 'enqueue', 'enqueue', 'enqueue', 'remember']);
  assert.equal(f.calls.project.length, 2);
  assert.equal(f.calls.enqueue.length, 3);
  assert.deepEqual(f.calls.remember, [entry.resolutionRecord.world_event.id]);
  assert.equal(f.snapshots.at(-1).encounters[0].projectedRecordIds.length, 2);
  const before = f.calls.checkpoint;
  await Promise.all([flushYardTurns(f.state, callbacks), flushYardTurns(f.state, callbacks)]);
  assert.equal(f.calls.checkpoint, before);
  assert.equal(f.calls.project.length, 2);
});

for (const failedBarrier of [1, 2]) {
  test(`flush failure at barrier ${failedBarrier} prevents external effects and retry does not double project`, async () => {
    const f = fixture();
    const entry = f.open();
    await decideYardTurn(f.state, entry, f.callbacks);
    const begin = f.calls.checkpoint;
    f.hooks.checkpoint = (n) => { if (n === begin + failedBarrier) throw new Error('disk'); };
    await assert.rejects(flushYardTurns(f.state, f.callbacks), /disk/);
    assert.equal(f.calls.enqueue.length, 0);
    assert.equal(f.calls.remember.length, 0);
    assert.equal(f.calls.project.length, failedBarrier === 1 ? 0 : 2);
    f.hooks.checkpoint = null;
    await flushYardTurns(f.state, f.callbacks);
    assert.equal(f.calls.project.length, 2);
    assert.equal(f.calls.enqueue.length, 3);
    assert.equal(f.calls.remember.length, 1);
    assert.equal(entry.projectedRecordIds.length, 2);
  });
}

test('opening-only failed projection checkpoint remains dirty even after an early delivery acknowledgement', async () => {
  const f = fixture();
  const entry = f.open();
  acknowledgeYardDeliveries(f.state, entry.pendingEvents);
  f.hooks.checkpoint = (n) => { if (n === 2) throw new Error('disk'); };
  await assert.rejects(flushYardTurns(f.state, f.callbacks), /disk/);
  assert.equal(f.calls.project.length, 1);
  f.hooks.checkpoint = null;
  await flushYardTurns(f.state, f.callbacks);
  assert.equal(f.calls.project.length, 1);
  assert.equal(f.calls.checkpoint, 4);
  assert.equal(f.calls.remember.length, 0);
});

test('opening has one canonical delivery, preserves its receipt through resolution and uses SQL timestamps', async () => {
  for (const acknowledged of [false, true]) {
    const f = fixture();
    const entry = f.open();
    const openingDelivery = clone(entry.pendingEvents[0]);
    assert.equal(entry.pendingEvents.length, 1);
    assert.equal(openingDelivery.kind, 'world_event_record');
    assert.equal(openingDelivery.payload.world_event.id, entry.opening.world_event.id);
    assert.equal(openingDelivery.ts, tsNow(new Date(BASE)));
    assert.match(openingDelivery.ts, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    await flushYardTurns(f.state, f.callbacks);
    assert.equal(f.calls.enqueue.length, 1);
    assert.equal(f.calls.remember.length, 0);
    if (acknowledged) acknowledgeYardDeliveries(f.state, [openingDelivery]);
    await decideYardTurn(f.state, entry, f.callbacks);
    assert.equal(entry.pendingEvents.some((event) => event.delivery_id === openingDelivery.delivery_id), !acknowledged);
    assert.equal(entry.acknowledgedDeliveryIds.includes(openingDelivery.delivery_id), acknowledged);
    await flushYardTurns(f.state, f.callbacks);
    assert.equal(f.calls.enqueue.length, 3);
    assert.equal(f.calls.enqueue.filter((event) => event.kind === 'event').length, 1);
    assert.equal(f.calls.remember.length, 1);
    assert.equal(f.calls.enqueue.filter((event) => event.delivery_id === openingDelivery.delivery_id).length, 1);
    for (const event of entry.pendingEvents) assert.match(event.ts, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  }
});

test('only fully projected and acknowledged older receipts prune, retaining 56 older terminals and every current-day identity', () => {
  const f = fixture();
  const older = [];
  f.world.nowMs -= 24 * 60 * 60_000;
  for (let index = 0; index < 62; index++) {
    const entry = f.open(`old-${index}`);
    recoverYardTurns(f.state, { nowMs: f.world.nowMs });
    entry.projectedRecordIds = [entry.opening.world_event.id, entry.resolutionRecord.world_event.id];
    acknowledgeYardDeliveries(f.state, clone(entry.pendingEvents));
    older.push(entry);
  }
  // Missing delivery or projection proof protects even the oldest entry.
  older[0].acknowledgedDeliveryIds.pop();
  older[1].projectedRecordIds.pop();
  f.world.nowMs = BASE;
  const today = f.open('today');
  assert.equal(f.state.encounters.length, 59);
  assert.equal(f.state.encounters.includes(older[0]), true);
  assert.equal(f.state.encounters.includes(older[1]), true);
  assert.equal(f.state.encounters.includes(older[2]), false);
  assert.equal(f.state.encounters.includes(today), true);
  const recent = f.state.encounters.filter((entry) => entry.id.startsWith('old-') && Number(entry.id.slice(4)) >= 6);
  assert.equal(recent.length, 56);
  for (let index = 0; index < 60; index++) {
    const entry = f.open(`today-${index}`);
    recoverYardTurns(f.state, { nowMs: BASE });
    entry.projectedRecordIds = [entry.opening.world_event.id, entry.resolutionRecord.world_event.id];
    acknowledgeYardDeliveries(f.state, clone(entry.pendingEvents));
  }
  assert.equal(f.state.encounters.filter((entry) => entry.id.startsWith('today')).length, 61);
  assert.equal(f.open('today'), today);
});

test('concurrent resolution during the first checkpoint cannot leak into projection or delivery', async () => {
  const f = fixture();
  const entry = f.open();
  f.hooks.checkpoint = (n) => { if (n === 1) recoverYardTurns(f.state, { nowMs: BASE + 1000 }); };
  await flushYardTurns(f.state, f.callbacks);
  assert.deepEqual(f.calls.project, [entry.opening.world_event.id]);
  assert.equal(f.calls.enqueue.length, 1);
  assert.equal(f.calls.remember.length, 0);
  f.hooks.checkpoint = null;
  await flushYardTurns(f.state, f.callbacks);
  assert.equal(f.calls.project.length, 2);
  assert.equal(f.calls.enqueue.length, 3);
  assert.equal(f.calls.remember.length, 1);
});

test('simultaneous flush calls serialize and preserve stable delivery identities across restart', async () => {
  const f = fixture();
  const entry = f.open();
  await decideYardTurn(f.state, entry, f.callbacks);
  await Promise.all([flushYardTurns(f.state, f.callbacks), flushYardTurns(f.state, f.callbacks)]);
  assert.equal(f.calls.project.length, 2);
  assert.equal(f.calls.enqueue.length, 3);
  const restored = fixture(f.state);
  await flushYardTurns(restored.state, restored.callbacks);
  assert.equal(restored.calls.project.length, 0);
  assert.deepEqual(restored.calls.enqueue.map((e) => e.delivery_id), f.calls.enqueue.map((e) => e.delivery_id));
  assert.equal(acknowledgeYardDeliveries(restored.state, restored.calls.enqueue), true);
  assert.equal(acknowledgeYardDeliveries(restored.state, restored.calls.enqueue), false);
  const acknowledged = fixture(restored.state);
  await flushYardTurns(acknowledged.state, acknowledged.callbacks);
  assert.equal(acknowledged.calls.enqueue.length, 0);
  assert.equal(acknowledged.state.encounters[0].acknowledgedDeliveryIds.length, 3);
});

test('crash after envelope durability but before projection rebuilds only durable point records', async () => {
  const f = fixture();
  const entry = f.open();
  await decideYardTurn(f.state, entry, f.callbacks);
  f.hooks.project = () => { throw new Error('crash'); };
  await assert.rejects(flushYardTurns(f.state, f.callbacks), /crash/);
  const restored = fixture(f.snapshots.at(-1));
  recoverYardTurns(restored.state, { nowMs: BASE + 1000 });
  await flushYardTurns(restored.state, restored.callbacks);
  assert.equal(restored.calls.generate, 0);
  assert.equal(restored.calls.project.length, 2);
  assert.equal(restored.state.encounters[0].resolution.action, 'respond');
});

test('a failed source callback retries with the same terminal source without another projection or enqueue', async () => {
  const f = fixture();
  const entry = f.open();
  await decideYardTurn(f.state, entry, f.callbacks);
  let attempts = 0;
  const sources = [];
  const callbacks = { ...f.callbacks, remember: async (record) => {
    sources.push(record.world_event.id);
    if (++attempts === 1) throw new Error('source queue unavailable');
  } };
  await assert.rejects(flushYardTurns(f.state, callbacks), /source queue unavailable/);
  assert.equal(f.calls.enqueue.length, 3);
  assert.equal(f.calls.project.length, 2);
  await flushYardTurns(f.state, callbacks);
  assert.equal(f.calls.enqueue.length, 3);
  assert.equal(f.calls.project.length, 2);
  assert.deepEqual(sources, [entry.resolutionRecord.world_event.id, entry.resolutionRecord.world_event.id]);
});

test('asynchronous projection is rejected before delivery and no receipt is falsely persisted', async () => {
  const f = fixture();
  const entry = f.open();
  await assert.rejects(flushYardTurns(f.state, { ...f.callbacks, project: async () => {} }), /must be synchronous/);
  assert.deepEqual(entry.projectedRecordIds, []);
  assert.equal(f.calls.enqueue.length, 0);
  assert.equal(f.calls.remember.length, 0);
});

test('declared projection consumers enrich exact durable outbound copies without changing canonical sources', async () => {
  const f = fixture();
  const entry = f.open();
  await decideYardTurn(f.state, entry, f.callbacks);
  const opening = clone(entry.opening);
  const resolution = clone(entry.resolutionRecord);
  const consumers = new Map([
    [entry.opening.world_event.id, ['social-contact-substrate']],
    [entry.resolutionRecord.world_event.id, ['social-contact-substrate', 'action-outcome-contingency']],
  ]);
  f.hooks.project = (record) => ({
    feeding: { updated: false }, somatic_nociceptive: { updated: false },
    social_contact: { updated: true, sourceEnvironmentEventId: record.world_event.id },
    action_outcome_contingency: { updated: true }, current_defensive_context: { updated: false },
    threat_learning: { updated: false }, consumed_by: consumers.get(record.world_event.id),
    world_event: { id: 'must-not-override' }, observation: { summary: 'must-not-override' },
    soma_input: { event_id: 'must-not-override' }, unrelated: 'must-not-copy',
  });
  const callbacks = { ...f.callbacks, enqueue: (event) => {
    const durable = f.snapshots.at(-1).encounters[0];
    assert.equal(durable.projectedRecordIds.length, 2);
    assert.deepEqual(event, durable.pendingEvents.find((pending) => pending.delivery_id === event.delivery_id));
    f.callbacks.enqueue(event);
  } };
  await flushYardTurns(f.state, callbacks);
  assert.deepEqual(entry.opening, opening);
  assert.deepEqual(entry.resolutionRecord, resolution);
  assert.deepEqual(entry.opening.consumed_by, []);
  assert.deepEqual(entry.resolutionRecord.consumed_by, []);
  for (const record of f.calls.enqueue.filter((event) => event.kind === 'world_event_record')) {
    assert.deepEqual(record.payload.consumed_by, consumers.get(record.payload.world_event.id));
    assert.deepEqual(record.payload.social_contact, { updated: true,
      sourceEnvironmentEventId: record.payload.world_event.id });
    for (const key of ['feeding', 'somatic_nociceptive', 'action_outcome_contingency',
      'current_defensive_context', 'threat_learning']) {
      assert.equal(typeof record.payload[key].updated, 'boolean');
    }
    assert.equal('unrelated' in record.payload, false);
    assert.doesNotMatch(JSON.stringify(record.payload), /must-not-override|must-not-copy/);
    const pending = entry.pendingEvents.find((event) => event.delivery_id === record.delivery_id);
    assert.deepEqual(pending.payload, record.payload);
  }
  assert.equal('consumed_by' in f.calls.enqueue.find((event) => event.kind === 'event').payload, false);
  const published = clone(f.calls.enqueue);
  for (const ids of consumers.values()) ids.push('later-consumer');
  await flushYardTurns(f.state, callbacks);
  assert.deepEqual(f.calls.enqueue, published);
  assert.deepEqual(entry.pendingEvents, published);
  assert.equal('social_contact' in entry.opening, false);
  assert.equal('social_contact' in entry.resolutionRecord, false);
});

for (const crash of ['before-projection-checkpoint', 'after-projection-checkpoint']) {
  test(`consumer receipts replay with stable payload after crash ${crash}`, async () => {
    const f = fixture();
    const entry = f.open();
    await decideYardTurn(f.state, entry, f.callbacks);
    const consumers = ['social-contact-substrate', 'action-outcome-contingency'];
    const receipt = { consumed_by: consumers, social_contact: { updated: true, modelVersion: 'test-v1' } };
    f.hooks.project = () => receipt;
    const start = f.calls.checkpoint;
    if (crash === 'before-projection-checkpoint') {
      f.hooks.checkpoint = (n) => { if (n === start + 2) throw new Error('crash'); };
    }
    const callbacks = { ...f.callbacks,
      ...(crash === 'after-projection-checkpoint' ? { enqueue: () => { throw new Error('crash'); } } : {}),
    };
    await assert.rejects(flushYardTurns(f.state, callbacks), /crash/);
    assert.equal(f.calls.enqueue.length, 0);
    assert.deepEqual(entry.opening.consumed_by, []);
    assert.deepEqual(entry.resolutionRecord.consumed_by, []);
    const expected = clone(entry.pendingEvents);
    const restored = fixture(f.snapshots.at(-1));
    restored.hooks.project = () => receipt;
    await flushYardTurns(restored.state, restored.callbacks);
    assert.deepEqual(restored.calls.enqueue, expected);
    assert.equal(restored.calls.project.length, crash === 'before-projection-checkpoint' ? 2 : 0);
    assert.deepEqual(restored.state.encounters[0].pendingEvents, expected);
    for (const event of restored.calls.enqueue.filter((item) => item.kind === 'world_event_record')) {
      assert.deepEqual(event.payload.consumed_by, consumers);
      assert.deepEqual(event.payload.social_contact, receipt.social_contact);
    }
  });
}
