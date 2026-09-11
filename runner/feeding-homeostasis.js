// feeding-homeostasis.js - grounded food availability and ingestion ledger.
//
// This subsystem records structured world facts only. It does not calculate
// hunger, satiety, energy balance, reward, metabolic state or brain activity.

export const FEEDING_STATE_SCHEMA = 'cy.feeding-homeostasis-inputs';
export const FEEDING_STATE_VERSION = 1;
export const FEEDING_RECORD_SCHEMA = 'cy.ingestion-record';
export const FEEDING_MODEL_ID = 'feeding-homeostasis-uninstantiated-framework';
export const FEEDING_MODEL_VERSION = 'feeding-intake-ledger-v1';
export const FEEDING_PROVENANCE = 'config/model-specs/feeding-homeostasis.json';

export const OFFERED_STATUSES = Object.freeze(['OFFERED', 'NOT_OFFERED', 'UNKNOWN']);
export const AVAILABILITY_STATUSES = Object.freeze(['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN']);
export const RECEIVED_STATUSES = Object.freeze(['RECEIVED', 'NOT_RECEIVED', 'UNKNOWN']);
export const CONSUMPTION_STATUSES = Object.freeze(['NONE', 'PARTIAL', 'FULL', 'UNKNOWN']);
export const PORTION_CATEGORIES = Object.freeze(['NONE', 'PARTIAL', 'FULL', 'UNKNOWN']);
export const PORTION_BASES = Object.freeze(['OBSERVED_EXACT', 'CATEGORICAL_ONLY', 'UNKNOWN']);
export const INTAKE_OUTCOMES = Object.freeze([
  'MEAL_EXPECTED',
  'FULLY_CONSUMED',
  'PARTLY_CONSUMED',
  'REFUSED',
  'UNAVAILABLE',
  'UNKNOWN',
]);

const VALID_OFFERED = new Set(OFFERED_STATUSES);
const VALID_AVAILABILITY = new Set(AVAILABILITY_STATUSES);
const VALID_RECEIVED = new Set(RECEIVED_STATUSES);
const VALID_CONSUMPTION = new Set(CONSUMPTION_STATUSES);
const VALID_PORTION_CATEGORY = new Set(PORTION_CATEGORIES);
const VALID_PORTION_BASIS = new Set(PORTION_BASES);
const VALID_OUTCOME = new Set(INTAKE_OUTCOMES);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function timestampMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function categorical(value, mapping, fallback = 'UNKNOWN') {
  const key = String(value || '').trim().toLowerCase();
  return mapping[key] || fallback;
}

function canonicalId(value) {
  const clean = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_').replace(/^_+|_+$/g, '');
  return clean || null;
}

function foodFacts(record) {
  const event = record && record.world_event;
  return event && event.world && event.world.physical && event.world.physical.food;
}

function isExpectedOnly(event, food) {
  return event.archetype_id === 'meal_expected'
    || String(food.intake_outcome || '').toLowerCase() === 'expected';
}

function offeredStatus(food) {
  return categorical(food.offered, {
    yes: 'OFFERED', offered: 'OFFERED',
    no: 'NOT_OFFERED', not_offered: 'NOT_OFFERED',
    unknown: 'UNKNOWN',
  });
}

function availabilityStatus(food) {
  return categorical(food.available, {
    yes: 'AVAILABLE', available: 'AVAILABLE',
    no: 'UNAVAILABLE', unavailable: 'UNAVAILABLE',
    unknown: 'UNKNOWN',
  });
}

function receivedStatus(food) {
  return categorical(food.received, {
    yes: 'RECEIVED', received: 'RECEIVED',
    no: 'NOT_RECEIVED', not_received: 'NOT_RECEIVED',
    unknown: 'UNKNOWN',
  });
}

function consumptionStatus(food) {
  return categorical(food.consumed, {
    none: 'NONE', refused: 'NONE', missed: 'NONE',
    partial: 'PARTIAL', full: 'FULL', eaten: 'FULL',
    unknown: 'UNKNOWN',
  });
}

function portionCategory(food, consumption) {
  const explicit = categorical(food.portion_category, {
    none: 'NONE', partial: 'PARTIAL', full: 'FULL', unknown: 'UNKNOWN',
  });
  if (explicit !== 'UNKNOWN') return explicit;
  return consumption;
}

function portionFacts(food, consumption) {
  const category = portionCategory(food, consumption);
  const supplied = food.portion_fraction;
  const fraction = typeof supplied === 'number' && Number.isFinite(supplied)
    && supplied >= 0 && supplied <= 1 ? supplied : null;
  return {
    category,
    fraction,
    basis: fraction != null ? 'OBSERVED_EXACT'
      : category !== 'UNKNOWN' ? 'CATEGORICAL_ONLY' : 'UNKNOWN',
  };
}

function intakeOutcome(event, food, offered, availability, consumption) {
  if (isExpectedOnly(event, food)) return 'MEAL_EXPECTED';
  const explicit = categorical(food.intake_outcome, {
    full_consumed: 'FULLY_CONSUMED', fully_consumed: 'FULLY_CONSUMED',
    partial_consumed: 'PARTLY_CONSUMED', partly_consumed: 'PARTLY_CONSUMED',
    refused: 'REFUSED', unavailable: 'UNAVAILABLE', unknown: 'UNKNOWN',
  });
  if (explicit !== 'UNKNOWN') return explicit;
  if (consumption === 'FULL') return 'FULLY_CONSUMED';
  if (consumption === 'PARTIAL') return 'PARTLY_CONSUMED';
  if (consumption === 'NONE' && availability === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (consumption === 'NONE' && (availability === 'AVAILABLE' || offered === 'OFFERED')) return 'REFUSED';
  return 'UNKNOWN';
}

function isFeedingRecord(record) {
  const event = record && record.world_event;
  const food = foodFacts(record);
  if (!event || !food || typeof food !== 'object') return false;
  if (event.archetype_id === 'meal' || event.archetype_id === 'meal_expected') return true;
  return Object.values(food).some((value) => value != null && String(value).toLowerCase() !== 'unknown');
}

export function ingestionRecordFromEnvironment(record) {
  if (!isFeedingRecord(record)) return null;
  const event = record.world_event;
  const food = foodFacts(record);
  const offered = offeredStatus(food);
  const availability = availabilityStatus(food);
  const received = receivedStatus(food);
  const consumption = consumptionStatus(food);
  const portion = portionFacts(food, consumption);
  const outcome = intakeOutcome(event, food, offered, availability, consumption);
  const scheduled = categorical(food.scheduled, {
    yes: 'SCHEDULED', scheduled: 'SCHEDULED',
    no: 'UNSCHEDULED', unscheduled: 'UNSCHEDULED',
    unknown: 'UNKNOWN',
  });
  return {
    schema: FEEDING_RECORD_SCHEMA,
    version: FEEDING_STATE_VERSION,
    eventId: event.id,
    timestamp: event.timestamp,
    mealId: canonicalId(food.meal_id),
    mealType: canonicalId(food.meal_type),
    scheduledStatus: scheduled,
    offeredStatus: offered,
    availabilityStatus: availability,
    receivedStatus: received,
    consumptionStatus: consumption,
    intakeOutcome: outcome,
    portionCategory: portion.category,
    portionFraction: portion.fraction,
    portionBasis: portion.basis,
    durationMs: Number.isFinite(event.duration_ms) && event.duration_ms >= 0 ? event.duration_ms : null,
    nutritionalComposition: 'UNKNOWN',
    physiologicalImpact: 'NOT_MODELLED',
    sourceEnvironmentEventIds: [event.id],
    fieldProvenance: {
      mealIdentity: 'STRUCTURED_WORLD_FACT',
      schedule: 'STRUCTURED_WORLD_FACT',
      availability: 'STRUCTURED_WORLD_FACT',
      offered: 'STRUCTURED_WORLD_FACT',
      received: 'STRUCTURED_WORLD_FACT',
      consumption: 'STRUCTURED_WORLD_FACT',
      portion: 'STRUCTURED_WORLD_FACT_OR_EXPLICIT_UNKNOWN',
      nutritionalComposition: 'UNKNOWN',
      physiologicalImpact: 'NOT_MODELLED',
    },
  };
}

export function createFeedingState(now = Date.now()) {
  return {
    schema: FEEDING_STATE_SCHEMA,
    version: FEEDING_STATE_VERSION,
    modelId: FEEDING_MODEL_ID,
    modelVersion: FEEDING_MODEL_VERSION,
    provenance: FEEDING_PROVENANCE,
    installedAtMs: now,
    records: [],
    unknownIntervals: [],
    lastKnownIntakeAt: null,
    lastKnownIntakeEventId: null,
    lastMealOfferedAt: null,
    latestScheduledMeal: null,
    latestResolvedMeal: null,
    continuity: { lastObservedAtMs: now },
  };
}

function validRecord(record) {
  return record && record.schema === FEEDING_RECORD_SCHEMA
    && record.version === FEEDING_STATE_VERSION
    && typeof record.eventId === 'string' && record.eventId
    && typeof record.timestamp === 'string' && timestampMs(record.timestamp) != null
    && VALID_OFFERED.has(record.offeredStatus)
    && VALID_AVAILABILITY.has(record.availabilityStatus)
    && VALID_RECEIVED.has(record.receivedStatus)
    && VALID_CONSUMPTION.has(record.consumptionStatus)
    && VALID_PORTION_CATEGORY.has(record.portionCategory)
    && VALID_PORTION_BASIS.has(record.portionBasis)
    && VALID_OUTCOME.has(record.intakeOutcome);
}

function gap(startedAtMs, endedAtMs) {
  return {
    startedAtMs,
    endedAtMs,
    reason: 'RUNNER_NOT_OBSERVING',
    ingestionAssumption: 'NONE_MADE',
  };
}

export function reconcileFeedingState(raw, { now = Date.now() } = {}) {
  const out = createFeedingState(now);
  if (!raw || raw.schema !== FEEDING_STATE_SCHEMA || raw.version !== FEEDING_STATE_VERSION) return out;
  out.installedAtMs = Number.isFinite(raw.installedAtMs) ? raw.installedAtMs : now;
  out.records = Array.isArray(raw.records) ? raw.records.filter(validRecord).map(clone) : [];
  out.unknownIntervals = Array.isArray(raw.unknownIntervals) ? raw.unknownIntervals.filter((item) =>
    item && Number.isFinite(item.startedAtMs) && Number.isFinite(item.endedAtMs)
    && item.endedAtMs >= item.startedAtMs).map(clone) : [];
  out.lastKnownIntakeAt = typeof raw.lastKnownIntakeAt === 'string'
    && timestampMs(raw.lastKnownIntakeAt) != null ? raw.lastKnownIntakeAt : null;
  out.lastKnownIntakeEventId = typeof raw.lastKnownIntakeEventId === 'string'
    ? raw.lastKnownIntakeEventId : null;
  out.lastMealOfferedAt = typeof raw.lastMealOfferedAt === 'string'
    && timestampMs(raw.lastMealOfferedAt) != null ? raw.lastMealOfferedAt : null;
  out.latestScheduledMeal = validRecord(raw.latestScheduledMeal) ? clone(raw.latestScheduledMeal) : null;
  out.latestResolvedMeal = validRecord(raw.latestResolvedMeal) ? clone(raw.latestResolvedMeal) : null;
  const lastObserved = Number(raw.continuity && raw.continuity.lastObservedAtMs);
  if (Number.isFinite(lastObserved) && now > lastObserved) {
    out.unknownIntervals.push(gap(lastObserved, now));
  }
  out.continuity.lastObservedAtMs = now;
  return out;
}

export function touchFeedingContinuity(state, now = Date.now()) {
  if (state && state.continuity && Number.isFinite(now)) state.continuity.lastObservedAtMs = now;
  return state;
}

export function observeFeedingRecord(state, record) {
  if (!state || !record) return { updated: false, reason: 'invalid_record' };
  const ingestion = ingestionRecordFromEnvironment(record);
  if (!ingestion) return { updated: false, reason: 'not_a_feeding_event' };
  if (state.records.some((item) => item.eventId === ingestion.eventId)) {
    return { updated: false, reason: 'duplicate_event', record: clone(ingestion) };
  }
  state.records.push(clone(ingestion));
  if (ingestion.offeredStatus === 'OFFERED') state.lastMealOfferedAt = ingestion.timestamp;
  if (ingestion.scheduledStatus === 'SCHEDULED') state.latestScheduledMeal = clone(ingestion);
  if (ingestion.intakeOutcome !== 'MEAL_EXPECTED') state.latestResolvedMeal = clone(ingestion);
  if (['FULLY_CONSUMED', 'PARTLY_CONSUMED'].includes(ingestion.intakeOutcome)) {
    state.lastKnownIntakeAt = ingestion.timestamp;
    state.lastKnownIntakeEventId = ingestion.eventId;
  }
  const atMs = timestampMs(ingestion.timestamp);
  if (atMs != null && atMs > state.continuity.lastObservedAtMs) state.continuity.lastObservedAtMs = atMs;
  return {
    modelId: FEEDING_MODEL_ID,
    modelVersion: FEEDING_MODEL_VERSION,
    provenance: FEEDING_PROVENANCE,
    sourceEnvironmentEventId: ingestion.eventId,
    updated: true,
    record: clone(ingestion),
    continuity: clone(state.continuity),
    unknownIntervals: clone(state.unknownIntervals),
  };
}

function intakeKnowledgeStatus(state) {
  if (!state || !state.records.length) return 'NO_FEEDING_RECORD';
  if (state.unknownIntervals.length || state.records.some((record) => record.intakeOutcome === 'UNKNOWN')) {
    return 'INCOMPLETE';
  }
  return 'COMPLETE';
}

function publicRecord(record) {
  if (!record) return null;
  const {
    eventId,
    sourceEnvironmentEventIds,
    fieldProvenance,
    ...publicFields
  } = clone(record);
  return publicFields;
}

function summary(state, now = Date.now(), includeAll = false) {
  const lastAtMs = timestampMs(state && state.lastKnownIntakeAt);
  const missed = (state && state.records || []).filter((record) =>
    record.scheduledStatus === 'SCHEDULED' && record.intakeOutcome === 'UNAVAILABLE');
  const records = clone((state && state.records) || []);
  const visibleRecords = includeAll ? records : records.map(publicRecord);
  const result = {
    status: 'implemented',
    publicLabel: 'LIVE',
    meaning: 'Objective food availability, offering and ingestion history. It is not hunger or internal energy state.',
    modelId: FEEDING_MODEL_ID,
    modelVersion: FEEDING_MODEL_VERSION,
    provenance: FEEDING_PROVENANCE,
    lastKnownIntakeAt: state && state.lastKnownIntakeAt || null,
    elapsedSinceKnownIntakeMs: lastAtMs == null ? null : Math.max(0, now - lastAtMs),
    lastMealOfferedAt: state && state.lastMealOfferedAt || null,
    latestScheduledMeal: includeAll
      ? clone(state && state.latestScheduledMeal)
      : publicRecord(state && state.latestScheduledMeal),
    latestResolvedMeal: includeAll
      ? clone(state && state.latestResolvedMeal)
      : publicRecord(state && state.latestResolvedMeal),
    missedScheduledMeals: missed.length,
    intakeKnowledgeStatus: intakeKnowledgeStatus(state),
    unknownIntervals: clone((state && state.unknownIntervals) || []),
    recentMealOutcomes: includeAll ? visibleRecords : visibleRecords.slice(-6),
    totalFeedingRecords: records.length,
    homeostaticEnergyState: 'NOT_MODELLED',
    subjectiveHunger: 'PROVISIONAL',
    gutSatiety: 'NOT_MODELLED',
    hedonicAppetite: 'NOT_MODELLED',
    learnedMealAnticipation: 'NOT_MODELLED',
    feedingActionSelection: 'NOT_MODELLED',
    cyEmbodimentModel: 'NOT_CALIBRATED',
  };
  if (includeAll) result.records = records;
  return result;
}

export function feedingInspection(state, now = Date.now()) {
  return summary(state, now, true);
}

export function feedingSnapshot(state, now = Date.now()) {
  return summary(state, now, false);
}
