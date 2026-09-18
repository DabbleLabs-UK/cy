// soma-replay-fixtures.js - compact synthetic prison-day replay cases.

import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { runSomaReplay } from './soma-replay.js';

const day = '2026-09-16';
const at = (time) => `${day}T${time}Z`;
const ms = (time) => Date.parse(at(time));

function record(archetypeId, id, time, { eventType = archetypeId, world = {}, observation = {} } = {}) {
  return createEnvironmentRecord(createEnvironmentEvent(archetypeId, {
    id,
    timestamp: at(time),
    eventType,
    world,
    observation,
  }));
}

function ordered(sequence, value) {
  return { sequence, record: value };
}

function resolvedContext({
  id,
  time,
  eventType,
  contextId,
  outcomeClass,
  outcomeStatus,
  location,
  actor,
  previousEventIds = [],
  actionOpportunity = {},
}) {
  return record('ambient_world_event', id, time, {
    eventType,
    world: {
      participants: { actor: actor || null, target: 'cy', relationship_ref: actor || null },
      situation: { control: 'limited', resolution_status: 'resolved' },
      context: { location, previous_event_ids: previousEventIds },
      associative_learning: {
        linkage: 'self_contained_event',
        outcomes: [{ outcome_class: outcomeClass, status: outcomeStatus }],
      },
      defensive_context: {
        context_id: contextId,
        temporal_status: 'RESOLVED',
        adverse_outcome_classes: [outcomeClass],
      },
      action_opportunity: actionOpportunity,
    },
    observation: { modality: 'direct', certainty: 'certain' },
  });
}

const quiet = {
  id: 'quiet-routine-baseline',
  title: 'Quiet routine baseline',
  startMs: ms('07:00:00.000'),
  endMs: ms('20:00:00.000'),
  records: [
    ordered(1, record('calm_routine', 'quiet-unlock', '07:30:00.000', { eventType: 'routine_unlock' })),
    ordered(2, record('meal', 'quiet-lunch', '12:00:00.000', {
      eventType: 'lunch_served',
      world: { physical: { food: {
        meal_id: 'quiet-lunch', meal_type: 'lunch', scheduled: 'yes', offered: 'yes',
        available: 'yes', received: 'yes', consumed: 'full', intake_outcome: 'full_consumed',
        portion_category: 'full', portion_fraction: 1,
      } } },
    })),
    ordered(3, record('calm_routine', 'quiet-lockup', '19:30:00.000', { eventType: 'routine_lockup' })),
  ],
};

const lockdownOnset = record('lockdown', 'lockdown-onset', '09:00:00.000', {
  eventType: 'lockdown_started',
});
const lockdownResolution = resolvedContext({
  id: 'lockdown-resolution',
  time: '12:00:00.000',
  eventType: 'lockdown_ended',
  contextId: 'custody:lockdown',
  outcomeClass: 'COERCIVE_LOSS_OF_CONTROL',
  outcomeStatus: 'did_not_occur',
  location: 'wing',
  previousEventIds: ['lockdown-onset'],
});

const uncertainLockdown = {
  id: 'prolonged-uncertain-lockdown',
  title: 'Prolonged uncertain lockdown',
  startMs: ms('08:00:00.000'),
  endMs: ms('13:00:00.000'),
  records: [ordered(1, lockdownOnset), ordered(2, lockdownResolution)],
};

const searchOnset = record('ambient_world_event', 'search-onset', '10:00:00.000', {
  eventType: 'officer_search_announced',
  world: {
    participants: { actor: 'keyes', target: 'cy', relationship_ref: 'keyes' },
    situation: { possible_harm: 'possible', control: 'limited', resolution_status: 'unresolved' },
    context: { location: 'cell' },
    associative_learning: {
      linkage: 'self_contained_event',
      outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'unknown' }],
    },
    defensive_context: {
      context_id: 'search:hostile',
      temporal_status: 'IMMINENT',
      adverse_outcome_classes: ['COERCIVE_LOSS_OF_CONTROL'],
    },
    action_opportunity: {
      id: 'search:hostile:choice', context_id: 'search:hostile', context_type: 'cell_search',
      available_actions: ['action:withhold_item', 'action:hand_over_item'], unavailable_actions: [],
      chosen_action: 'UNKNOWN', action_actually_executed: 'UNKNOWN', execution_status: 'UNKNOWN',
      onset_at: at('10:00:00.000'), resolved_at: null, resolution_status: 'UNRESOLVED',
      linked_event_ids: [], outcome_resolution: [],
    },
  },
  observation: { modality: 'direct', certainty: 'certain' },
});
const searchResolution = resolvedContext({
  id: 'search-resolution',
  time: '10:05:00.000',
  eventType: 'item_confiscated',
  contextId: 'search:hostile',
  outcomeClass: 'COERCIVE_LOSS_OF_CONTROL',
  outcomeStatus: 'occurred',
  location: 'cell',
  actor: 'keyes',
  previousEventIds: ['search-onset'],
  actionOpportunity: {
    id: 'search:hostile:choice', context_id: 'search:hostile', context_type: 'cell_search',
    available_actions: ['action:withhold_item', 'action:hand_over_item'], unavailable_actions: [],
    chosen_action: 'action:withhold_item', action_actually_executed: 'action:withhold_item',
    execution_status: 'EXECUTED', onset_at: at('10:00:00.000'), resolved_at: at('10:05:00.000'),
    resolution_status: 'RESOLVED', linked_event_ids: ['search-onset'],
    outcome_resolution: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' }],
  },
});

const hostileSearch = {
  id: 'hostile-search-confiscation',
  title: 'Hostile search and confiscation',
  startMs: ms('09:30:00.000'),
  endMs: ms('11:00:00.000'),
  records: [ordered(1, searchOnset), ordered(2, searchResolution)],
};

const supportiveContact = {
  id: 'supportive-social-contact',
  title: 'Supportive social contact',
  startMs: ms('14:00:00.000'),
  endMs: ms('16:00:00.000'),
  records: [ordered(1, record('friendly_interaction', 'supportive-contact', '15:00:00.000', {
    eventType: 'inmate_checked_in',
    world: {
      participants: { actor: 'reg', target: 'cy', relationship_ref: 'reg' },
      social: {
        episode_id: 'social:supportive-contact', episode_type: 'CONTACT',
        start_at: at('15:00:00.000'), end_at: at('15:05:00.000'),
        actor_id: 'reg', actor_label: 'Reg', target_id: 'cy:7734', target_label: 'Cy',
        relationship_ref: 'reg', channel: 'IN_PERSON', contact_form: 'SHARED_TIME',
        direction: 'INITIATED_BY_OTHER', reciprocity: 'RECIPROCAL', character: 'SUPPORTIVE',
        resolution: 'COMPLETED', continuously_observed: true,
      },
      context: { location: 'association' },
    },
  }))],
};

const mixedOnset = record('lockdown', 'mixed-lockdown-onset', '11:00:00.000', {
  eventType: 'mixed_lockdown_started',
  world: { defensive_context: { context_id: 'custody:mixed', temporal_status: 'ONGOING' } },
});
const mixedResolution = resolvedContext({
  id: 'mixed-lockdown-resolution',
  time: '11:00:00.000',
  eventType: 'mixed_lockdown_ended',
  contextId: 'custody:mixed',
  outcomeClass: 'COERCIVE_LOSS_OF_CONTROL',
  outcomeStatus: 'did_not_occur',
  location: 'wing',
  previousEventIds: ['mixed-lockdown-onset'],
});

const mixedDay = {
  id: 'mixed-chaotic-day',
  title: 'Mixed chaotic day',
  startMs: ms('08:00:00.000'),
  endMs: ms('18:00:00.000'),
  records: [
    ordered(1, record('meal', 'mixed-delayed-breakfast', '08:30:00.000', {
      eventType: 'breakfast_delayed',
      world: { physical: { food: { meal_type: 'breakfast', scheduled: 'yes', offered: 'unknown' } } },
    })),
    ordered(2, record('friendly_interaction', 'mixed-ordinary-contact', '10:00:00.000', {
      eventType: 'ordinary_contact',
      world: { participants: { actor: 'root', target: 'cy', relationship_ref: 'root' } },
    })),
    ordered(10, mixedOnset),
    ordered(11, mixedResolution),
  ],
};

const recoveryPrelude = runSomaReplay({
  startMs: ms('05:00:00.000'),
  endMs: ms('06:00:00.000'),
  records: [ordered(1, record('lockdown', 'recovery-prior-threat', '05:30:00.000', {
    eventType: 'recovery_lockdown_started',
    world: { defensive_context: { context_id: 'custody:recovery', temporal_status: 'ONGOING' } },
  }))],
});
const recoveryResolution = resolvedContext({
  id: 'recovery-resolution',
  time: '08:00:00.000',
  eventType: 'recovery_lockdown_ended',
  contextId: 'custody:recovery',
  outcomeClass: 'COERCIVE_LOSS_OF_CONTROL',
  outcomeStatus: 'did_not_occur',
  location: 'wing',
  previousEventIds: ['recovery-prior-threat'],
});

const recovery = {
  id: 'recovery-after-stress',
  title: 'Recovery after stress',
  startMs: ms('06:00:00.000'),
  endMs: ms('12:00:00.000'),
  initialState: recoveryPrelude.finalState,
  records: [
    ordered(1, recoveryResolution),
    ordered(2, record('calm_routine', 'recovery-routine', '10:00:00.000', {
      eventType: 'routine_resumed',
    })),
  ],
};

export const GOLDEN_SOMA_REPLAY_FIXTURES = Object.freeze([
  quiet,
  uncertainLockdown,
  hostileSearch,
  supportiveContact,
  mixedDay,
  recovery,
]);

export function goldenFixture(id) {
  return GOLDEN_SOMA_REPLAY_FIXTURES.find((fixture) => fixture.id === id) || null;
}
