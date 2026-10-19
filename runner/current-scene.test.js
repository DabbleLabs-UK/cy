import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advanceCurrentYardScene, currentScenePresence, openCurrentYardScene,
  prepareYardEncounter, reconcileCurrentScene } from './current-scene.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { LOCATIONS, reconcileLocationRegimeState, reconcileRegimeLocation,
  createYardObservation } from './location-regime.js';
import { createSocialContactState, observeSocialContactRecord,
  reconcileSocialContactState } from './social-contact-substrate.js';
import { loadVitals, saveVitals } from './vitals.js';
import { environmentFormationAdmission } from './autobiographical-memory.js';

const AT = Date.parse('2026-10-19T13:30:00.000Z');
const DATE = '2026-10-19';
const TICK = 5000;
const ACTOR = { key: 'reg', name: 'Reg' };
const state = () => reconcileLocationRegimeState(null, { nowMs: AT, date: DATE, minutes: 14 * 60 + 30 });
function record(yard, id = 'env-canonical-yard-start') {
  return createEnvironmentRecord(createEnvironmentEvent('ambient_world_event', {
    id, timestamp: yard.occurredAt, eventType: yard.eventType,
    world: yard.world || { social: yard.social }, observation: yard.observation,
  }));
}
function start(variant = 'company', location = state()) {
  const event = prepareYardEncounter(location, {
    nowMs: AT, tickMs: TICK, cast: ACTOR, variant, makeId: () => 'yard-encounter-1',
  });
  const source = record(event);
  const opened = openCurrentYardScene(null, location, source, { nowMs: AT });
  return { location, event, source, scene: opened.state, opened: opened.opened };
}

test('only an authoritative direct yard contact starts an episode-bound scene', () => {
  for (const variant of ['company', 'conversation']) {
    const { scene, opened } = start(variant);
    assert.equal(opened, true);
    assert.deepEqual(scene.active.participants, ['cy:7734', 'reg']);
    assert.equal(scene.active.location, 'EXERCISE_YARD');
    assert.deepEqual(scene.active.observation, { observerId: 'cy:7734', channel: 'IN_PERSON',
      access: 'CY_DIRECT', identityBasis: 'DIRECT_ROUTINE_ENCOUNTER', voiceRecognition: false });
    assert.equal(scene.active.source.startEventId, 'env-canonical-yard-start');
    assert.notEqual(scene.active.source.startEventId, scene.active.id);
    assert.equal(scene.active.source.parentEpisodeId, `exercise:${DATE}`);
    assert.equal(scene.active.source.parentStartedAt, state().activeExerciseEpisode.started_at);
    assert.equal(scene.active.startedAt, new Date(AT).toISOString());
    assert.equal(scene.active.completionDueAt, new Date(AT + TICK).toISOString());
    assert.equal(scene.active.revision, 1);
  }
});

test('quiet and avoided outcomes keep their old history semantics and establish no company', () => {
  for (const variant of ['quiet', 'avoided']) {
    const { scene, opened, event } = start(variant);
    assert.equal(opened, false);
    assert.equal(scene.active, null);
    assert.equal(event.world.current_scene_source, undefined);
    assert.equal(event.social?.resolution || null, variant === 'avoided' ? 'COMPLETED' : null);
    if (variant === 'avoided') assert.equal(event.social.opportunity_status, 'NOT_TAKEN');
  }
});

test('historical completed contact, roster eligibility and non-direct access cannot create presence', () => {
  const location = state();
  const history = createYardObservation({ nowMs: AT, cast: ACTOR, variant: 'company' });
  assert.equal(openCurrentYardScene(null, location, record(history), { nowMs: AT }).opened, false);
  assert.equal(currentScenePresence(null, location, { nowMs: AT }), null);
  for (const mutate of [
    r => { r.observation.modality = 'heard'; },
    r => { r.world_event.world.context.location = 'cell'; },
    r => { r.world_event.world.participants.actor = 'bill'; },
    r => { r.world_event.world.social.actor_id = 'unlisted'; },
    r => { r.world_event.world.social.actor_label = 'Bill'; },
    r => { r.world_event.world.social.contact_form = 'DIRECT_INTERACTION'; },
    r => { r.schema = 'untrusted-history'; },
    r => { r.world_event.world.social.resolution = 'COMPLETED'; },
    r => { r.world_event.world.current_scene_source.parent_episode_id = 'old-exercise'; },
  ]) {
    const { source } = start(); mutate(source);
    assert.equal(openCurrentYardScene(null, location, source, { nowMs: AT }).opened, false);
  }
  assert.throws(() => prepareYardEncounter({ ...location, current: { id: 'CELL' } }, {
    nowMs: AT, tickMs: TICK, cast: ACTOR, variant: 'company',
  }), /active exercise/);
});

test('presence lasts only the new producer-owned world tick, never the observation interval', () => {
  const { scene, location } = start();
  assert.equal(currentScenePresence(scene, location, { nowMs: AT + 4999 }).id, 'yard-encounter-1');
  assert.equal(advanceCurrentYardScene(scene, location, { nowMs: AT + 1000 }).changed, false);
  assert.equal(currentScenePresence(scene, location, { nowMs: AT + 5000 }), null);
  const ended = advanceCurrentYardScene(scene, location, { nowMs: AT + 5000 });
  assert.equal(ended.state.active, null);
  assert.equal(ended.state.lastEnded.endReason, 'ENCOUNTER_COMPLETED');
  assert.equal(ended.event.world.social.end_at, new Date(AT + 5000).toISOString());
  assert.equal(ended.state.lastEnded.revision, 2);
  assert.equal(advanceCurrentYardScene(ended.state, location, { nowMs: AT + 6000 }).event, null);
  const delayed = advanceCurrentYardScene(scene, location, { nowMs: AT + 900000 });
  assert.equal(delayed.state.lastEnded.endedAt, new Date(AT + TICK).toISOString());
});

test('departure, location, parent episode, regime and observation boundaries invalidate immediately', () => {
  const cases = [
    ['PARTICIPANT_DEPARTED', () => {}, { departedParticipantIds: ['reg'] }],
    ['PARTICIPANT_DEPARTED', () => {}, { departedParticipantIds: ['cy'] }],
    ['CY_LOCATION_CHANGED', l => { l.current.id = 'CELL'; }, {}],
    ['CY_LOCATION_CHANGED', l => { l.current.entered_at = new Date(AT + 1).toISOString(); }, {}],
    ['REGIME_CHANGED', l => { l.lockdownEpisode = { status: 'ACTIVE' }; }, {}],
    ['EXERCISE_ENDED', l => { l.activeExerciseEpisode = null; }, {}],
    ['EXERCISE_ENDED', l => { l.activeExerciseEpisode.id = 'exercise:new'; }, {}],
    ['EXERCISE_ENDED', l => { l.current.regime_activity = 'CELL_TIME'; }, {}],
    ['OBSERVATION_LOST', () => {}, { observationJustified: false }],
    ['OBSERVATION_LOST', () => {}, { asleep: true }],
  ];
  for (const [reason, change, options] of cases) {
    const { scene, location } = start(); change(location);
    const ended = advanceCurrentYardScene(scene, location, { nowMs: AT + 1000, ...options });
    assert.equal(ended.state.active, null, reason);
    assert.equal(ended.state.lastEnded.endReason, reason);
    assert.equal(ended.event.world.social.resolution, 'INTERRUPTED');
  }
});

test('actual exercise return invalidates the companion instead of moving them into the cell', () => {
  const { scene, location } = start();
  const moved = reconcileRegimeLocation(location, { nowMs: AT + 1000, date: DATE, minutes: 15 * 60 + 15 });
  const ended = advanceCurrentYardScene(scene, moved.state, { nowMs: AT + 1000 });
  assert.equal(ended.state.lastEnded.endReason, 'CY_LOCATION_CHANGED');
  assert.equal(ended.state.lastEnded.location, 'EXERCISE_YARD');
  assert.equal(moved.state.current.id, LOCATIONS.CELL);
});

test('one social episode merges start and completion with canonical provenance, not two contacts', () => {
  const { source, scene, location } = start('conversation');
  const ledger = createSocialContactState(AT);
  observeSocialContactRecord(ledger, source);
  assert.deepEqual(environmentFormationAdmission(source), { admit: false, reason: 'EPISODE_NON_TERMINAL' });
  assert.equal(ledger.episodes[0].resolution, 'ONGOING');
  const end = advanceCurrentYardScene(scene, location, { nowMs: AT + TICK });
  assert.match(end.event.summary, /Reg spoke briefly with Cy while they walked the yard/,
    'the sole formation source retains the completed contact, not just an end marker');
  const endRecord = record(end.event, 'env-canonical-yard-end');
  observeSocialContactRecord(ledger, endRecord);
  assert.deepEqual(environmentFormationAdmission(endRecord), { admit: true, reason: 'EPISODE_REPRESENTATIVE' });
  assert.equal(ledger.episodes.length, 1);
  assert.equal(ledger.episodes[0].resolution, 'COMPLETED');
  assert.equal(ledger.episodes[0].durationMs, TICK);
  assert.deepEqual(ledger.episodes[0].linkedEnvironmentEventIds.sort(),
    ['env-canonical-yard-end', 'env-canonical-yard-start']);
  assert.equal(ledger.episodes[0].participants.actorId, 'reg');
});

test('restart fails closed even inside an otherwise active exercise episode', () => {
  const { scene, location, source } = start();
  const recovered = advanceCurrentYardScene(JSON.parse(JSON.stringify(scene)), location, { nowMs: AT + 1000, restart: true });
  assert.equal(recovered.state.active, null);
  assert.equal(recovered.state.lastEnded.endReason, 'RESTART_OBSERVATION_GAP');
  assert.equal(recovered.state.lastEnded.endedAt, scene.active.startedAt);
  assert.equal(recovered.event.cyObserved, false);
  assert.equal(openCurrentYardScene(recovered.state, location, source, { nowMs: AT }).opened, false);
  assert.equal(openCurrentYardScene(null, location, source, { nowMs: AT + 1000 }).opened, false);
  const ledger = createSocialContactState(AT);
  observeSocialContactRecord(ledger, source);
  const restored = reconcileSocialContactState(ledger, { now: AT + 1000 });
  assert.equal(restored.episodes[0].resolution, 'INTERRUPTED');
  assert.equal(restored.episodes[0].durationMs, 0);
});

test('current-scene state survives the real sectioned checkpoint without reviving after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cy-current-scene-'));
  try {
    const path = join(dir, 'vitals.json');
    const vitals = await loadVitals(path);
    const { scene, location } = start();
    vitals.currentScene = scene; vitals.locationRegime = location;
    await saveVitals(path, vitals);
    const restored = await loadVitals(path);
    assert.deepEqual(restored.currentScene, scene);
    const recovered = advanceCurrentYardScene(restored.currentScene, restored.locationRegime, { nowMs: AT + 1000, restart: true });
    restored.currentScene = recovered.state; await saveVitals(path, restored);
    const twice = await loadVitals(path);
    assert.equal(twice.currentScene.active, null);
    assert.equal(twice.currentScene.lastEnded.endReason, 'RESTART_OBSERVATION_GAP');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid stored scenes are not usable; unrelated eligible actors never enter a valid scene', () => {
  const { scene } = start();
  for (const mutate of [s => { s.active.observation.voiceRecognition = true; },
    s => { s.active.participants.push('bill'); }, s => { s.active.source = {}; },
    s => { s.revision += 1; }]) {
    const bad = structuredClone(scene); mutate(bad);
    assert.equal(reconcileCurrentScene(bad).active, null);
  }
  assert.deepEqual(scene.active.participants, ['cy:7734', 'reg']);
});

test('runtime plumbing stays out of AWG and keeps probabilities/cadence unchanged', async () => {
  const run = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  assert.match(run, /advanceCurrentYardScene\(vitals.currentScene, vitals.locationRegime, \{\s*nowMs: locationNow, restart: true/);
  assert.match(run, /tickMs: config.tickMs, cast, variant/);
  assert.match(run, /roll < 0\.35 \? 'quiet' : roll < 0\.60 \? 'company'/);
  const awg = run.slice(run.indexOf('async function runAwgDuringIdle'), run.indexOf('async function runAwgDuringIdle') + 8500);
  assert.doesNotMatch(awg, /currentScene|current-scene/);
});

test('offline counterfactual replay of two natural yard paths does not promote their historical records', () => {
  const cases = [
    { at: '2026-10-19T13:45:06.639Z', actor: { key: 'ping', name: 'Ping' }, variant: 'conversation',
      id: 'yard-4aeff40f-08ef-444b-90ae-3c5789f37cef', env: 'env-31f8f013-de81-4e4f-9e72-9530bb116cca', expected: true },
    { at: '2026-10-19T14:00:07.855Z', actor: { key: 'reg', name: 'Reg' }, variant: 'avoided',
      id: 'yard-c3f96112-d385-4744-98b2-ee3d2c08909c', env: 'env-4b10ae36-31a0-404c-8108-0551628117b0', expected: false },
  ];
  for (const sample of cases) {
    const nowMs = Date.parse(sample.at);
    const location = state();
    const old = createYardObservation({ nowMs, cast: sample.actor, variant: sample.variant, makeId: () => sample.id });
    assert.equal(openCurrentYardScene(null, location, record(old, sample.env), { nowMs }).opened, false);
    const candidate = prepareYardEncounter(location, { nowMs, tickMs: TICK, cast: sample.actor,
      variant: sample.variant, makeId: () => sample.id });
    // This is test-only re-execution of the new producer policy, not a rewrite
    // or a claim that the historical instantaneous source had a hidden lifetime.
    const opened = openCurrentYardScene(null, location, record(candidate, sample.env), { nowMs });
    assert.equal(opened.opened, sample.expected);
    if (sample.expected) {
      assert.deepEqual(opened.state.active.participants, ['cy:7734', 'ping']);
      assert.equal(currentScenePresence(opened.state, location, { nowMs: nowMs + TICK }), null);
      const end = advanceCurrentYardScene(opened.state, location, { nowMs: nowMs + TICK });
      assert.equal(end.state.lastEnded.endedAt, '2026-10-19T13:45:11.639Z');
    } else assert.equal(opened.state.active, null);
    assert.equal(old.social.end_at, old.social.start_at, 'historical zero-duration semantics stay unchanged');
  }
});
