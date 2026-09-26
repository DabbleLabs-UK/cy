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
});

export const LOCATION_CONTEXT_IDS = Object.freeze({
  CELL: 'cell',
  EXERCISE_YARD: 'exercise_yard',
  WING_OR_LANDING: 'wing',
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
export const CELL_SEARCH_TICK_CHANCE = 0.0008;

const VALID_LOCATIONS = new Set(Object.values(LOCATIONS));
const VALID_STAGES = new Set(SEARCH_STAGES);

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
    searchEpisode: null,
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
  if (out.searchEpisode && (!out.searchEpisode.id || !VALID_STAGES.has(out.searchEpisode.stage))) {
    out.searchEpisode = null;
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
  const shouldBeYard = !asleep && isExerciseMinutes(minutes);
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
    state.current.regime_activity = currentRegimeActivity(minutes, { asleep });
  }
  return { state, events, nextTransition: nextRegimeTransition(minutes) };
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
  if (location === LOCATIONS.EXERCISE_YARD) {
    if (['journal', 'draw', 'drawing', 'sleep', 'injury_cell', 'cell_search_present'].includes(type)) return false;
  }
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
    const object = (Array.isArray(objects) ? objects : []).find((item) => item && item.id === episode.object_id);
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

export function registerEpisodeEvent(stateValue, eventId, { locationSource = false } = {}) {
  const state = clone(stateValue);
  const id = clean(eventId);
  if (!id) return state;
  if (state.activeExerciseEpisode) state.activeExerciseEpisode.event_ids.push(id);
  if (state.activeRegimeEpisode) state.activeRegimeEpisode.event_ids.push(id);
  if (state.searchEpisode) state.searchEpisode.linked_event_ids.push(id);
  const stored = state.activeExerciseEpisode
    && state.exerciseEpisodes.find((item) => item.id === state.activeExerciseEpisode.id);
  if (stored) Object.assign(stored, clone(state.activeExerciseEpisode));
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
