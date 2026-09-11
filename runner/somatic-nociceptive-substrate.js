// somatic-nociceptive-substrate.js - factual bodily harm and noxious-input ledger.
//
// This records structured world facts only. It is a computational functional
// analogue of incoming nociceptive information; Cy has no biological
// nociceptors. It does not calculate subjective pain, general discomfort,
// healing, sensitisation, affect, action selection or brain activation.

export const SOMATIC_STATE_SCHEMA = 'cy.somatic-nociceptive-substrate';
export const SOMATIC_EVENT_SCHEMA = 'cy.somatic-event';
export const SOMATIC_STATE_VERSION = 1;
export const SOMATIC_MODEL_ID = 'structured-somatic-harm-ledger';
export const SOMATIC_MODEL_VERSION = 'somatic-nociceptive-substrate-v1';
export const SOMATIC_PROVENANCE = 'config/model-specs/somatic-nociceptive-substrate.json';

export const STIMULUS_MODALITIES = Object.freeze([
  'MECHANICAL', 'THERMAL', 'CHEMICAL', 'OTHER', 'UNKNOWN',
]);
export const NOXIOUS_STATUSES = Object.freeze(['YES', 'NO', 'UNKNOWN']);
export const STIMULUS_STATUSES = Object.freeze(['ACTIVE', 'ENDED', 'POINT', 'UNKNOWN']);
export const TISSUE_DAMAGE_STATUSES = Object.freeze(['CONFIRMED', 'THREATENED', 'NONE', 'UNKNOWN']);
export const INJURY_STATUSES = Object.freeze(['ACTIVE', 'RESOLVED', 'UNKNOWN']);
export const CERTAINTY_STATUSES = Object.freeze(['CERTAIN', 'PROBABLE', 'UNCERTAIN', 'UNKNOWN']);

const VALID_MODALITY = new Set(STIMULUS_MODALITIES);
const VALID_NOXIOUS = new Set(NOXIOUS_STATUSES);
const VALID_STIMULUS_STATUS = new Set(STIMULUS_STATUSES);
const VALID_DAMAGE = new Set(TISSUE_DAMAGE_STATUSES);
const VALID_INJURY_STATUS = new Set(INJURY_STATUSES);
const VALID_CERTAINTY = new Set(CERTAINTY_STATUSES);

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validIdentity(value) {
  return value == null || (typeof value === 'string' && value.length > 0 && value.length <= 160);
}

function validSomaticEvent(event) {
  return event && event.schema === SOMATIC_EVENT_SCHEMA
    && event.version === SOMATIC_STATE_VERSION
    && typeof event.eventId === 'string' && event.eventId
    && validTimestamp(event.timestamp)
    && event.stimulus && VALID_MODALITY.has(event.stimulus.modality)
    && VALID_NOXIOUS.has(event.stimulus.noxiousStimulus)
    && VALID_STIMULUS_STATUS.has(event.stimulus.status)
    && validIdentity(event.stimulus.id)
    && event.body && typeof event.body.site === 'string'
    && typeof event.body.laterality === 'string'
    && VALID_CERTAINTY.has(event.body.certainty)
    && event.tissue && VALID_DAMAGE.has(event.tissue.damageStatus)
    && validIdentity(event.tissue.injuryId)
    && typeof event.tissue.injuryType === 'string'
    && VALID_INJURY_STATUS.has(event.tissue.injuryStatus)
    && event.provenance && typeof event.provenance === 'object';
}

function somaticFacts(record) {
  const world = record && record.world_event && record.world_event.world;
  return world && world.somatic;
}

export function somaticEventFromEnvironment(record) {
  const event = record && record.world_event;
  const facts = somaticFacts(record);
  if (!event || !facts || facts.schema !== SOMATIC_EVENT_SCHEMA) return null;
  const stimulus = facts.stimulus || {};
  const body = facts.body || {};
  const tissue = facts.tissue || {};
  const meaningful = stimulus.id != null
    || stimulus.noxious_stimulus !== 'UNKNOWN'
    || stimulus.status !== 'UNKNOWN'
    || body.site !== 'UNKNOWN'
    || tissue.damage_status !== 'UNKNOWN'
    || tissue.injury_id != null
    || tissue.injury_status !== 'UNKNOWN';
  if (!meaningful) return null;
  const canonical = {
    schema: SOMATIC_EVENT_SCHEMA,
    version: SOMATIC_STATE_VERSION,
    eventId: event.id,
    timestamp: event.timestamp,
    eventType: event.event_type,
    stimulus: {
      id: facts.stimulus && facts.stimulus.id || null,
      modality: facts.stimulus && facts.stimulus.modality || 'UNKNOWN',
      onsetAt: facts.stimulus && facts.stimulus.onset_at || null,
      offsetAt: facts.stimulus && facts.stimulus.offset_at || null,
      status: facts.stimulus && facts.stimulus.status || 'UNKNOWN',
      noxiousStimulus: facts.stimulus && facts.stimulus.noxious_stimulus || 'UNKNOWN',
    },
    body: {
      site: facts.body && facts.body.site || 'UNKNOWN',
      laterality: facts.body && facts.body.laterality || 'UNKNOWN',
      certainty: facts.body && facts.body.certainty || 'UNKNOWN',
    },
    tissue: {
      damageStatus: facts.tissue && facts.tissue.damage_status || 'UNKNOWN',
      injuryId: facts.tissue && facts.tissue.injury_id || null,
      injuryType: facts.tissue && facts.tissue.injury_type || 'UNKNOWN',
      injuryStatus: facts.tissue && facts.tissue.injury_status || 'UNKNOWN',
      resolvedAt: facts.tissue && facts.tissue.resolved_at || null,
    },
    observation: {
      modality: record.observation && record.observation.modality || 'unknown',
      certainty: record.observation && record.observation.certainty || 'unknown',
      summary: record.observation && record.observation.summary || null,
    },
    knowledgeStatus: facts.knowledge_status || 'UNKNOWN',
    sourceEnvironmentEventIds: [event.id],
    provenance: clone(facts.field_provenance || {}),
  };
  return validSomaticEvent(canonical) ? canonical : null;
}

export function physicalHarmOutcomeFromSomaticFacts(facts) {
  const damage = facts && facts.tissue && facts.tissue.damage_status;
  if (damage === 'CONFIRMED') return 'occurred';
  if (damage === 'NONE') return 'did_not_occur';
  if (damage === 'THREATENED') return 'unknown';
  return null;
}

export function createSomaticState(now = Date.now()) {
  return {
    schema: SOMATIC_STATE_SCHEMA,
    version: SOMATIC_STATE_VERSION,
    modelId: SOMATIC_MODEL_ID,
    modelVersion: SOMATIC_MODEL_VERSION,
    provenance: SOMATIC_PROVENANCE,
    installedAtMs: now,
    stimuli: {},
    injuries: {},
    history: [],
  };
}

function validInjury(injury) {
  return injury && typeof injury.id === 'string' && injury.id
    && VALID_INJURY_STATUS.has(injury.status)
    && typeof injury.bodySite === 'string'
    && typeof injury.laterality === 'string'
    && typeof injury.injuryType === 'string'
    && validTimestamp(injury.firstObservedAt)
    && Array.isArray(injury.followups)
    && Array.isArray(injury.sourceEnvironmentEventIds);
}

function validStimulus(stimulus) {
  return stimulus && typeof stimulus.id === 'string' && stimulus.id
    && VALID_MODALITY.has(stimulus.modality)
    && VALID_NOXIOUS.has(stimulus.noxiousStimulus)
    && VALID_STIMULUS_STATUS.has(stimulus.status)
    && typeof stimulus.bodySite === 'string'
    && Array.isArray(stimulus.sourceEnvironmentEventIds);
}

export function reconcileSomaticState(raw, { now = Date.now() } = {}) {
  const out = createSomaticState(now);
  if (!raw || raw.schema !== SOMATIC_STATE_SCHEMA || raw.version !== SOMATIC_STATE_VERSION) return out;
  out.installedAtMs = Number.isFinite(raw.installedAtMs) ? raw.installedAtMs : now;
  out.stimuli = Object.fromEntries(Object.entries(raw.stimuli || {})
    .filter(([, stimulus]) => validStimulus(stimulus)).map(([id, stimulus]) => [id, clone(stimulus)]));
  out.injuries = Object.fromEntries(Object.entries(raw.injuries || {})
    .filter(([, injury]) => validInjury(injury)).map(([id, injury]) => [id, clone(injury)]));
  out.history = Array.isArray(raw.history) ? raw.history.filter(validSomaticEvent).map(clone) : [];
  return out;
}

function upsertStimulus(state, event) {
  const facts = event.stimulus;
  if (!facts.id || (facts.noxiousStimulus === 'UNKNOWN' && facts.status === 'UNKNOWN')) return false;
  const prior = state.stimuli[facts.id] || null;
  state.stimuli[facts.id] = {
    id: facts.id,
    modality: facts.modality,
    noxiousStimulus: facts.noxiousStimulus,
    status: facts.status,
    bodySite: event.body.site,
    laterality: event.body.laterality,
    onsetAt: facts.onsetAt,
    offsetAt: facts.offsetAt,
    lastObservedAt: event.timestamp,
    sourceEnvironmentEventIds: [...new Set([
      ...prior && prior.sourceEnvironmentEventIds || [],
      event.eventId,
    ])],
    provenance: clone(event.provenance),
  };
  return true;
}

function upsertInjury(state, event) {
  const facts = event.tissue;
  if (!facts.injuryId) return { updated: false, reason: 'no_injury_identity' };
  const prior = state.injuries[facts.injuryId] || null;
  if (facts.injuryStatus === 'RESOLVED') {
    if (!prior) return { updated: false, reason: 'unknown_injury_identity' };
    prior.status = 'RESOLVED';
    prior.resolvedAt = facts.resolvedAt || event.timestamp;
    prior.lastObservedAt = event.timestamp;
    prior.followups.push({
      eventId: event.eventId,
      timestamp: event.timestamp,
      status: 'RESOLVED',
      damageStatus: facts.damageStatus,
    });
    prior.sourceEnvironmentEventIds = [...new Set([...prior.sourceEnvironmentEventIds, event.eventId])];
    return { updated: true, reason: 'injury_resolved' };
  }
  if (facts.damageStatus !== 'CONFIRMED') return { updated: false, reason: 'damage_not_confirmed' };
  const injury = prior || {
    id: facts.injuryId,
    originEventId: event.eventId,
    firstObservedAt: event.timestamp,
    resolvedAt: null,
    followups: [],
    sourceEnvironmentEventIds: [],
  };
  injury.bodySite = event.body.site;
  injury.laterality = event.body.laterality;
  injury.siteCertainty = event.body.certainty;
  injury.injuryType = facts.injuryType;
  injury.mechanism = event.stimulus.modality;
  injury.status = facts.injuryStatus === 'UNKNOWN' ? 'UNKNOWN' : 'ACTIVE';
  injury.lastObservedAt = event.timestamp;
  injury.followups.push({
    eventId: event.eventId,
    timestamp: event.timestamp,
    status: injury.status,
    damageStatus: facts.damageStatus,
  });
  injury.sourceEnvironmentEventIds = [...new Set([...injury.sourceEnvironmentEventIds, event.eventId])];
  injury.provenance = clone(event.provenance);
  state.injuries[facts.injuryId] = injury;
  return { updated: true, reason: prior ? 'injury_followup' : 'injury_created' };
}

export function observeSomaticRecord(state, record) {
  if (!state || !record) return { updated: false, reason: 'invalid_record' };
  const event = somaticEventFromEnvironment(record);
  if (!event) return { updated: false, reason: 'not_a_valid_somatic_event' };
  if (state.history.some((item) => item.eventId === event.eventId)) {
    return { updated: false, reason: 'duplicate_event', event: clone(event) };
  }
  state.history.push(clone(event));
  const stimulusUpdated = upsertStimulus(state, event);
  const injury = upsertInjury(state, event);
  return {
    modelId: SOMATIC_MODEL_ID,
    modelVersion: SOMATIC_MODEL_VERSION,
    provenance: SOMATIC_PROVENANCE,
    sourceEnvironmentEventId: event.eventId,
    updated: true,
    stimulusUpdated,
    injuryUpdate: injury,
    event: clone(event),
    subjectivePain: 'NOT_MODELLED',
    healingDynamics: 'NOT_MODELLED',
    sensitisation: 'NOT_MODELLED',
    brainActivation: 'NOT_MODELLED',
  };
}

function publicEvent(event) {
  const out = clone(event);
  delete out.eventId;
  delete out.sourceEnvironmentEventIds;
  return out;
}

function summary(state, includePrivate = false) {
  const stimuli = Object.values(state && state.stimuli || {});
  const injuries = Object.values(state && state.injuries || {});
  const history = state && Array.isArray(state.history) ? state.history : [];
  const activeNoxiousStimuli = stimuli.filter((item) =>
    item.status === 'ACTIVE' && item.noxiousStimulus === 'YES');
  const activeInjuries = injuries.filter((item) => item.status === 'ACTIVE');
  const bodySites = [...new Set([...activeNoxiousStimuli, ...activeInjuries]
    .map((item) => item.bodySite).filter(Boolean))];
  const stimulusModalities = [...new Set(activeNoxiousStimuli.map((item) => item.modality))];
  const tissueDamageStatus = activeInjuries.length ? 'CONFIRMED'
    : history.length ? history[history.length - 1].tissue.damageStatus : 'UNKNOWN';
  const sourceEvents = [...new Set(history.flatMap((item) => item.sourceEnvironmentEventIds || []))];
  const result = {
    status: 'implemented',
    publicLabel: 'LIVE',
    meaning: 'Structured bodily harm and noxious-input facts. This is not subjective pain or biological nociception.',
    modelId: SOMATIC_MODEL_ID,
    modelVersion: SOMATIC_MODEL_VERSION,
    provenance: SOMATIC_PROVENANCE,
    activeNoxiousStimuli: includePrivate ? clone(activeNoxiousStimuli)
      : activeNoxiousStimuli.map(({ sourceEnvironmentEventIds, ...item }) => clone(item)),
    activeInjuries: includePrivate ? clone(activeInjuries)
      : activeInjuries.map(({ originEventId, sourceEnvironmentEventIds, followups, ...item }) => clone(item)),
    bodySites,
    stimulusModalities,
    tissueDamageStatus,
    sourceEvents: includePrivate ? sourceEvents : [],
    knowledgeStatus: history.length ? 'POST_INSTALLATION_STRUCTURED_RECORD_AVAILABLE' : 'NO_SOMATIC_RECORD',
    recentSomaticEvents: (includePrivate ? clone(history) : history.map(publicEvent)).slice(-8),
    totalSomaticEvents: history.length,
    subjectivePain: 'NOT_MODELLED',
    generalDiscomfortIntegration: 'NOT_MODELLED',
    predictivePainInference: 'NOT_MODELLED',
    injuryHealingDynamics: 'NOT_MODELLED',
    peripheralSensitisation: 'NOT_MODELLED',
    centralSensitisation: 'NOT_MODELLED',
    allodynia: 'NOT_MODELLED',
    hyperalgesia: 'NOT_MODELLED',
    nocifensiveActionModel: 'NOT_MODELLED',
    brainActivationMapping: 'NOT_MODELLED',
  };
  if (includePrivate) {
    result.injuryLedger = clone(injuries);
    result.stimulusLedger = clone(stimuli);
    result.events = clone(history);
  }
  return result;
}

export function somaticInspection(state) {
  return summary(state, true);
}

export function somaticSnapshot(state) {
  return summary(state, false);
}
