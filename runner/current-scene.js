// Authoritative, producer-owned brief yard encounters. Not an NPC location map.
// A contact occupies one world tick, NOT the 15-minute yard sampling interval.
import { BY_KEY } from './cast.js';
import { createYardObservation, LOCATIONS } from './location-regime.js';

export const CURRENT_SCENE_SCHEMA = 'cy.current-scene';
const PRODUCER = 'exercise-yard-encounter-v1';
const clone = (value) => value == null ? value : structuredClone(value);
const ms = (value) => Date.parse(String(value || ''));
const iso = (value) => new Date(value).toISOString();
const EMPTY = () => ({ schema: CURRENT_SCENE_SCHEMA, version: 1, revision: 0, active: null, lastEnded: null });

function activeExercise(location) {
  const episode = location?.activeExerciseEpisode;
  return location?.current?.id === LOCATIONS.EXERCISE_YARD
    && location.current.regime_activity === 'DAILY_EXERCISE'
    && episode?.status === 'ACTIVE' && episode.id && episode.started_at
    && location.lockdownEpisode?.status !== 'ACTIVE' ? episode : null;
}

function validScene(scene) {
  return scene?.status === 'ACTIVE' && typeof scene.id === 'string'
    && Number.isSafeInteger(scene.revision) && scene.revision > 0
    && scene.source?.producer === PRODUCER && scene.source.startEventId
    && scene.source.parentEpisodeId && scene.source.parentStartedAt
    && ['company', 'conversation'].includes(scene.source.variant)
    && scene.location === LOCATIONS.EXERCISE_YARD
    && scene.participants?.length === 2 && scene.participants[0] === 'cy:7734'
    && BY_KEY[scene.participants[1]] && !['root', 'daemon'].includes(scene.participants[1])
    && scene.observation?.observerId === 'cy:7734'
    && scene.observation.channel === 'IN_PERSON' && scene.observation.access === 'CY_DIRECT'
    && scene.observation.voiceRecognition === false
    && Number.isFinite(ms(scene.startedAt)) && ms(scene.completionDueAt) > ms(scene.startedAt)
    && scene.social?.episode_id === scene.id && scene.social.actor_id === scene.participants[1]
    && scene.social.actor_label === BY_KEY[scene.participants[1]].name
    && scene.social.episode_type === 'CONTACT' && scene.social.channel === 'IN_PERSON'
    && scene.social.contact_form === (scene.source.variant === 'company' ? 'PASSIVE_CO_PRESENCE' : 'DIRECT_INTERACTION')
    && scene.social.continuously_observed === true
    && scene.social.target_id === 'cy:7734' && scene.social.resolution === 'ONGOING'
    && scene.social.start_at === scene.startedAt && scene.social.end_at === null;
}

export function reconcileCurrentScene(saved) {
  const state = EMPTY();
  if (saved?.schema !== CURRENT_SCENE_SCHEMA || saved.version !== 1) return state;
  if (Number.isSafeInteger(saved.revision) && saved.revision >= 0) state.revision = saved.revision;
  if (validScene(saved.active) && saved.active.revision === state.revision) state.active = clone(saved.active);
  if (saved.lastEnded?.status === 'ENDED' || saved.lastEnded?.status === 'INTERRUPTED') {
    state.lastEnded = clone(saved.lastEnded);
  }
  return state;
}

// Only this routine producer creates the start marker. Historical completed
// social records (including old yard records) cannot initialize current scenes.
export function prepareYardEncounter(location, {
  nowMs, tickMs, cast, variant = 'quiet', makeId,
}) {
  const episode = activeExercise(location);
  if (!episode) throw new Error('yard observation requires an active exercise episode');
  const yard = createYardObservation({ nowMs, cast, variant, makeId });
  const contact = ['company', 'conversation'].includes(variant) && yard.social?.episode_type === 'CONTACT';
  if (contact) {
    if (!Number.isFinite(tickMs) || tickMs <= 0) throw new Error('world tick interval required');
    if (!BY_KEY[yard.social.actor_id] || ['root', 'daemon'].includes(yard.social.actor_id)
      || BY_KEY[yard.social.actor_id].name !== yard.social.actor_label) {
      throw new Error('unsupported yard actor');
    }
    yard.summary = variant === 'company'
      ? `${yard.social.actor_label} fell into step beside Cy on the exercise yard`
      : `${yard.social.actor_label} began a brief conversation with Cy on the exercise yard`;
    yard.social.end_at = null;
    yard.social.resolution = 'ONGOING';
    yard.social.continuously_observed = true;
  }
  return {
    ...yard, cyObserved: true,
    world: {
      participants: { actor: yard.social?.actor_id || null, target: 'cy', relationship_ref: yard.social?.actor_id || null },
      context: { location: 'exercise_yard', description: yard.summary,
        associated_entities: yard.social ? [yard.social.actor_id, 'cy:7734'] : ['cy:7734'] },
      temporal: { onset: 'event', persistence: contact ? 'ongoing' : 'completed', recurrence: 'routine' },
      situation: { resolution_status: contact ? 'unresolved' : 'resolved' },
      ...(yard.social ? { social: yard.social } : {}),
      ...(contact ? { current_scene_source: {
        producer: PRODUCER, parent_episode_id: episode.id, parent_started_at: episode.started_at,
        variant, started_at: iso(nowMs), completion: 'NEXT_WORLD_TICK',
        completion_due_at: iso(nowMs + tickMs), location_entered_at: location.current.entered_at,
      } } : {}),
    },
    observation: { modality: 'direct', certainty: 'certain', observed_facts: { location: 'exercise_yard' } },
  };
}

export function openCurrentYardScene(saved, location, record, { nowMs }) {
  const state = reconcileCurrentScene(saved);
  const event = record?.world_event;
  const world = event?.world;
  const source = world?.current_scene_source;
  const social = world?.social;
  const episode = activeExercise(location);
  const invalid = state.active || !episode || record?.schema !== 'cy.environment-record'
    || event?.schema !== 'cy.environment-event' || !event?.id || event.event_type !== 'yard_interaction'
    || world.context?.location !== 'exercise_yard' || record.observation?.modality !== 'direct'
    || record.observation.certainty !== 'certain' || source?.producer !== PRODUCER
    || source.parent_episode_id !== episode.id || source.parent_started_at !== episode.started_at
    || source.location_entered_at !== location.current.entered_at
    || source.started_at !== iso(nowMs) || source.completion !== 'NEXT_WORLD_TICK'
    || social?.episode_type !== 'CONTACT' || social.channel !== 'IN_PERSON'
    || world.participants?.actor !== social.actor_id || world.participants?.target !== 'cy'
    || state.lastEnded?.id === social.episode_id;
  if (invalid) return { state, opened: false };
  const scene = {
    id: social.episode_id, revision: state.revision + 1, status: 'ACTIVE',
    participants: ['cy:7734', social.actor_id], location: LOCATIONS.EXERCISE_YARD,
    startedAt: source.started_at, completionDueAt: source.completion_due_at,
    locationEnteredAt: source.location_entered_at,
    observation: { observerId: 'cy:7734', channel: 'IN_PERSON', access: 'CY_DIRECT',
      identityBasis: 'DIRECT_ROUTINE_ENCOUNTER', voiceRecognition: false },
    source: { producer: PRODUCER, startEventId: event.id, parentEpisodeId: episode.id,
      parentStartedAt: episode.started_at, variant: source.variant, completion: source.completion },
    endedAt: null, endReason: null, social: clone(social),
  };
  if (!validScene(scene)) return { state, opened: false };
  state.revision = scene.revision;
  state.active = scene;
  return { state, opened: true };
}

function invalidation(scene, location, { restart, departedParticipantIds, observationJustified, asleep }) {
  if (restart) return 'RESTART_OBSERVATION_GAP';
  if (departedParticipantIds.some((id) => scene.participants.includes(id === 'cy' ? 'cy:7734' : id))) return 'PARTICIPANT_DEPARTED';
  if (!observationJustified || asleep) return 'OBSERVATION_LOST';
  if (location?.current?.id !== scene.location || location.current.entered_at !== scene.locationEnteredAt) return 'CY_LOCATION_CHANGED';
  if (location.lockdownEpisode?.status === 'ACTIVE') return 'REGIME_CHANGED';
  const episode = activeExercise(location);
  if (!episode || episode.id !== scene.source.parentEpisodeId || episode.started_at !== scene.source.parentStartedAt) return 'EXERCISE_ENDED';
  return null;
}

// No consumer may use an expired snapshot as presence while a tick is delayed.
export function currentScenePresence(saved, location, { nowMs, observationJustified = true, asleep = false } = {}) {
  const scene = reconcileCurrentScene(saved).active;
  if (!scene || !Number.isFinite(nowMs) || nowMs < ms(scene.startedAt) || nowMs >= ms(scene.completionDueAt)
    || invalidation(scene, location, { restart: false, departedParticipantIds: [], observationJustified, asleep })) return null;
  return clone(scene);
}

export function advanceCurrentYardScene(saved, location, {
  nowMs, restart = false, departedParticipantIds = [], observationJustified = true, asleep = false,
} = {}) {
  const state = reconcileCurrentScene(saved);
  const scene = state.active;
  if (!scene) return { state, event: null, changed: false };
  const invalidReason = invalidation(scene, location, { restart, departedParticipantIds, observationJustified, asleep });
  if (!invalidReason && nowMs < ms(scene.completionDueAt)) return { state, event: null, changed: false };
  const reason = invalidReason || 'ENCOUNTER_COMPLETED';
  // Downtime is never contact. Otherwise the producer's scheduled completion
  // bounds a delayed tick; no absence of a new observation extends occupancy.
  const endedMs = restart ? ms(scene.startedAt)
    : Math.max(ms(scene.startedAt), Math.min(nowMs, ms(scene.completionDueAt)));
  const interrupted = reason !== 'ENCOUNTER_COMPLETED';
  state.revision += 1;
  state.lastEnded = { ...scene, revision: state.revision, status: interrupted ? 'INTERRUPTED' : 'ENDED',
    endedAt: iso(endedMs), endReason: reason, detectedAt: iso(nowMs) };
  state.active = null;
  const summary = restart ? 'The yard encounter could no longer be observed across the runner restart'
    : interrupted ? `The brief yard encounter with ${scene.social.actor_label} was interrupted`
      : scene.source.variant === 'conversation'
        ? `${scene.social.actor_label} spoke briefly with Cy while they walked the yard; the encounter ended`
        : `${scene.social.actor_label} fell into step beside Cy for part of the exercise period; the brief company ended`;
  return { state, changed: true, event: {
    eventType: 'yard_encounter_end', summary, occurredAt: iso(endedMs), cyObserved: !restart && observationJustified && !asleep,
    world: {
      participants: { actor: scene.participants[1], target: 'cy', relationship_ref: scene.participants[1] },
      context: { location: 'exercise_yard', description: summary,
        associated_entities: scene.participants, previous_event_ids: [scene.source.startEventId] },
      temporal: { onset: 'event', persistence: 'completed', recurrence: 'routine' },
      situation: { resolution_status: 'resolved' },
      social: { ...clone(scene.social), end_at: iso(endedMs),
        resolution: interrupted ? 'INTERRUPTED' : 'COMPLETED', linked_event_ids: [scene.source.startEventId],
        continuously_observed: !interrupted },
      current_scene_end: { scene_id: scene.id, revision: state.revision, reason, detected_at: iso(nowMs) },
    },
    observation: { modality: restart || !observationJustified || asleep ? 'none' : 'direct',
      certainty: restart || !observationJustified || asleep ? 'unknown' : 'certain' },
  } };
}
