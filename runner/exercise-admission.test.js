import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EXERCISE_DELAY_MINUTES, acknowledgeExerciseDeliveries, exerciseAdmissionAllows,
  persistExerciseDeliveries, prepareExerciseAdmission, stageExerciseDelivery,
} from './exercise-admission.js';
import {
  LOCATIONS, reconcileLocationRegimeState, reconcileRegimeLocation, registerEpisodeEvent,
  startCellSearchEpisode, startLockdownEpisode, advanceLockdownEpisode, startScheduledRoutineEpisode,
} from './location-regime.js';
import { loadVitals, saveVitals } from './vitals.js';
import { Client } from './client.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';

const DATE = '2026-10-21';
const START = Date.parse(`${DATE}T13:15:00.000Z`); // 14:15 BST
const END = START + 60 * 60_000;
const cell = () => reconcileLocationRegimeState(null, { nowMs: START - 60_000, date: DATE, minutes: 854 });
const at = (offset = 0, extra = {}) => ({ nowMs: START + offset * 60_000, date: DATE, minutes: 855 + offset, ...extra });
const neverRoll = () => { throw new Error('rerolled an existing exercise decision'); };
function randomDelay(delay) {
  let calls = 0;
  return () => calls++ === 0 ? 0 : (EXERCISE_DELAY_MINUTES.indexOf(delay) + 0.1) / 4;
}
function tick(state, offset, extra = {}) {
  const admission = prepareExerciseAdmission(state, at(offset, extra));
  const movement = reconcileRegimeLocation(admission.state, at(offset));
  return { ...movement, events: [...admission.events, ...movement.events] };
}
const episode = (state) => state.exerciseEpisodes.find((item) => item.id === `exercise:${DATE}`);

test('no-delay day keeps the normal exercise movements, duration and one episode', () => {
  const begun = tick(cell(), 0, { rnd: () => 0.99 });
  assert.equal(begun.events.length, 2);
  assert.equal(begun.state.current.id, LOCATIONS.EXERCISE_YARD);
  assert.equal(episode(begun.state).admission.delay_minutes, 0);
  assert.equal(episode(begun.state).started_at, new Date(START).toISOString());
  assert.equal(begun.state.exerciseEpisodes.length, 1);
  assert.equal(tick(begun.state, 1, { rnd: neverRoll }).events.length, 0);
  const ended = tick(begun.state, 60, { rnd: neverRoll });
  assert.equal(ended.state.current.id, LOCATIONS.CELL);
  assert.equal(episode(ended.state).status, 'COMPLETE');
  assert.equal(ended.events.length, 2);
  assert.equal(episode(ended.state).admission.window_ended_at, new Date(END).toISOString());
});

for (const delay of EXERCISE_DELAY_MINUTES) test(`${delay}-minute hold really defers admission, not the closing time`, () => {
  let current = tick(cell(), 0, { rnd: randomDelay(delay) });
  assert.deepEqual(current.events.map((event) => event.eventType), ['exercise_admission_withheld']);
  assert.equal(current.state.current.id, LOCATIONS.CELL);
  assert.equal(current.state.current.regime_activity, 'EXERCISE_ADMISSION_HELD');
  const admission = episode(current.state).admission;
  assert.equal(admission.release_target_at, new Date(START + delay * 60_000).toISOString());
  assert.equal(admission.scheduled_end_at, new Date(END).toISOString());
  current = tick(current.state, delay - 1, { rnd: neverRoll });
  assert.equal(current.events.length, 0);
  assert.equal(current.state.current.id, LOCATIONS.CELL);
  current = tick(current.state, delay, { rnd: neverRoll });
  assert.equal(current.state.current.id, LOCATIONS.EXERCISE_YARD);
  assert.deepEqual(current.events.map((event) => event.eventType), [
    'exercise_admission_permitted', 'location_transition', 'location_transition',
  ]);
  assert.equal(current.events[0].cyObserved, false, 'permission is not an invented announcement');
  assert.equal(episode(current.state).started_at, new Date(START + delay * 60_000).toISOString());
  assert.equal(tick(current.state, delay + 1, { rnd: neverRoll }).events.length, 0);
  const ended = tick(current.state, 60, { rnd: neverRoll });
  assert.equal(episode(ended.state).ended_at, new Date(END).toISOString());
  assert.equal(ended.state.current.id, LOCATIONS.CELL);
  assert.equal(ended.state.exerciseEpisodes.length, 1);
});

test('decision is made once even under repeated same-time ticks and serialized restarts', () => {
  const selected = tick(cell(), 0, { rnd: randomDelay(25) });
  const target = episode(selected.state).admission.release_target_at;
  let state = JSON.parse(JSON.stringify(selected.state));
  for (let offset = 0; offset < 25; offset++) {
    const next = tick(state, offset, { rnd: neverRoll, restart: offset === 10 });
    assert.equal(next.state.current.id, LOCATIONS.CELL);
    assert.equal(next.events.length, 0);
    assert.equal(episode(next.state).admission.release_target_at, target);
    state = next.state;
  }
  const released = tick(state, 25, { rnd: neverRoll });
  assert.equal(released.events.filter((event) => event.eventType === 'exercise_admission_permitted').length, 1);
  assert.equal(tick(released.state, 25, { rnd: neverRoll }).events.length, 0);
});

test('restart after the target admits only now, never backdates attendance or observed release', () => {
  const held = tick(cell(), 0, { rnd: randomDelay(15) });
  const resumed = tick(JSON.parse(JSON.stringify(held.state)), 35, { restart: true, rnd: neverRoll });
  assert.equal(episode(resumed.state).admission.release_target_at, new Date(START + 15 * 60_000).toISOString());
  assert.equal(episode(resumed.state).admission.permitted_at, new Date(START + 35 * 60_000).toISOString());
  assert.equal(episode(resumed.state).started_at, new Date(START + 35 * 60_000).toISOString());
  assert.equal(resumed.events[0].cyObserved, false);
  assert.ok(resumed.events.every((event) => event.occurredAt === new Date(START + 35 * 60_000).toISOString()));
  assert.equal(resumed.state.observationGaps.length, 1);
});

test('restart beyond the whole window records only no recorded attendance, not a yard visit', () => {
  const held = tick(cell(), 0, { rnd: randomDelay(40) });
  const resumed = tick(held.state, 90, { restart: true, rnd: neverRoll });
  assert.equal(resumed.state.current.id, LOCATIONS.CELL);
  assert.equal(episode(resumed.state).status, 'MISSED');
  assert.equal(episode(resumed.state).started_at, null);
  assert.equal(episode(resumed.state).admission.permitted_at, null);
  assert.deepEqual(resumed.events.map((event) => event.eventType), ['exercise_admission_missed']);
  assert.equal(resumed.events[0].cyObserved, false);
  assert.equal(resumed.state.observationGaps.length, 1);
  assert.equal(tick(resumed.state, 91, { rnd: neverRoll }).events.length, 0);
});

test('a late observed decision may consume the window without inventing an earlier wait', () => {
  const held = tick(cell(), 45, { rnd: randomDelay(20) });
  assert.equal(episode(held.state).admission.withheld_at, new Date(START + 45 * 60_000).toISOString());
  assert.equal(episode(held.state).admission.release_target_at, new Date(START + 65 * 60_000).toISOString());
  const expired = tick(held.state, 60, { rnd: neverRoll });
  assert.equal(expired.state.current.id, LOCATIONS.CELL);
  assert.equal(episode(expired.state).status, 'MISSED');
  assert.equal(episode(expired.state).started_at, null);
  assert.deepEqual(expired.events.map((event) => event.eventType), ['exercise_admission_missed']);
  assert.equal(tick(expired.state, 65, { rnd: neverRoll }).events.length, 0);
});

test('lockdown outlasts the delay: permission does not override the restriction', () => {
  let state = startLockdownEpisode(cell(), { nowMs: START, durationMs: 30 * 60_000 }).state;
  state = tick(state, 0, { rnd: randomDelay(15) }).state;
  const permitted = tick(state, 15, { rnd: neverRoll });
  assert.equal(permitted.state.current.id, LOCATIONS.CELL);
  assert.equal(permitted.events[0].eventType, 'exercise_admission_permitted');
  state = advanceLockdownEpisode(permitted.state, { nowMs: START + 30 * 60_000 }).state;
  const admitted = tick(state, 30, { rnd: neverRoll });
  assert.equal(admitted.state.current.id, LOCATIONS.EXERCISE_YARD);
  assert.equal(episode(admitted.state).started_at, new Date(START + 30 * 60_000).toISOString());
});

test('lockdown through closing records one missed episode and cannot release afterward', () => {
  let state = startLockdownEpisode(cell(), { nowMs: START, durationMs: 90 * 60_000 }).state;
  state = tick(state, 0, { rnd: randomDelay(15) }).state;
  state = tick(state, 15, { rnd: neverRoll }).state;
  const missed = tick(state, 60, { rnd: neverRoll });
  assert.equal(episode(missed.state).status, 'MISSED');
  const unlocked = advanceLockdownEpisode(missed.state, { nowMs: START + 90 * 60_000 }).state;
  assert.equal(tick(unlocked, 90, { rnd: neverRoll }).events.length, 0);
});

test('an active search prevents yard admission even after permission; completion permits entry', () => {
  let state = startCellSearchEpisode(cell(), { nowMs: START }).state;
  state = tick(state, 0, { rnd: randomDelay(15) }).state;
  const permitted = tick(state, 15, { rnd: neverRoll });
  assert.equal(permitted.state.current.id, LOCATIONS.CELL);
  state = permitted.state;
  state.searchEpisode.status = 'COMPLETE';
  assert.equal(tick(state, 20, { rnd: neverRoll }).state.current.id, LOCATIONS.EXERCISE_YARD);
});

test('a hold never relocates Cy from an ongoing routine', () => {
  let state = startScheduledRoutineEpisode(cell(), {
    nowMs: START, date: DATE, routine: 'association', outcome: 'association_quiet_company',
  }).state;
  const held = tick(state, 0, { rnd: randomDelay(15) });
  assert.equal(held.state.current.id, LOCATIONS.ASSOCIATION);
  assert.equal(held.events[0].cyObserved, false);
  const permitted = tick(held.state, 15, { rnd: neverRoll });
  assert.equal(permitted.state.current.id, LOCATIONS.ASSOCIATION);
});

test('fresh startup in the window is not attendance; legacy recorded attendance is not rerolled', () => {
  const initial = reconcileLocationRegimeState(null, at());
  assert.equal(initial.current.id, LOCATIONS.CELL);
  assert.equal(initial.activeExerciseEpisode, null);
  const legacy = reconcileRegimeLocation(cell(), at()).state;
  assert.equal(legacy.current.id, LOCATIONS.EXERCISE_YARD);
  const preserved = prepareExerciseAdmission(legacy, at(10, { restart: true, rnd: neverRoll }));
  assert.equal(preserved.events.length, 0);
  assert.deepEqual(preserved.state.exerciseEpisodes, legacy.exerciseEpisodes);
});

test('an entirely unobserved window without a decision cannot manufacture a missed-day story', () => {
  const next = tick(cell(), 90, { restart: true, rnd: neverRoll });
  assert.equal(next.events.length, 0);
  assert.equal(next.state.exerciseEpisodes.length, 0);
});

test('transit recovery cannot bypass a hold or lose the eventual attendance record', () => {
  let state = tick(cell(), 0, { rnd: randomDelay(15) }).state;
  state.current.id = LOCATIONS.WING_OR_LANDING;
  const heldRecovery = tick(state, 5, { restart: true, rnd: neverRoll });
  assert.equal(heldRecovery.state.current.id, LOCATIONS.CELL);
  assert.equal(episode(heldRecovery.state).started_at, null);
  const permitted = prepareExerciseAdmission(heldRecovery.state, at(15, { rnd: neverRoll })).state;
  permitted.current.id = LOCATIONS.WING_OR_LANDING;
  const recovered = reconcileRegimeLocation(permitted, at(15));
  assert.equal(recovered.state.current.id, LOCATIONS.EXERCISE_YARD);
  assert.equal(episode(recovered.state).started_at, new Date(START + 15 * 60_000).toISOString());
  assert.ok(recovered.state.activeExerciseEpisode);
  const ended = tick(recovered.state, 60, { rnd: neverRoll });
  assert.equal(episode(ended.state).status, 'COMPLETE');
  assert.equal(ended.events.some((event) => event.eventType === 'exercise_admission_missed'), false);
});

test('night suppression survives permission and does not imply a visit', () => {
  const selected = prepareExerciseAdmission(cell(), at(0, { asleep: true, rnd: randomDelay(15) }));
  assert.equal(selected.events[0].cyObserved, false);
  const permitted = prepareExerciseAdmission(selected.state, at(15, { asleep: true, rnd: neverRoll }));
  assert.equal(exerciseAdmissionAllows(permitted.state, DATE, START + 15 * 60_000), true);
  const sleeping = reconcileRegimeLocation(permitted.state, at(15, { asleep: true }));
  assert.equal(sleeping.state.current.id, LOCATIONS.CELL);
  assert.equal(episode(sleeping.state).started_at, null);
});

test('the release target and closing time use the supplied London clock in BST and GMT', () => {
  for (const [date, hour] of [['2026-10-21', '13'], ['2026-10-28', '14']]) {
    const nowMs = Date.parse(`${date}T${hour}:15:04.125Z`);
    const result = prepareExerciseAdmission(cell(), { nowMs, date, minutes: 855, rnd: randomDelay(20) });
    const admission = result.state.exerciseEpisodes.at(-1).admission;
    assert.equal(admission.scheduled_end_at, new Date(nowMs - 4125 + 60 * 60_000).toISOString());
    assert.equal(admission.release_target_at, new Date(nowMs + 20 * 60_000).toISOString());
  }
});

test('facts name no officer, escort, conversation or staffing cause; no social/object effects', () => {
  const held = tick(cell(), 0, { rnd: randomDelay(15) });
  const permitted = tick(held.state, 15, { rnd: neverRoll });
  for (const event of [...held.events, ...permitted.events]) {
    assert.doesNotMatch(event.summary, /officer|escort|said|staff/i);
    assert.equal(event.world.social, undefined);
    assert.equal(event.world.participants, undefined);
    const record = createEnvironmentRecord(createEnvironmentEvent('ambient_world_event', {
      id: 'fixture', timestamp: event.occurredAt, eventType: event.eventType,
      world: event.world, observation: event.observation,
    }));
    assert.equal(record.world_event.world.exercise_admission?.stage || 'movement',
      event.world.exercise_admission?.stage || 'movement');
  }
});

test('event references persist on the same exercise record without duplicate admission links', () => {
  const held = tick(cell(), 0, { rnd: randomDelay(15) });
  let state = registerEpisodeEvent(held.state, 'held-source', { exerciseEpisodeId: `exercise:${DATE}` });
  state = registerEpisodeEvent(state, 'held-source', { exerciseEpisodeId: `exercise:${DATE}` });
  state = tick(state, 15, { rnd: neverRoll }).state;
  state = registerEpisodeEvent(state, 'entered-source', { exerciseEpisodeId: `exercise:${DATE}` });
  state = tick(state, 60, { rnd: neverRoll }).state;
  state = registerEpisodeEvent(state, 'returned-source', { exerciseEpisodeId: `exercise:${DATE}` });
  assert.deepEqual(episode(state).event_ids, ['held-source', 'entered-source', 'returned-source']);
  assert.equal(state.exerciseEpisodes.length, 1);
  assert.ok(episode(state).admission.window_ended_at);
});

test('the next daily exercise decision is independent; old episodes are bounded', () => {
  let state = cell();
  for (let day = 0; day < 20; day++) {
    const nowMs = START + day * 86400_000;
    const date = new Date(nowMs).toISOString().slice(0, 10);
    const selected = prepareExerciseAdmission(state, { nowMs, date, minutes: 855, rnd: () => 0.99 });
    state = selected.state;
    assert.equal(state.exerciseEpisodes.at(-1).admission.delay_minutes, 0);
  }
  assert.equal(state.exerciseEpisodes.length, 14);
});

test('checkpointed admission, source links and stable pending deliveries survive real sectioned persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cy-exercise-admission-'));
  try {
    const path = join(dir, 'vitals.json');
    const vitals = await loadVitals(path);
    vitals.locationRegime = tick(cell(), 0, { rnd: randomDelay(25) }).state;
    const delivery = { kind: 'event', ts: new Date(START).toISOString(), delivery_id: randomUUID(),
      payload: { name: 'exercise_admission_withheld', exercise_episode_id: `exercise:${DATE}` } };
    stageExerciseDelivery(vitals.locationRegime, delivery);
    stageExerciseDelivery(vitals.locationRegime, delivery);
    await saveVitals(path, vitals);
    const restored = await loadVitals(path);
    assert.equal(restored.locationRegime.pendingExerciseEvents.length, 1);
    assert.deepEqual(restored.locationRegime.exerciseEpisodes, vitals.locationRegime.exerciseEpisodes);
    const resumed = tick(restored.locationRegime, 10, { restart: true, rnd: neverRoll });
    assert.equal(resumed.state.current.id, LOCATIONS.CELL);
    assert.equal(episode(resumed.state).admission.release_target_at, new Date(START + 25 * 60_000).toISOString());
    const client = new Client({ dryRun: true }, dir);
    client.enqueueExerciseEpisodeEvent(delivery);
    assert.equal(client.batch[0].delivery_id, delivery.delivery_id);
    assert.throws(() => client.enqueueExerciseEpisodeEvent({ ...delivery, delivery_id: null }));
    assert.throws(() => client.enqueueExerciseEpisodeEvent({ ...delivery, kind: 'text' }));
    await client.flush(); // fixture file only; no provider, no network
    assert.equal(acknowledgeExerciseDeliveries(restored.locationRegime, [delivery]), true);
    assert.equal(acknowledgeExerciseDeliveries(restored.locationRegime, [delivery]), false);
    await saveVitals(path, restored);
    assert.equal((await loadVitals(path)).locationRegime.pendingExerciseEvents.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runner wiring commits admission before movement and exercise history before network admission', async () => {
  const runner = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  const scheduler = runner.slice(runner.indexOf('async function scheduler(now)'), runner.indexOf('// ---- vitals tick every tickMs'));
  const select = scheduler.indexOf('prepareExerciseAdmission(');
  const commit = scheduler.indexOf('await checkpointExerciseEvents();', select);
  assert.ok(select >= 0 && commit > select && commit < scheduler.indexOf('processLocationRegime(now'));
  const barrier = runner.slice(runner.indexOf('async function checkpointExerciseEvents()'), runner.indexOf('function processLocationRegime('));
  assert.match(barrier, /await persistExerciseDeliveries\(vitals.locationRegime,[\s\S]*saveVitals\(vitalsPath, vitals\)/);
  const deviations = runner.slice(runner.indexOf('const DEVIATIONS ='), runner.indexOf('// did we cross'));
  assert.doesNotMatch(deviations, /exercise_yard\s*:/);
  assert.match(deviations, /unlock_slop:/, 'morning path is outside this exercise-only change');
  assert.match(scheduler, /worldSchedulerInFlight/);
  assert.match(runner, /acknowledgeExerciseDeliveries/);
});

test('failed checkpoint sends nothing; recovery and lost acknowledgements reuse stable deliveries', async () => {
  const state = tick(cell(), 0, { rnd: randomDelay(15) }).state;
  const event = { delivery_id: randomUUID(), kind: 'event', payload: {
    name: 'exercise_admission_withheld', exercise_episode_id: `exercise:${DATE}`,
  } };
  stageExerciseDelivery(state, event);
  const sent = [];
  const enqueued = new Set();
  await assert.rejects(persistExerciseDeliveries(state, async () => { throw new Error('disk'); },
    (entry) => sent.push(entry), enqueued));
  assert.equal(sent.length, 0);
  const order = [];
  await persistExerciseDeliveries(state, async () => { order.push('saved'); },
    (entry) => { order.push('enqueued'); sent.push(entry); }, enqueued);
  assert.deepEqual(order, ['saved', 'enqueued']);
  await persistExerciseDeliveries(state, async () => {}, (entry) => sent.push(entry), enqueued);
  assert.equal(sent.length, 1, 'a normal repeated flush is not another enqueue');
  // A process restart loses the in-memory set, not the checkpointed identity.
  await persistExerciseDeliveries(JSON.parse(JSON.stringify(state)), async () => {}, (entry) => sent.push(entry));
  assert.equal(sent.length, 2);
  assert.equal(new Set(sent.map((entry) => entry.delivery_id)).size, 1,
    'the existing transactional ingest receipt sees one logical publication');
});
