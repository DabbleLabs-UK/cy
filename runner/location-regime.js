// location-regime.js - authoritative physical location and regime episodes.
//
// The clock supplies deterministic movement opportunities. This module stores
// facts only: no affect, appraisal, prose or psychological action selection.

import { EXERCISE_REGIME } from './environment.js';
import { isCurrentMessageObject } from './message-object-lifecycle.js';

export const LOCATION_REGIME_SCHEMA = 'cy.location-regime';
export const LOCATION_REGIME_VERSION = 1;

export const LOCATIONS = Object.freeze({
  CELL: 'CELL',
  EXERCISE_YARD: 'EXERCISE_YARD',
  WING_OR_LANDING: 'WING_OR_LANDING',
  SHOWER: 'SHOWER',
  ASSOCIATION: 'ASSOCIATION',
  PHONE: 'PHONE',
});

export const LOCATION_CONTEXT_IDS = Object.freeze({
  CELL: 'cell',
  EXERCISE_YARD: 'exercise_yard',
  WING_OR_LANDING: 'wing',
  SHOWER: 'shower',
  ASSOCIATION: 'association',
  PHONE: 'phone',
});

export { EXERCISE_REGIME };

export const SEARCH_STAGES = Object.freeze([
  'INITIATED',
  'CY_INSTRUCTION',
  'SEARCH_ONGOING',
  'PROPERTY_RESULT',
  'SEARCH_COMPLETE',
  'AFTERMATH_OBSERVED',
]);

// ENGINEERING WORLD-PACING. Each scheduler tick may advance at most one stage;
// this floor prevents a whole institutional episode collapsing into one instant.
export const SEARCH_STAGE_MIN_MS = 15 * 1000;
export const MAX_OBSERVATION_GAPS = 20;
export const YARD_OBSERVATION_INTERVAL_MS = 15 * 60 * 1000;
export const ROUTINE_DURATIONS_MS = Object.freeze({
  shower: 15 * 60 * 1000,
  association: 30 * 60 * 1000,
  phone: 10 * 60 * 1000,
});
const ROUTINE_LOCATIONS = Object.freeze({
  shower: LOCATIONS.SHOWER,
  association: LOCATIONS.ASSOCIATION,
  phone: LOCATIONS.PHONE,
});
const ROUTINE_ARRIVALS = Object.freeze({
  shower: 'Cy was taken for his shower turn',
  association: 'Cy was let out for association',
  phone: 'Cy reached the phones',
});

// The stable defensive-context identity a lockdown always opens and later
// resolves under, regardless of which episode instance produced it.
export const LOCKDOWN_CONTEXT_ID = 'custody:lockdown';
// A real institutional lockdown lasts somewhere between a slow stand-down and
// a couple of hours. The duration is a random draw made ONCE at start and
// persisted on the episode (scheduled_release_at) - not a hidden timer - so a
// restart mid-lockdown resumes toward the same, already-decided release fact.
export const LOCKDOWN_MIN_DURATION_MS = 25 * 60 * 1000;
export const LOCKDOWN_MAX_DURATION_MS = 90 * 60 * 1000;
export const CELL_SEARCH_TICK_CHANCE = 0.0008;

const VALID_LOCATIONS = new Set(Object.values(LOCATIONS));
const VALID_STAGES = new Set(SEARCH_STAGES);
const VALID_LOCKDOWN_STATUSES = new Set(['ACTIVE', 'COMPLETE']);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value, max = 240) {
  return value == null ? '' : String(value).trim().slice(0, max);
}

function iso(value, fallbackMs = Date.now()) {
  const ms = Date.parse(String(value || ''));
  return new Date(Number.isFinite(ms) ? ms : fallbackMs).toISOString();
}

export function isExerciseMinutes(minutes) {
  const mins = Number(minutes);
  return Number.isFinite(mins)
    && mins >= EXERCISE_REGIME.startMinutes
    && mins < EXERCISE_REGIME.endMinutes;
}

export function locationContextId(locationId) {
  return LOCATION_CONTEXT_IDS[locationId] || null;
}

export function currentRegimeActivity(minutes, { asleep = false } = {}) {
  if (asleep) return 'SLEEP_PERIOD';
  if (isExerciseMinutes(minutes)) return 'DAILY_EXERCISE';
  return 'CELL_TIME';
}

export function nextRegimeTransition(minutes) {
  const mins = Math.max(0, Math.min(1439, Number(minutes) || 0));
  if (mins < EXERCISE_REGIME.startMinutes) {
    return { activity: 'DAILY_EXERCISE', atMinutes: EXERCISE_REGIME.startMinutes };
  }
  if (mins < EXERCISE_REGIME.endMinutes) {
    return { activity: 'CELL_TIME', atMinutes: EXERCISE_REGIME.endMinutes };
  }
  return { activity: 'DAILY_EXERCISE', atMinutes: EXERCISE_REGIME.startMinutes, nextDay: true };
}

function initialLocation(nowMs, date, minutes, asleep) {
  const yard = !asleep && isExerciseMinutes(minutes);
  const state = {
    schema: LOCATION_REGIME_SCHEMA,
    version: LOCATION_REGIME_VERSION,
    current: {
      id: yard ? LOCATIONS.EXERCISE_YARD : LOCATIONS.CELL,
      entered_at: new Date(nowMs).toISOString(),
      reason: yard ? 'daily exercise window was active at state initialisation' : 'state initialised in cell',
      source_event_id: null,
      regime_activity: currentRegimeActivity(minutes, { asleep }),
      transition_provenance: 'DETERMINISTIC_REGIME_INITIALISATION',
    },
    activeRegimeEpisode: yard ? {
      id: `exercise:${date}`,
      type: 'DAILY_EXERCISE',
      date,
      status: 'ACTIVE',
      started_at: new Date(nowMs).toISOString(),
      ended_at: null,
      event_ids: [],
    } : null,
    activeExerciseEpisode: yard ? {
      id: `exercise:${date}`,
      date,
      status: 'ACTIVE',
      started_at: new Date(nowMs).toISOString(),
      ended_at: null,
      event_ids: [],
      interaction_count: 0,
      last_observation_at: new Date(nowMs).toISOString(),
    } : null,
    exerciseEpisodes: [],
    activeRoutineEpisode: null,
    routineEpisodes: [],
    searchEpisode: null,
    lockdownEpisode: null,
    observationGaps: [],
    lastTransitionAt: new Date(nowMs).toISOString(),
  };
  if (state.activeExerciseEpisode) state.exerciseEpisodes.push(clone(state.activeExerciseEpisode));
  return state;
}

export function reconcileLocationRegimeState(saved, {
  nowMs = Date.now(),
  date = new Date(nowMs).toISOString().slice(0, 10),
  minutes = 0,
  asleep = false,
} = {}) {
  const base = initialLocation(nowMs, date, minutes, asleep);
  if (!saved || saved.schema !== LOCATION_REGIME_SCHEMA
      || Number(saved.version) !== LOCATION_REGIME_VERSION) return base;
  const locationId = saved.current && clean(saved.current.id);
  if (!VALID_LOCATIONS.has(locationId)) return base;
  const out = clone(saved);
  out.current.entered_at = iso(out.current.entered_at, nowMs);
  out.current.reason = clean(out.current.reason) || 'restored persistent location';
  out.current.source_event_id = clean(out.current.source_event_id) || null;
  out.current.regime_activity = clean(out.current.regime_activity) || currentRegimeActivity(minutes, { asleep });
  out.current.transition_provenance = clean(out.current.transition_provenance) || 'PERSISTED_STATE_RESTORE';
  out.observationGaps = Array.isArray(out.observationGaps)
    ? out.observationGaps.slice(-MAX_OBSERVATION_GAPS) : [];
  out.exerciseEpisodes = Array.isArray(out.exerciseEpisodes)
    ? out.exerciseEpisodes.slice(-14) : [];
  out.routineEpisodes = Array.isArray(out.routineEpisodes)
    ? out.routineEpisodes.slice(-42) : [];
  if (!out.activeRoutineEpisode
    || !ROUTINE_LOCATIONS[out.activeRoutineEpisode.routine]
    || out.activeRoutineEpisode.status !== 'ACTIVE'
    || !out.activeRoutineEpisode.scheduled_end_at
    || !out.activeRoutineEpisode.id) out.activeRoutineEpisode = null;
  if (out.activeRoutineEpisode
    && locationId !== ROUTINE_LOCATIONS[out.activeRoutineEpisode.routine]) {
    const orphan = out.activeRoutineEpisode;
    const stored = out.routineEpisodes.find((episode) => episode.id === orphan.id);
    if (stored) Object.assign(stored, { status: 'INTERRUPTED', ended_at: new Date(nowMs).toISOString() });
    out.observationGaps.push({
      started_at: orphan.started_at, detected_at: new Date(nowMs).toISOString(),
      reason: 'routine episode disagreed with authoritative location', resolution: locationId,
    });
    out.observationGaps = out.observationGaps.slice(-MAX_OBSERVATION_GAPS);
    out.activeRoutineEpisode = null;
  }
  if (out.searchEpisode && (!out.searchEpisode.id || !VALID_STAGES.has(out.searchEpisode.stage))) {
    out.searchEpisode = null;
  }
  if (out.lockdownEpisode && (
    !out.lockdownEpisode.id
    || !VALID_LOCKDOWN_STATUSES.has(out.lockdownEpisode.status)
    || !out.lockdownEpisode.started_at
    || !out.lockdownEpisode.scheduled_release_at
  )) {
    out.lockdownEpisode = null;
  }
  return out;
}

function movementEvent({ episodeId, from, to, summary, provenance, cyObserved = true, occurredAt }) {
  return {
    eventType: 'location_transition',
    summary,
    occurredAt,
    cyObserved,
    world: {
      context: {
        location: locationContextId(to),
        description: summary,
        associated_entities: ['cy:7734'],
      },
      temporal: { onset: 'event', persistence: 'completed', recurrence: 'routine' },
      situation: { predictability: 'routine', resolution_status: 'resolved' },
      movement: {
        episode_id: episodeId,
        from_location: from,
        to_location: to,
        transition_provenance: provenance,
      },
    },
    observation: {
      modality: cyObserved ? 'direct' : 'none',
      certainty: cyObserved ? 'certain' : 'unknown',
      observed_facts: cyObserved ? { from_location: from, to_location: to } : {},
    },
  };
}

function setLocation(state, to, event, provenance) {
  state.current = {
    id: to,
    entered_at: event.occurredAt,
    reason: event.summary,
    source_event_id: null,
    regime_activity: to === LOCATIONS.EXERCISE_YARD ? 'DAILY_EXERCISE' : 'CELL_TIME',
    transition_provenance: provenance,
  };
  state.lastTransitionAt = event.occurredAt;
}

export function reconcileRegimeLocation(stateValue, {
  nowMs = Date.now(),
  date = new Date(nowMs).toISOString().slice(0, 10),
  minutes = 0,
  asleep = false,
  provenance = 'FICTIONAL_REGIME_SCHEDULE',
} = {}) {
  const state = reconcileLocationRegimeState(stateValue, { nowMs, date, minutes, asleep });
  const events = [];
  const at = new Date(nowMs).toISOString();
  const lockdownActive = state.lockdownEpisode?.status === 'ACTIVE';
  const routine = state.activeRoutineEpisode;
  if (routine && state.current.id === ROUTINE_LOCATIONS[routine.routine]) {
    if (nowMs < Date.parse(routine.scheduled_end_at) && !lockdownActive) {
      state.current.regime_activity = `ROUTINE_${routine.routine.toUpperCase()}`;
      return { state, events, nextTransition: nextRegimeTransition(minutes) };
    }
    const returned = movementEvent({
      episodeId: routine.id, from: state.current.id, to: LOCATIONS.CELL,
      summary: 'Cy was returned to his cell after the routine',
      provenance: lockdownActive ? 'LOCKDOWN_INTERRUPTED_ROUTINE' : 'FICTIONAL_REGIME_SCHEDULE',
      occurredAt: at,
    });
    events.push(returned);
    setLocation(state, LOCATIONS.CELL, returned, returned.world.movement.transition_provenance);
    routine.status = 'COMPLETE';
    routine.ended_at = at;
    const stored = state.routineEpisodes.find((item) => item.id === routine.id);
    if (stored) Object.assign(stored, clone(routine));
    state.activeRoutineEpisode = null;
  } else if (Object.values(ROUTINE_LOCATIONS).includes(state.current.id)) {
    state.observationGaps.push({
      started_at: state.current.entered_at, detected_at: at,
      reason: 'routine location had no matching active episode', resolution: LOCATIONS.CELL,
    });
    state.observationGaps = state.observationGaps.slice(-MAX_OBSERVATION_GAPS);
    const recovered = movementEvent({
      episodeId: `routine-recovery:${date}`, from: state.current.id, to: LOCATIONS.CELL,
      summary: 'Cy was returned to his cell after the recorded routine',
      provenance: 'DETERMINISTIC_RESTART_RECOVERY', occurredAt: at,
    });
    events.push(recovered);
    setLocation(state, LOCATIONS.CELL, recovered, 'DETERMINISTIC_RESTART_RECOVERY');
  }
  const shouldBeYard = !asleep && !lockdownActive && isExerciseMinutes(minutes);
  const isYard = state.current.id === LOCATIONS.EXERCISE_YARD;
  const isTransit = state.current.id === LOCATIONS.WING_OR_LANDING;
  if (isTransit) {
    state.observationGaps.push({
      started_at: state.current.entered_at,
      detected_at: at,
      reason: 'restart occurred during a transient movement stage',
      resolution: shouldBeYard ? LOCATIONS.EXERCISE_YARD : LOCATIONS.CELL,
    });
    state.observationGaps = state.observationGaps.slice(-MAX_OBSERVATION_GAPS);
    const recovered = movementEvent({
      episodeId: shouldBeYard ? `exercise:${date}` : state.activeExerciseEpisode?.id || `exercise:${date}`,
      from: LOCATIONS.WING_OR_LANDING,
      to: shouldBeYard ? LOCATIONS.EXERCISE_YARD : LOCATIONS.CELL,
      summary: shouldBeYard
        ? 'The recorded escort resumed with Cy on the exercise yard'
        : 'The recorded escort resumed with Cy back in his cell',
      provenance: 'DETERMINISTIC_RESTART_RECOVERY',
      occurredAt: at,
    });
    events.push(recovered);
    setLocation(state, shouldBeYard ? LOCATIONS.EXERCISE_YARD : LOCATIONS.CELL,
      recovered, 'DETERMINISTIC_RESTART_RECOVERY');
  }
  if (shouldBeYard && !isYard && !isTransit) {
    const episodeId = `exercise:${date}`;
    const first = movementEvent({
      episodeId, from: state.current.id, to: LOCATIONS.WING_OR_LANDING,
      summary: 'Cy was unlocked and escorted along the landing for exercise', provenance, occurredAt: at,
    });
    events.push(first);
    const second = movementEvent({
      episodeId, from: LOCATIONS.WING_OR_LANDING, to: LOCATIONS.EXERCISE_YARD,
      summary: 'Cy was taken onto the exercise yard', provenance, occurredAt: at,
    });
    events.push(second);
    setLocation(state, LOCATIONS.EXERCISE_YARD, second, provenance);
    const episode = {
      id: episodeId, type: 'DAILY_EXERCISE', date, status: 'ACTIVE',
      started_at: at, ended_at: null, event_ids: [], interaction_count: 0,
      last_observation_at: at,
    };
    state.activeRegimeEpisode = clone(episode);
    state.activeExerciseEpisode = clone(episode);
    state.exerciseEpisodes = [...state.exerciseEpisodes, clone(episode)].slice(-14);
  } else if (!shouldBeYard && isYard && !isTransit) {
    const episodeId = state.activeExerciseEpisode && state.activeExerciseEpisode.id || `exercise:${date}`;
    const first = movementEvent({
      episodeId, from: LOCATIONS.EXERCISE_YARD, to: LOCATIONS.WING_OR_LANDING,
      summary: 'Exercise ended and Cy was taken back inside', provenance, occurredAt: at,
    });
    events.push(first);
    const second = movementEvent({
      episodeId, from: LOCATIONS.WING_OR_LANDING, to: LOCATIONS.CELL,
      summary: 'Cy was returned to his cell', provenance, occurredAt: at,
    });
    events.push(second);
    setLocation(state, LOCATIONS.CELL, second, provenance);
    if (state.activeExerciseEpisode) {
      state.activeExerciseEpisode.status = 'COMPLETE';
      state.activeExerciseEpisode.ended_at = at;
      const stored = state.exerciseEpisodes.find((item) => item.id === state.activeExerciseEpisode.id);
      if (stored) Object.assign(stored, clone(state.activeExerciseEpisode));
    }
    if (state.activeRegimeEpisode) {
      state.activeRegimeEpisode.status = 'COMPLETE';
      state.activeRegimeEpisode.ended_at = at;
    }
    state.activeExerciseEpisode = null;
    state.activeRegimeEpisode = null;
  } else {
    state.current.regime_activity = lockdownActive ? 'LOCKDOWN' : currentRegimeActivity(minutes, { asleep });
  }
  if (lockdownActive) state.current.regime_activity = 'LOCKDOWN';
  return { state, events, nextTransition: nextRegimeTransition(minutes) };
}

export function canStartScheduledRoutine(state, date, routine) {
  if (!ROUTINE_LOCATIONS[routine]) return false;
  if (state?.current?.id !== LOCATIONS.CELL) return false;
  if (state.lockdownEpisode?.status === 'ACTIVE' || state.searchEpisode?.status === 'ACTIVE') return false;
  if (state.activeRoutineEpisode?.status === 'ACTIVE') return false;
  return !(state.routineEpisodes || []).some((episode) => episode.id === `routine:${date}:${routine}`);
}

export function startScheduledRoutineEpisode(stateValue, {
  nowMs = Date.now(), date, routine, outcome,
} = {}) {
  const state = clone(stateValue);
  if (!canStartScheduledRoutine(state, date, routine)
    || !String(outcome || '').startsWith(`${routine}_`)) {
    return { state, started: false, event: null };
  }
  const at = new Date(nowMs).toISOString();
  const id = `routine:${date}:${routine}`;
  // A missed turn is a real outcome, but cannot assert that Cy physically
  // attended a shower or reached a phone that he never got to use.
  if (outcome === 'shower_missed' || outcome === 'phone_queue_missed') {
    state.routineEpisodes = [...(state.routineEpisodes || []), {
      id, date, routine, outcome, status: 'COMPLETE', started_at: null,
      scheduled_end_at: null, ended_at: at, event_ids: [],
    }].slice(-42);
    return { state, started: false, event: null };
  }
  const event = movementEvent({
    episodeId: id, from: LOCATIONS.CELL, to: ROUTINE_LOCATIONS[routine],
    summary: ROUTINE_ARRIVALS[routine],
    provenance: 'FICTIONAL_REGIME_SCHEDULE', occurredAt: at,
  });
  const episode = {
    id, date, routine, outcome, status: 'ACTIVE', started_at: at,
    scheduled_end_at: new Date(nowMs + ROUTINE_DURATIONS_MS[routine]).toISOString(),
    ended_at: null, event_ids: [],
  };
  state.activeRoutineEpisode = episode;
  state.routineEpisodes = [...(state.routineEpisodes || []), clone(episode)].slice(-42);
  setLocation(state, ROUTINE_LOCATIONS[routine], event, 'FICTIONAL_REGIME_SCHEDULE');
  state.current.regime_activity = `ROUTINE_${routine.toUpperCase()}`;
  return { state, started: true, event };
}

export function awgLocationEligible(locationState) {
  if (locationState?.lockdownEpisode?.status === 'ACTIVE') return false;
  if (locationState?.searchEpisode?.status === 'ACTIVE') return false;
  return [LOCATIONS.CELL, LOCATIONS.EXERCISE_YARD, LOCATIONS.WING_OR_LANDING]
    .includes(locationState?.current?.id);
}

export function availableExpressiveActions(locationState, cadence = {}, { silenceAvailable = true } = {}) {
  const location = locationState && locationState.current && locationState.current.id;
  if (location !== LOCATIONS.CELL) return [];
  const actions = [];
  if (cadence.journal) actions.push('journal');
  if (cadence.draw) actions.push('draw');
  if (silenceAvailable) actions.push('silence');
  return actions;
}

export function eventAllowedAtLocation(eventType, locationState) {
  const type = clean(eventType).toLowerCase();
  const location = locationState && locationState.current && locationState.current.id;
  if (location !== LOCATIONS.CELL
    && ['journal', 'draw', 'drawing', 'sleep', 'injury_cell', 'cell_search_present'].includes(type)) return false;
  if (location === LOCATIONS.CELL && ['yard_interaction', 'yard_quiet'].includes(type)) return false;
  return true;
}

export function createYardObservation({ nowMs = Date.now(), cast = null, variant = 'quiet', makeId } = {}) {
  const id = typeof makeId === 'function' ? makeId('yard') : `yard:${nowMs}`;
  const at = new Date(nowMs).toISOString();
  if (variant === 'quiet' || !cast) {
    return {
      id, eventType: 'yard_quiet', occurredAt: at,
      summary: 'Cy walked the exercise yard without speaking to anyone',
      social: null,
    };
  }
  const actorId = clean(cast.key || cast.id);
  const actorName = clean(cast.name || actorId);
  const variants = {
    company: `${actorName} fell into step beside Cy for part of the exercise period`,
    conversation: `${actorName} spoke briefly with Cy while they walked the yard`,
    avoided: `${actorName} saw Cy on the yard and kept his distance`,
  };
  const summary = variants[variant] || variants.company;
  const contact = variant !== 'avoided';
  return {
    id, eventType: 'yard_interaction', occurredAt: at, summary,
    social: {
      episode_id: id,
      episode_type: contact ? 'CONTACT' : 'OPPORTUNITY',
      start_at: at,
      end_at: at,
      linked_event_ids: [],
      actor_id: actorId, actor_label: actorName,
      target_id: 'cy:7734', target_label: 'Cy', relationship_ref: actorId,
      channel: 'IN_PERSON',
      contact_form: contact ? (variant === 'company' ? 'PASSIVE_CO_PRESENCE' : 'DIRECT_INTERACTION') : 'ATTEMPTED_CONTACT',
      direction: variant === 'conversation' ? 'MUTUAL' : 'INITIATED_BY_OTHER',
      reciprocity: variant === 'conversation' ? 'RECIPROCAL' : 'ONE_WAY',
      character: variant === 'avoided' ? 'AMBIGUOUS' : 'ORDINARY',
      resolution: 'COMPLETED',
      opportunity_id: contact ? null : id,
      opportunity_status: contact ? 'NOT_APPLICABLE' : 'NOT_TAKEN',
      action_executed: contact ? variant : null,
      continuously_observed: false,
      alone_established: false,
      no_contact_established: false,
    },
  };
}

export function startCellSearchEpisode(stateValue, {
  nowMs = Date.now(), actorId = 'officer:unknown', actorName = 'an officer',
  objects = [], makeId,
} = {}) {
  const state = clone(stateValue);
  if (state.searchEpisode && state.searchEpisode.status === 'ACTIVE') {
    return { state, started: false, reason: 'SEARCH_ALREADY_ACTIVE', event: null };
  }
  const id = typeof makeId === 'function' ? makeId('search') : `search:${nowMs}`;
  const at = new Date(nowMs).toISOString();
  const cyPresent = state.current.id === LOCATIONS.CELL;
  const existing = (Array.isArray(objects) ? objects : []).find((object) =>
    object && (object.status === 'ACTIVE'
      || (object.type === 'message' && object.status === 'DELIVERED'
        && isCurrentMessageObject(object)))
      && object.location === 'cell'
      && ['cy', 'cy:7734'].includes(object.holderId || object.ownerId));
  state.searchEpisode = {
    id, status: 'ACTIVE', stage: 'INITIATED', stage_entered_at: at,
    started_at: at, completed_at: null,
    actor_id: clean(actorId), actor_name: clean(actorName),
    cy_present_at_start: cyPresent,
    cy_knowledge: cyPresent ? 'CY_DIRECTLY_OBSERVED' : 'UNKNOWN_TO_CY',
    object_id: existing ? existing.id : null,
    property_result: null,
    linked_event_ids: [],
  };
  return {
    state, started: true,
    event: searchStageEvent(state.searchEpisode, {
      stage: 'INITIATED', nowMs,
      summary: cyPresent ? `${clean(actorName)} arrived at Cy's cell to begin a search` : 'Officers began a search of Cy\'s empty cell',
      cyObserved: cyPresent,
    }),
  };
}

function searchStageEvent(episode, { stage, nowMs, summary, cyObserved }) {
  return {
    eventType: `cell_search_${stage.toLowerCase()}`,
    summary,
    occurredAt: new Date(nowMs).toISOString(),
    cyObserved,
    world: {
      participants: { actor: episode.actor_id, target: 'cy', relationship_ref: episode.actor_id },
      context: { location: 'cell', description: summary, associated_entities: [episode.actor_id] },
      temporal: { onset: 'event', persistence: stage === 'AFTERMATH_OBSERVED' ? 'completed' : 'ongoing', recurrence: 'unknown' },
      situation: {
        control: 'none', agency: 'officer', responsibility_evidence: 'present',
        resolution_status: ['SEARCH_COMPLETE', 'AFTERMATH_OBSERVED'].includes(stage) ? 'resolved' : 'unresolved',
      },
      associative_learning: {
        linkage: 'episode_stage', explicit_signals: [`cell_search:${episode.id}:${stage}`],
        outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: stage === 'SEARCH_COMPLETE' ? 'occurred' : 'unknown' }],
      },
      defensive_context: {
        context_id: `custody:cell_search:${episode.id}`,
        temporal_status: ['SEARCH_COMPLETE', 'AFTERMATH_OBSERVED'].includes(stage) ? 'RESOLVED' : 'ONGOING',
        adverse_outcome_classes: ['COERCIVE_LOSS_OF_CONTROL'],
      },
      search_episode: {
        id: episode.id, stage, cy_knowledge: cyObserved ? 'CY_DIRECTLY_OBSERVED' : 'UNKNOWN_TO_CY',
        object_id: episode.object_id, property_result: episode.property_result,
      },
    },
    observation: {
      modality: cyObserved ? 'direct' : 'none', certainty: cyObserved ? 'certain' : 'unknown',
      observed_facts: cyObserved ? { search_episode_id: episode.id, stage } : {},
    },
  };
}

export function advanceCellSearchEpisode(stateValue, {
  nowMs = Date.now(), objects = [], force = false,
} = {}) {
  const state = clone(stateValue);
  const episode = state.searchEpisode;
  if (!episode || episode.status !== 'ACTIVE') return { state, advanced: false, event: null, actionOpportunity: null };
  const elapsed = nowMs - Date.parse(episode.stage_entered_at || episode.started_at);
  if (!force && elapsed < SEARCH_STAGE_MIN_MS) return { state, advanced: false, event: null, actionOpportunity: null };
  const presentNow = state.current.id === LOCATIONS.CELL;
  let next = null;
  let summary = '';
  let cyObserved = episode.cy_present_at_start && presentNow;
  let actionOpportunity = null;
  if (episode.stage === 'INITIATED') {
    if (episode.cy_present_at_start) {
      next = 'CY_INSTRUCTION';
      summary = `${episode.actor_name} instructed Cy to stand aside while the cell was searched`;
      actionOpportunity = 'COMPLY_OR_REFUSE';
    } else {
      next = 'SEARCH_ONGOING';
      summary = 'Officers searched Cy\'s cell while he was elsewhere';
      cyObserved = false;
    }
  } else if (episode.stage === 'CY_INSTRUCTION') {
    next = 'SEARCH_ONGOING';
    summary = 'The search of Cy\'s cell began';
  } else if (episode.stage === 'SEARCH_ONGOING') {
    next = 'PROPERTY_RESULT';
    const object = (Array.isArray(objects) ? objects : []).find((item) => item
      && item.id === episode.object_id
      && item.location === 'cell'
      && (item.status === 'ACTIVE'
        || (item.type === 'message' && item.status === 'DELIVERED' && isCurrentMessageObject(item))));
    episode.property_result = object ? 'EXISTING_OBJECT_INSPECTED' : 'NOTHING_FOUND';
    summary = object ? 'Officers examined an existing item in the cell' : 'The search found nothing';
    actionOpportunity = object && episode.cy_present_at_start ? 'HAND_OVER_OR_WITHHOLD' : null;
  } else if (episode.stage === 'PROPERTY_RESULT') {
    next = 'SEARCH_COMPLETE';
    summary = 'The officers completed the cell search';
  } else if (episode.stage === 'SEARCH_COMPLETE') {
    if (!presentNow) return { state, advanced: false, event: null, actionOpportunity: null, waitingForAftermath: true };
    next = 'AFTERMATH_OBSERVED';
    cyObserved = true;
    summary = episode.cy_present_at_start
      ? 'The cell search ended and Cy remained in the cell'
      : episode.property_result === 'NOTHING_FOUND'
        ? 'Cy returned to the cell after it had been searched'
        : episode.property_result === 'EXISTING_OBJECT_CONFISCATED'
          ? 'Cy returned and found that an item was no longer in the cell'
          : 'Cy returned and saw signs that the cell had been searched';
    episode.cy_knowledge = episode.cy_present_at_start ? 'CY_DIRECTLY_OBSERVED' : 'CY_LEARNED_FROM_AFTERMATH';
  } else if (episode.stage === 'AFTERMATH_OBSERVED') {
    episode.status = 'COMPLETE';
    episode.completed_at = new Date(nowMs).toISOString();
    return { state, advanced: true, event: null, actionOpportunity: null, completed: true };
  }
  episode.stage = next;
  episode.stage_entered_at = new Date(nowMs).toISOString();
  if (next === 'AFTERMATH_OBSERVED') {
    episode.status = 'COMPLETE';
    episode.completed_at = episode.stage_entered_at;
  }
  const event = searchStageEvent(episode, { stage: next, nowMs, summary, cyObserved });
  return { state, advanced: true, event, actionOpportunity, completed: episode.status === 'COMPLETE' };
}

// lockdownStageEvent builds the START or RELEASE environment event for a
// persisted lockdown episode. Both reuse the 'lockdown' archetype and the
// SAME stable defensive_context.context_id, so a new lockdown re-opens
// exactly the context a prior lockdown resolved, and the RELEASE event never
// re-declares an outcome for the original coercive-loss class: it closes the
// ongoing condition without asserting the historical event did not occur.
function lockdownStageEvent(episode, { stage, nowMs }) {
  const at = new Date(nowMs).toISOString();
  if (stage === 'RELEASED') {
    return {
      eventType: 'lockdown_ended',
      summary: 'The lockdown was lifted and the regime returned to normal.',
      occurredAt: at,
      cyObserved: true,
      world: {
        situation: { resolution_status: 'resolved' },
        associative_learning: { linkage: 'self_contained_event', outcomes: [] },
        defensive_context: {
          context_id: LOCKDOWN_CONTEXT_ID,
          temporal_status: 'RESOLVED',
          adverse_outcome_classes: ['COERCIVE_LOSS_OF_CONTROL'],
        },
        custody_lockdown_episode: { id: episode.id, stage: 'RELEASED', released_at: at },
      },
      observation: {
        modality: 'direct', certainty: 'certain',
        observed_facts: { lockdown_episode_id: episode.id, stage: 'RELEASED' },
      },
    };
  }
  return {
    eventType: 'lockdown_started',
    summary: 'A full lockdown was called; movement and association stopped.',
    occurredAt: at,
    cyObserved: true,
    world: {
      associative_learning: {
        linkage: 'self_contained_event',
        explicit_signals: [`lockdown:${episode.id}:STARTED`],
        outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' }],
      },
      defensive_context: {
        context_id: LOCKDOWN_CONTEXT_ID,
        temporal_status: 'ONGOING',
        adverse_outcome_classes: ['COERCIVE_LOSS_OF_CONTROL'],
      },
      custody_lockdown_episode: {
        id: episode.id, stage: 'STARTED', scheduled_release_at: episode.scheduled_release_at,
      },
    },
    observation: {
      modality: 'direct', certainty: 'certain',
      observed_facts: { lockdown_episode_id: episode.id, stage: 'STARTED' },
    },
  };
}

// Starts a persisted lockdown episode. A lockdown already ACTIVE makes this a
// safe no-op (started: false) - a duplicate trigger cannot open a second,
// overlapping episode or re-emit the start event/evidence.
export function startLockdownEpisode(stateValue, { nowMs = Date.now(), makeId, durationMs } = {}) {
  const state = clone(stateValue);
  if (state.lockdownEpisode && state.lockdownEpisode.status === 'ACTIVE') {
    return { state, started: false, reason: 'LOCKDOWN_ALREADY_ACTIVE', event: null };
  }
  const id = typeof makeId === 'function' ? makeId('lockdown') : `lockdown:${nowMs}`;
  const at = new Date(nowMs).toISOString();
  const duration = Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : LOCKDOWN_MIN_DURATION_MS + Math.floor(Math.random() * (LOCKDOWN_MAX_DURATION_MS - LOCKDOWN_MIN_DURATION_MS));
  const episode = {
    id, status: 'ACTIVE',
    started_at: at,
    scheduled_release_at: new Date(nowMs + duration).toISOString(),
    released_at: null,
    linked_event_ids: [],
  };
  state.lockdownEpisode = episode;
  return { state, started: true, event: lockdownStageEvent(episode, { stage: 'STARTED', nowMs }) };
}

// Releases a persisted lockdown episode once its already-decided
// scheduled_release_at has passed. No active episode, or the release time not
// yet reached, is a safe no-op (released: false) - this also makes a
// duplicate/replayed advance call after release produce nothing further.
export function advanceLockdownEpisode(stateValue, { nowMs = Date.now() } = {}) {
  const state = clone(stateValue);
  const episode = state.lockdownEpisode;
  if (!episode || episode.status !== 'ACTIVE') return { state, released: false, event: null };
  if (nowMs < Date.parse(episode.scheduled_release_at)) return { state, released: false, event: null };
  episode.status = 'COMPLETE';
  episode.released_at = new Date(nowMs).toISOString();
  return { state, released: true, event: lockdownStageEvent(episode, { stage: 'RELEASED', nowMs }) };
}

export function registerEpisodeEvent(stateValue, eventId, {
  locationSource = false, routineEpisodeId = null,
} = {}) {
  const state = clone(stateValue);
  const id = clean(eventId);
  if (!id) return state;
  if (state.activeExerciseEpisode) state.activeExerciseEpisode.event_ids.push(id);
  if (state.activeRegimeEpisode) state.activeRegimeEpisode.event_ids.push(id);
  if (state.activeRoutineEpisode && !state.activeRoutineEpisode.event_ids.includes(id)) {
    state.activeRoutineEpisode.event_ids.push(id);
  }
  if (state.searchEpisode) state.searchEpisode.linked_event_ids.push(id);
  if (state.lockdownEpisode) state.lockdownEpisode.linked_event_ids.push(id);
  const stored = state.activeExerciseEpisode
    && state.exerciseEpisodes.find((item) => item.id === state.activeExerciseEpisode.id);
  if (stored) Object.assign(stored, clone(state.activeExerciseEpisode));
  const storedRoutine = state.routineEpisodes?.find((item) =>
    item.id === (routineEpisodeId || state.activeRoutineEpisode?.id));
  if (storedRoutine && state.activeRoutineEpisode?.id === storedRoutine.id) {
    Object.assign(storedRoutine, clone(state.activeRoutineEpisode));
  } else if (storedRoutine && !storedRoutine.event_ids.includes(id)) {
    storedRoutine.event_ids.push(id);
  }
  if (locationSource) state.current.source_event_id = id;
  return state;
}

export function markSearchPropertyAction(stateValue, { action, objectId = null } = {}) {
  const state = clone(stateValue);
  if (!state.searchEpisode) return state;
  state.searchEpisode.object_id = objectId || state.searchEpisode.object_id;
  if (action === 'action:hand_over_item') state.searchEpisode.property_result = 'EXISTING_OBJECT_CONFISCATED';
  else if (action === 'action:withhold_item') state.searchEpisode.property_result = 'EXISTING_OBJECT_RETAINED';
  return state;
}
