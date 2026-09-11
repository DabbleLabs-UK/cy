// environment-schema.js - objective world facts and Cy's observation of them.
//
// This module deliberately contains no emotion scores, brain activation values,
// affect coefficients or numeric appraisal mappings. It prepares categorical
// evidence for later approved models. "unknown" is never collapsed into "none".

export const ENVIRONMENT_SCHEMA = 'cy.environment-event';
export const ENVIRONMENT_SCHEMA_VERSION = 1;
export const SOMA_INPUT_SCHEMA = 'cy.soma-input';

const UNKNOWN = 'unknown';
const FORBIDDEN_MODEL_OUTPUT_KEYS = new Set([
  'appraisal', 'appraisal_magnitude', 'emotion', 'emotion_score',
  'emotional_magnitude', 'brain_activation',
  'anxiety', 'arousal', 'stress', 'pain', 'hunger', 'fatigue',
  'loneliness', 'anger', 'rumination',
  'amygdala', 'insula', 'hypothalamic', 'acc', 'hippocampal',
  'prefrontal', 'temporalSocial',
]);

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function merge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return deepClone(base);
  const out = deepClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = merge(out[key], value);
    } else {
      out[key] = deepClone(value);
    }
  }
  return out;
}

function assertNoModelOutputs(value, path = 'event') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_MODEL_OUTPUT_KEYS.has(key)) {
      throw new Error(`${path}.${key} is a model output, not an environment fact`);
    }
    assertNoModelOutputs(child, `${path}.${key}`);
  }
}

const BASE_WORLD = Object.freeze({
  participants: { actor: null, target: null, relationship_ref: null },
  physical: {
    injury: UNKNOWN,
    nociceptive_impact: UNKNOWN,
    physical_discomfort: UNKNOWN,
    food: { offered: UNKNOWN, consumed: UNKNOWN, portion_fraction: null, energy_proxy: null },
    sleep: { state: UNKNOWN, interruption: UNKNOWN },
    environmental_discomfort: UNKNOWN,
  },
  situation: {
    possible_harm: UNKNOWN,
    uncertainty: UNKNOWN,
    control: UNKNOWN,
    predictability: UNKNOWN,
    novelty: UNKNOWN,
    goal_obstruction: UNKNOWN,
    social_contact: UNKNOWN,
    social_contact_quality: UNKNOWN,
    rejection_support: UNKNOWN,
    agency: UNKNOWN,
    responsibility_evidence: UNKNOWN,
    intent: UNKNOWN,
    resolution_status: UNKNOWN,
    deprivation_outcome: UNKNOWN,
  },
  temporal: {
    onset: UNKNOWN,
    persistence: UNKNOWN,
    recurrence: UNKNOWN,
  },
  context: { location: null, description: null, associated_entities: [], previous_event_ids: [] },
  associative_learning: { linkage: UNKNOWN, explicit_signals: [], outcomes: [] },
  defensive_context: { context_id: null, temporal_status: 'UNKNOWN', adverse_outcome_classes: [] },
});

const BASE_OBSERVATION = Object.freeze({
  modality: UNKNOWN,
  certainty: UNKNOWN,
  summary: null,
  observed_facts: {},
});

// These are world-input archetypes, not emotion scripts. Variants such as a
// full, partial, missed or refused meal share the meal archetype and override
// only the facts that actually differ.
export const REFERENCE_EVENT_ARCHETYPES = Object.freeze([
  { id: 'meal', family: 'homeostasis', world: { situation: { predictability: 'routine' } }, observation: { modality: 'direct' } },
  { id: 'sleep_normal', family: 'homeostasis', world: { physical: { sleep: { state: 'sleep_period', interruption: 'none' } }, situation: { predictability: 'routine', resolution_status: 'resolved' } }, observation: { modality: 'direct' } },
  { id: 'sleep_interrupted', family: 'homeostasis', world: { physical: { sleep: { state: 'interrupted', interruption: 'present' } }, situation: { resolution_status: 'unresolved' } }, observation: { modality: 'direct' } },
  { id: 'forced_wakefulness', family: 'homeostasis', world: { physical: { sleep: { state: 'forced_wakefulness', interruption: 'present' } }, situation: { control: 'none', agency: 'institution', resolution_status: 'unresolved' } }, observation: { modality: 'direct', certainty: 'certain' } },
  { id: 'persistent_night_noise', family: 'environment', world: { physical: { environmental_discomfort: 'present', sleep: { state: UNKNOWN, interruption: 'possible' } }, situation: { predictability: 'persistent', resolution_status: 'unresolved' }, temporal: { onset: 'event', persistence: 'ongoing', recurrence: 'repeated' }, context: { location: 'cell' } }, observation: { modality: 'heard', certainty: 'certain' } },
  { id: 'cell_search', family: 'custody', world: { physical: { injury: 'none', nociceptive_impact: 'none' }, situation: { possible_harm: 'possible', uncertainty: 'present', control: 'none', predictability: 'low', goal_obstruction: 'present', agency: 'officer', intent: 'unknown', resolution_status: 'resolved' }, context: { location: 'cell' }, associative_learning: { linkage: 'self_contained_event', outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' }, { outcome_class: 'PHYSICAL_HARM', status: 'did_not_occur' }] }, defensive_context: { temporal_status: 'RESOLVED', adverse_outcome_classes: ['COERCIVE_LOSS_OF_CONTROL', 'PHYSICAL_HARM'] } }, observation: { modality: 'direct', certainty: 'certain' } },
  { id: 'lockdown', family: 'custody', world: { situation: { possible_harm: UNKNOWN, uncertainty: 'present', control: 'none', predictability: 'low', goal_obstruction: 'present', agency: 'institution', intent: 'unknown', resolution_status: 'unresolved' }, context: { location: 'wing' }, associative_learning: { linkage: 'self_contained_event', outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' }] }, defensive_context: { context_id: 'custody:lockdown', temporal_status: 'ONGOING', adverse_outcome_classes: ['COERCIVE_LOSS_OF_CONTROL'] } }, observation: { modality: 'direct', certainty: 'certain' } },
  { id: 'cancelled_activity', family: 'routine', world: { situation: { control: 'none', predictability: 'low', goal_obstruction: 'present', agency: 'institution', responsibility_evidence: UNKNOWN, intent: UNKNOWN, resolution_status: 'resolved', deprivation_outcome: 'missed' }, associative_learning: { linkage: 'self_contained_event', outcomes: [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'occurred' }, { outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' }] }, defensive_context: { temporal_status: 'RESOLVED', adverse_outcome_classes: ['DEPRIVATION_OR_LOSS', 'COERCIVE_LOSS_OF_CONTROL'] } }, observation: { modality: 'direct', certainty: 'certain' } },
  { id: 'minor_injury', family: 'physical', world: { physical: { injury: 'minor', nociceptive_impact: 'minor', physical_discomfort: 'present' }, situation: { possible_harm: 'minor', resolution_status: UNKNOWN }, associative_learning: { linkage: 'self_contained_event', outcomes: [{ outcome_class: 'PHYSICAL_HARM', status: 'occurred' }] }, defensive_context: { temporal_status: 'RESOLVED', adverse_outcome_classes: ['PHYSICAL_HARM'] } }, observation: { modality: 'direct', certainty: 'certain' } },
  { id: 'calm_routine', family: 'routine', world: { physical: { injury: 'none', nociceptive_impact: 'none', environmental_discomfort: 'none' }, situation: { possible_harm: 'none', uncertainty: 'none', control: 'limited', predictability: 'routine', novelty: 'none', goal_obstruction: 'none', resolution_status: 'resolved' } }, observation: { modality: 'direct', certainty: 'certain' } },
  { id: 'friendly_interaction', family: 'social', world: { situation: { possible_harm: 'none', social_contact: 'present', social_contact_quality: 'supportive', rejection_support: 'support', intent: 'supportive', resolution_status: 'resolved' }, associative_learning: { linkage: 'self_contained_event', outcomes: [{ outcome_class: 'SOCIAL_HOSTILITY', status: 'did_not_occur' }] }, defensive_context: { temporal_status: 'RESOLVED', adverse_outcome_classes: ['SOCIAL_HOSTILITY'] } }, observation: { modality: 'direct', certainty: 'probable' } },
  { id: 'hostile_interaction', family: 'social', world: { situation: { possible_harm: 'possible', social_contact: 'present', social_contact_quality: 'hostile', rejection_support: 'rejection', intent: 'hostile', resolution_status: UNKNOWN }, associative_learning: { linkage: 'self_contained_event', outcomes: [{ outcome_class: 'SOCIAL_HOSTILITY', status: 'occurred' }] }, defensive_context: { temporal_status: 'RESOLVED', adverse_outcome_classes: ['SOCIAL_HOSTILITY'] } }, observation: { modality: 'direct', certainty: 'probable' } },
  { id: 'social_rejection', family: 'social', world: { situation: { social_contact: 'attempted', social_contact_quality: 'rejecting', rejection_support: 'rejection', intent: 'ambiguous', resolution_status: 'resolved' }, associative_learning: { linkage: 'self_contained_event', outcomes: [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'occurred' }] }, defensive_context: { temporal_status: 'RESOLVED', adverse_outcome_classes: ['DEPRIVATION_OR_LOSS'] } }, observation: { modality: 'direct', certainty: 'certain' } },
  { id: 'ambiguous_overheard_remark', family: 'social', world: { situation: { possible_harm: UNKNOWN, uncertainty: 'high', predictability: UNKNOWN, novelty: 'present', social_contact: 'indirect', social_contact_quality: 'ambiguous', intent: 'unknown', resolution_status: 'unresolved' } }, observation: { modality: 'heard', certainty: 'uncertain' } },
  { id: 'officer_instruction', family: 'custody', world: { situation: { control: 'limited', agency: 'officer', responsibility_evidence: 'present', intent: 'neutral', resolution_status: 'resolved' }, associative_learning: { linkage: 'self_contained_event', outcomes: [{ outcome_class: 'SOCIAL_HOSTILITY', status: 'did_not_occur' }] }, defensive_context: { temporal_status: 'RESOLVED', adverse_outcome_classes: ['SOCIAL_HOSTILITY'] } }, observation: { modality: 'direct', certainty: 'certain' } },
  { id: 'supportive_postcard', family: 'mail', world: { situation: { social_contact: 'present', social_contact_quality: 'supportive', rejection_support: 'support', intent: 'supportive', resolution_status: 'resolved' } }, observation: { modality: 'read', certainty: 'certain' } },
  { id: 'ordinary_postcard', family: 'mail', world: { situation: { social_contact: 'present', social_contact_quality: 'ordinary', rejection_support: 'none', intent: 'neutral', resolution_status: 'resolved' } }, observation: { modality: 'read', certainty: 'certain' } },
  { id: 'hostile_postcard', family: 'mail', world: { situation: { possible_harm: 'possible', social_contact: 'present', social_contact_quality: 'hostile', rejection_support: 'rejection', intent: 'hostile', resolution_status: UNKNOWN } }, observation: { modality: 'read', certainty: 'certain' } },
  { id: 'prolonged_social_absence', family: 'social', world: { situation: { social_contact: 'none', social_contact_quality: 'none', rejection_support: 'none', deprivation_outcome: 'ongoing', resolution_status: 'unresolved' }, temporal: { onset: UNKNOWN, persistence: 'ongoing', recurrence: UNKNOWN } }, observation: { modality: 'direct', certainty: 'certain' } },
]);

export function referenceEventArchetype(id) {
  const found = REFERENCE_EVENT_ARCHETYPES.find((item) => item.id === id);
  if (!found) throw new Error(`unknown environment event archetype: ${id}`);
  return found;
}

export function createEnvironmentEvent(archetypeId, {
  id,
  timestamp,
  eventType = archetypeId,
  durationMs = null,
  world = {},
  observation = {},
} = {}) {
  const archetype = referenceEventArchetype(archetypeId);
  if (typeof id !== 'string' || !id) throw new Error('environment event id is required');
  if (typeof timestamp !== 'string' || !timestamp) throw new Error('environment event timestamp is required');
  const event = {
    schema: ENVIRONMENT_SCHEMA,
    version: ENVIRONMENT_SCHEMA_VERSION,
    id,
    timestamp,
    event_type: eventType,
    event_family: archetype.family,
    archetype_id: archetypeId,
    duration_ms: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
    world: merge(BASE_WORLD, merge(archetype.world || {}, world)),
    observation: merge(BASE_OBSERVATION, merge(archetype.observation || {}, observation)),
  };
  assertNoModelOutputs(event.world, 'world');
  assertNoModelOutputs(event.observation, 'observation');
  return event;
}

export function environmentEventToSomaInput(event) {
  if (!event || event.schema !== ENVIRONMENT_SCHEMA) throw new Error('invalid environment event');
  const physical = event.world.physical;
  const situation = event.world.situation;
  const temporal = event.world.temporal;
  return {
    schema: SOMA_INPUT_SCHEMA,
    version: 1,
    event_id: event.id,
    event_type: event.event_type,
    event_family: event.event_family,
    duration_ms: event.duration_ms,
    actual_harm: physical.injury,
    nociceptive_impact: physical.nociceptive_impact,
    physical_discomfort: physical.physical_discomfort,
    environmental_discomfort: physical.environmental_discomfort,
    food_offered: physical.food.offered,
    food_consumed: physical.food.consumed,
    portion_fraction: physical.food.portion_fraction,
    energy_proxy: physical.food.energy_proxy,
    sleep_period: physical.sleep.state,
    sleep_interruption: physical.sleep.interruption,
    possible_harm: situation.possible_harm,
    uncertainty: situation.uncertainty,
    control: situation.control,
    predictability: situation.predictability,
    agency: situation.agency,
    responsibility_evidence: situation.responsibility_evidence,
    goal_obstruction: situation.goal_obstruction,
    social_contact: situation.social_contact,
    social_contact_quality: situation.social_contact_quality,
    rejection_support: situation.rejection_support,
    deprivation_outcome: situation.deprivation_outcome,
    resolution_status: situation.resolution_status,
    novelty: situation.novelty,
    intent: situation.intent,
    onset: temporal.onset,
    persistence: temporal.persistence,
    recurrence: temporal.recurrence,
    learned_context: {
      location: event.world.context.location,
      associated_entities: [...event.world.context.associated_entities],
      previous_event_ids: [...event.world.context.previous_event_ids],
    },
    associative_learning: deepClone(event.world.associative_learning),
    defensive_context: deepClone(event.world.defensive_context),
  };
}

export function createEnvironmentRecord(event, { consumedBy = [] } = {}) {
  const { observation, ...worldEvent } = event;
  return {
    schema: 'cy.environment-record',
    version: 1,
    world_event: deepClone(worldEvent),
    observation: deepClone(observation),
    soma_input: environmentEventToSomaInput(event),
    consumed_by: [...new Set((Array.isArray(consumedBy) ? consumedBy : []).map(String).filter(Boolean))],
  };
}

export function serializeEnvironmentRecord(record) {
  return JSON.stringify(record);
}

export function deserializeEnvironmentRecord(json) {
  const record = JSON.parse(json);
  if (!record || record.schema !== 'cy.environment-record'
    || !record.world_event || record.world_event.schema !== ENVIRONMENT_SCHEMA
    || !record.soma_input || record.soma_input.schema !== SOMA_INPUT_SCHEMA) {
    throw new Error('invalid environment event record');
  }
  return record;
}
