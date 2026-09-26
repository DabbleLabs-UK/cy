import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXERCISE_REGIME,
  LOCATIONS,
  advanceCellSearchEpisode,
  availableExpressiveActions,
  createYardObservation,
  eventAllowedAtLocation,
  nextRegimeTransition,
  reconcileLocationRegimeState,
  reconcileRegimeLocation,
  startCellSearchEpisode,
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
