import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXERCISE_REGIME,
  LOCATIONS,
  LOCKDOWN_CONTEXT_ID,
  LOCKDOWN_MAX_DURATION_MS,
  LOCKDOWN_MIN_DURATION_MS,
  advanceCellSearchEpisode,
  advanceLockdownEpisode,
  availableExpressiveActions,
  createYardObservation,
  eventAllowedAtLocation,
  nextRegimeTransition,
  reconcileLocationRegimeState,
  reconcileRegimeLocation,
  startCellSearchEpisode,
  startLockdownEpisode,
  markSearchPropertyAction,
} from './location-regime.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { createSocialContactState, observeSocialContactRecord } from './social-contact-substrate.js';

const DAY = '2026-09-13';
const AT = Date.parse(`${DAY}T12:00:00.000Z`);

function cell(minutes = 12 * 60) {
  return reconcileLocationRegimeState(null, { nowMs: AT, date: DAY, minutes });
}

test('exercise window has one authoritative fictional one-hour configuration', () => {
  assert.equal(EXERCISE_REGIME.startMinutes, 14 * 60 + 15);
  assert.equal(EXERCISE_REGIME.endMinutes, 15 * 60 + 15);
  assert.equal(EXERCISE_REGIME.durationMinutes, 60);
  assert.equal(nextRegimeTransition(14 * 60).atMinutes, EXERCISE_REGIME.startMinutes);
});

test('entering and leaving exercise creates explicit movements and persistent episodes', () => {
  const entered = reconcileRegimeLocation(cell(), { nowMs: AT, date: DAY, minutes: 14 * 60 + 15 });
  assert.deepEqual(entered.events.map((event) => event.world.movement.to_location), [
    LOCATIONS.WING_OR_LANDING, LOCATIONS.EXERCISE_YARD,
  ]);
  assert.equal(entered.state.current.id, LOCATIONS.EXERCISE_YARD);
  assert.equal(entered.state.activeExerciseEpisode.status, 'ACTIVE');
  const left = reconcileRegimeLocation(entered.state, { nowMs: AT + 3600_000, date: DAY, minutes: 15 * 60 + 15 });
  assert.deepEqual(left.events.map((event) => event.world.movement.to_location), [
    LOCATIONS.WING_OR_LANDING, LOCATIONS.CELL,
  ]);
  assert.equal(left.state.current.id, LOCATIONS.CELL);
  assert.equal(left.state.activeExerciseEpisode, null);
  assert.equal(left.state.exerciseEpisodes.length, 1);
  assert.equal(left.state.exerciseEpisodes[0].status, 'COMPLETE');
});

test('restart in transit resolves deterministically and records an observation gap', () => {
  const state = cell();
  state.current.id = LOCATIONS.WING_OR_LANDING;
  const recovered = reconcileRegimeLocation(state, { nowMs: AT + 1000, date: DAY, minutes: 16 * 60 });
  assert.equal(recovered.state.current.id, LOCATIONS.CELL);
  assert.equal(recovered.events[0].world.movement.transition_provenance, 'DETERMINISTIC_RESTART_RECOVERY');
  assert.equal(recovered.state.observationGaps.length, 1);
});

test('yard suppresses cell expressive actions and cell-only incidents', () => {
  const yard = reconcileRegimeLocation(cell(), { nowMs: AT, date: DAY, minutes: 14 * 60 + 30 }).state;
  assert.deepEqual(availableExpressiveActions(yard, { journal: true, draw: true }), []);
  assert.equal(eventAllowedAtLocation('journal', yard), false);
  assert.equal(eventAllowedAtLocation('cell_search_present', yard), false);
  assert.equal(eventAllowedAtLocation('yard_interaction', yard), true);
  assert.equal(eventAllowedAtLocation('yard_interaction', cell()), false);
});

test('yard contact is structured and quiet exercise is valid', () => {
  const social = createYardObservation({ nowMs: AT, cast: { key: 'reg', name: 'Reg' }, variant: 'conversation' });
  assert.equal(social.eventType, 'yard_interaction');
  assert.equal(social.social.episode_type, 'CONTACT');
  const record = createEnvironmentRecord(createEnvironmentEvent('ambient_world_event', {
    id: 'env-yard-test', timestamp: social.occurredAt, eventType: social.eventType,
    world: { social: social.social }, observation: { summary: social.summary },
  }));
  const ledger = createSocialContactState(AT);
  const observed = observeSocialContactRecord(ledger, record);
  assert.equal(observed.updated, true);
  assert.equal(ledger.episodes[0].socialCharacter, 'ORDINARY');
  const quiet = createYardObservation({ nowMs: AT, variant: 'quiet' });
  assert.equal(quiet.eventType, 'yard_quiet');
  assert.equal(quiet.social, null);
});

test('present cell search follows restart-safe stages and finds only existing objects', () => {
  const object = { id: 'object-note-1', status: 'ACTIVE', location: 'cell', holderId: 'cy' };
  let result = startCellSearchEpisode(cell(), { nowMs: AT, actorId: 'mr_proctor', actorName: 'Mr Proctor', objects: [object] });
  assert.equal(result.event.cyObserved, true);
  assert.equal(result.state.searchEpisode.object_id, object.id);
  result = advanceCellSearchEpisode(result.state, { nowMs: AT + 20_000, objects: [object] });
  assert.equal(result.event.world.search_episode.stage, 'CY_INSTRUCTION');
  assert.equal(result.actionOpportunity, 'COMPLY_OR_REFUSE');
  result = advanceCellSearchEpisode(result.state, { nowMs: AT + 40_000, objects: [object] });
  result = advanceCellSearchEpisode(result.state, { nowMs: AT + 60_000, objects: [object] });
  assert.equal(result.event.world.search_episode.property_result, 'EXISTING_OBJECT_INSPECTED');
  assert.equal(result.actionOpportunity, 'HAND_OVER_OR_WITHHOLD');
  const retained = markSearchPropertyAction(result.state, { action: 'action:withhold_item', objectId: object.id });
  assert.equal(retained.searchEpisode.property_result, 'EXISTING_OBJECT_RETAINED');
  const confiscated = markSearchPropertyAction(result.state, { action: 'action:hand_over_item', objectId: object.id });
  assert.equal(confiscated.searchEpisode.property_result, 'EXISTING_OBJECT_CONFISCATED');
  result = advanceCellSearchEpisode(result.state, { nowMs: AT + 80_000, objects: [object] });
  result = advanceCellSearchEpisode(result.state, { nowMs: AT + 100_000, objects: [object] });
  assert.equal(result.event.world.search_episode.stage, 'AFTERMATH_OBSERVED');
  assert.equal(result.state.searchEpisode.status, 'COMPLETE');
});

test('cell search sees current delivered messages but ignores resolved message history', () => {
  const currentMessage = {
    id: 'object-message-current', type: 'message', status: 'DELIVERED',
    location: 'cell', holderId: 'cy', ownerId: 'fisher',
    message: { lifecycleState: 'DELIVERED' },
  };
  const current = startCellSearchEpisode(cell(), { nowMs: AT, objects: [currentMessage] });
  assert.equal(current.state.searchEpisode.object_id, currentMessage.id);

  const resolvedMessage = {
    ...currentMessage,
    id: 'object-message-resolved',
    message: { lifecycleState: 'RESOLVED' },
  };
  const resolved = startCellSearchEpisode(cell(), { nowMs: AT, objects: [resolvedMessage] });
  assert.equal(resolved.state.searchEpisode.object_id, null);

  const retiredMessage = {
    ...currentMessage,
    id: 'object-message-retired',
    status: 'RETIRED',
    message: { lifecycleState: 'RETIRED' },
  };
  const retired = startCellSearchEpisode(cell(), { nowMs: AT, objects: [retiredMessage] });
  assert.equal(retired.state.searchEpisode.object_id, null);

  const mixed = startCellSearchEpisode(cell(), {
    nowMs: AT,
    objects: [retiredMessage, currentMessage],
  });
  assert.equal(mixed.state.searchEpisode.object_id, currentMessage.id);
});

test('offscreen search with no recorded object does not fabricate property or Cy knowledge', () => {
  const yard = reconcileRegimeLocation(cell(), { nowMs: AT, date: DAY, minutes: 14 * 60 + 30 }).state;
  let result = startCellSearchEpisode(yard, { nowMs: AT, objects: [] });
  assert.equal(result.event.cyObserved, false);
  result = advanceCellSearchEpisode(result.state, { nowMs: AT + 20_000, objects: [] });
  assert.equal(result.event.cyObserved, false);
  result = advanceCellSearchEpisode(result.state, { nowMs: AT + 40_000, objects: [] });
  assert.equal(result.event.world.search_episode.property_result, 'NOTHING_FOUND');
  assert.equal(result.state.searchEpisode.cy_knowledge, 'UNKNOWN_TO_CY');
});

test('search stage and knowledge survive reconciliation after restart', () => {
  let result = startCellSearchEpisode(cell(), { nowMs: AT, actorId: 'proctor', actorName: 'Mr Proctor' });
  result = advanceCellSearchEpisode(result.state, { nowMs: AT + 20_000, force: true });
  const restored = reconcileLocationRegimeState(JSON.parse(JSON.stringify(result.state)), {
    nowMs: AT + 25_000, date: DAY, minutes: 12 * 60,
  });
  assert.equal(restored.searchEpisode.stage, 'CY_INSTRUCTION');
  assert.equal(restored.searchEpisode.cy_knowledge, 'CY_DIRECTLY_OBSERVED');
});

// ---- lockdown lifecycle ----------------------------------------------------

test('lockdown starts once, opening the stable custody:lockdown context as ONGOING', () => {
  const started = startLockdownEpisode(cell(), { nowMs: AT, durationMs: 30 * 60 * 1000 });
  assert.equal(started.started, true);
  assert.equal(started.state.lockdownEpisode.status, 'ACTIVE');
  assert.equal(started.state.lockdownEpisode.started_at, new Date(AT).toISOString());
  assert.equal(started.state.lockdownEpisode.scheduled_release_at, new Date(AT + 30 * 60 * 1000).toISOString());
  assert.equal(started.state.lockdownEpisode.released_at, null);
  assert.equal(started.event.eventType, 'lockdown_started');
  assert.equal(started.event.cyObserved, true);
  assert.equal(started.event.world.defensive_context.context_id, LOCKDOWN_CONTEXT_ID);
  assert.equal(started.event.world.defensive_context.temporal_status, 'ONGOING');
  assert.deepEqual(started.event.world.associative_learning.outcomes,
    [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' }]);
});

test('a lockdown already active makes a second start a safe no-op', () => {
  const first = startLockdownEpisode(cell(), { nowMs: AT, durationMs: 30 * 60 * 1000 });
  const second = startLockdownEpisode(first.state, { nowMs: AT + 5000, durationMs: 30 * 60 * 1000 });
  assert.equal(second.started, false);
  assert.equal(second.reason, 'LOCKDOWN_ALREADY_ACTIVE');
  assert.equal(second.event, null);
  assert.deepEqual(second.state.lockdownEpisode, first.state.lockdownEpisode,
    'a duplicate/replayed start does not duplicate current state or history');
});

test('the same custody:lockdown context remains active while the episode is active, and release does not fire early', () => {
  const started = startLockdownEpisode(cell(), { nowMs: AT, durationMs: 30 * 60 * 1000 });
  const tooSoon = advanceLockdownEpisode(started.state, { nowMs: AT + 10 * 60 * 1000 });
  assert.equal(tooSoon.released, false);
  assert.equal(tooSoon.event, null);
  assert.equal(tooSoon.state.lockdownEpisode.status, 'ACTIVE');
});

test('explicit release closes the same context without negating the true start observation', () => {
  const started = startLockdownEpisode(cell(), { nowMs: AT, durationMs: 30 * 60 * 1000 });
  const released = advanceLockdownEpisode(started.state, { nowMs: AT + 30 * 60 * 1000 });
  assert.equal(released.released, true);
  assert.equal(released.state.lockdownEpisode.status, 'COMPLETE');
  assert.equal(released.state.lockdownEpisode.released_at, new Date(AT + 30 * 60 * 1000).toISOString());
  assert.equal(released.event.eventType, 'lockdown_ended');
  assert.equal(released.event.cyObserved, true);
  assert.equal(released.event.world.defensive_context.context_id, LOCKDOWN_CONTEXT_ID,
    'release resolves the SAME stable context the start opened');
  assert.equal(released.event.world.defensive_context.temporal_status, 'RESOLVED');
  assert.deepEqual(released.event.world.associative_learning.outcomes, [],
    'release must not write did_not_occur (or any status) for the coercive-loss class merely to resolve it');
});

test('duplicate/replayed release after resolution is a safe no-op', () => {
  const started = startLockdownEpisode(cell(), { nowMs: AT, durationMs: 30 * 60 * 1000 });
  const released = advanceLockdownEpisode(started.state, { nowMs: AT + 30 * 60 * 1000 });
  const again = advanceLockdownEpisode(released.state, { nowMs: AT + 40 * 60 * 1000 });
  assert.equal(again.released, false);
  assert.equal(again.event, null);
  assert.deepEqual(again.state.lockdownEpisode, released.state.lockdownEpisode,
    'a resolved lockdown cannot silently reopen or duplicate its resolution');
});

test('restart mid-lockdown keeps it active toward the same persisted release time', () => {
  const started = startLockdownEpisode(cell(), { nowMs: AT, durationMs: 30 * 60 * 1000 });
  const restored = reconcileLocationRegimeState(JSON.parse(JSON.stringify(started.state)), {
    nowMs: AT + 5 * 60 * 1000, date: DAY, minutes: 12 * 60,
  });
  assert.equal(restored.lockdownEpisode.status, 'ACTIVE',
    'an active lockdown cannot silently disappear across a restart');
  assert.equal(restored.lockdownEpisode.scheduled_release_at, started.state.lockdownEpisode.scheduled_release_at);
  const stillTooSoon = advanceLockdownEpisode(restored, { nowMs: AT + 6 * 60 * 1000 });
  assert.equal(stillTooSoon.released, false);
});

test('restart after resolution keeps the lockdown resolved, not reopened', () => {
  const started = startLockdownEpisode(cell(), { nowMs: AT, durationMs: 30 * 60 * 1000 });
  const released = advanceLockdownEpisode(started.state, { nowMs: AT + 30 * 60 * 1000 });
  const restored = reconcileLocationRegimeState(JSON.parse(JSON.stringify(released.state)), {
    nowMs: AT + 35 * 60 * 1000, date: DAY, minutes: 12 * 60,
  });
  assert.equal(restored.lockdownEpisode.status, 'COMPLETE');
  const noReopen = startLockdownEpisode(restored, { nowMs: AT + 40 * 60 * 1000, durationMs: 30 * 60 * 1000 });
  assert.equal(noReopen.started, true, 'a genuinely new lockdown may still start later');
  assert.notEqual(noReopen.state.lockdownEpisode.id, released.state.lockdownEpisode.id,
    'the new episode is a distinct instance, not a silent reopening of the resolved one');
  assert.equal(noReopen.event.world.defensive_context.context_id, LOCKDOWN_CONTEXT_ID,
    'a later, genuinely new lockdown still opens the same stable context');
});

test('a structurally invalid persisted lockdown episode is reset, not trusted blindly', () => {
  const started = startLockdownEpisode(cell(), { nowMs: AT, durationMs: 30 * 60 * 1000 });
  const corrupt = { ...started.state, lockdownEpisode: { status: 'ACTIVE' } }; // missing id/timestamps
  const restored = reconcileLocationRegimeState(JSON.parse(JSON.stringify(corrupt)), {
    nowMs: AT + 1000, date: DAY, minutes: 12 * 60,
  });
  assert.equal(restored.lockdownEpisode, null);
});

test('persisted state predating this fix (no lockdownEpisode key at all) reconciles and starts cleanly', () => {
  // Real production shape before this change: the key is entirely absent, not
  // null. Reconciliation must not choke on it, and the very next lockdown must
  // still be able to start and release normally against restored state.
  const legacy = cell();
  delete legacy.lockdownEpisode;
  assert.equal(Object.hasOwn(legacy, 'lockdownEpisode'), false);
  const restored = reconcileLocationRegimeState(JSON.parse(JSON.stringify(legacy)), {
    nowMs: AT, date: DAY, minutes: 12 * 60,
  });
  const started = startLockdownEpisode(restored, { nowMs: AT, durationMs: 1000 });
  assert.equal(started.started, true);
  const released = advanceLockdownEpisode(started.state, { nowMs: AT + 2000 });
  assert.equal(released.released, true);
  assert.equal(released.state.lockdownEpisode.status, 'COMPLETE');
});

test('lockdown duration is drawn once at start and stays fixed across advances that do not release it', () => {
  const started = startLockdownEpisode(cell(), { nowMs: AT });
  const scheduledMs = Date.parse(started.state.lockdownEpisode.scheduled_release_at);
  assert.ok(scheduledMs - AT >= LOCKDOWN_MIN_DURATION_MS && scheduledMs - AT <= LOCKDOWN_MAX_DURATION_MS);
  const later = advanceLockdownEpisode(started.state, { nowMs: AT + 1000 });
  assert.equal(later.state.lockdownEpisode.scheduled_release_at, started.state.lockdownEpisode.scheduled_release_at,
    'the persisted release fact does not drift or get re-rolled on later ticks');
});
