// social-contact-substrate.js - factual social episodes and opportunities.
//
// This is the detector/history layer of a future social-homeostatic model. It
// consumes only explicit world.social facts. It does not read prose, legacy
// relationship scores, regex classifications, Loneliness, or model output.

export const SOCIAL_STATE_SCHEMA = 'cy.social-contact-substrate';
export const SOCIAL_STATE_VERSION = 1;
export const SOCIAL_EPISODE_SCHEMA = 'cy.social-episode';
export const SOCIAL_MODEL_ID = 'social-contact-detector-ledger';
export const SOCIAL_MODEL_VERSION = 'social-contact-detector-ledger-v1';
export const SOCIAL_PROVENANCE = 'config/model-specs/social-contact-substrate.json';

export const SOCIAL_CHANNELS = Object.freeze(['IN_PERSON', 'POSTCARD', 'OFFICER_INTERACTION', 'OTHER', 'UNKNOWN']);
export const SOCIAL_FORMS = Object.freeze(['DIRECT_INTERACTION', 'PASSIVE_CO_PRESENCE', 'ATTEMPTED_CONTACT', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'UNKNOWN']);
export const SOCIAL_DIRECTIONS = Object.freeze(['INITIATED_BY_CY', 'INITIATED_BY_OTHER', 'MUTUAL', 'UNKNOWN']);
export const SOCIAL_RECIPROCITIES = Object.freeze(['RECIPROCAL', 'ONE_WAY', 'REJECTED', 'NO_RESPONSE', 'UNKNOWN']);
export const SOCIAL_CHARACTERS = Object.freeze(['SUPPORTIVE', 'ORDINARY', 'HOSTILE', 'REJECTING', 'AMBIGUOUS', 'UNKNOWN']);
export const SOCIAL_RESOLUTIONS = Object.freeze(['ONGOING', 'COMPLETED', 'INTERRUPTED', 'UNKNOWN']);
export const SOCIAL_EPISODE_TYPES = Object.freeze(['CONTACT', 'OPPORTUNITY', 'CONFIRMED_ISOLATION', 'OBSERVATION_GAP', 'UNKNOWN']);

const VALID = {
  channel: new Set(SOCIAL_CHANNELS), form: new Set(SOCIAL_FORMS), direction: new Set(SOCIAL_DIRECTIONS),
  reciprocity: new Set(SOCIAL_RECIPROCITIES), character: new Set(SOCIAL_CHARACTERS),
  resolution: new Set(SOCIAL_RESOLUTIONS), episodeType: new Set(SOCIAL_EPISODE_TYPES),
};

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const timestampMs = (value) => { const parsed = Date.parse(String(value || '')); return Number.isFinite(parsed) ? parsed : null; };
const enumValue = (value, valid) => { const normalized = String(value || 'UNKNOWN').toUpperCase(); return valid.has(normalized) ? normalized : 'UNKNOWN'; };
const optionalId = (value) => { const text = String(value || '').trim(); return text || null; };

function socialFacts(record) {
  return record && record.world_event && record.world_event.world && record.world_event.world.social;
}

export function socialEpisodeFromEnvironment(record) {
  const event = record && record.world_event;
  const social = socialFacts(record);
  if (!event || !social || typeof social !== 'object' || !social.episode_id) return null;
  const startTimestamp = optionalId(social.start_at) || event.timestamp;
  const endTimestamp = optionalId(social.end_at);
  const startMs = timestampMs(startTimestamp);
  const endMs = timestampMs(endTimestamp);
  if (startMs == null || (endTimestamp && endMs == null)) return null;
  const episodeType = enumValue(social.episode_type, VALID.episodeType);
  const linked = [...new Set([
    ...(Array.isArray(social.linked_event_ids) ? social.linked_event_ids : []),
    event.id,
  ].map(optionalId).filter(Boolean))];
  return {
    schema: SOCIAL_EPISODE_SCHEMA,
    version: SOCIAL_STATE_VERSION,
    episodeId: String(social.episode_id),
    episodeType,
    startTimestamp,
    endTimestamp,
    durationMs: startMs != null && endMs != null && endMs >= startMs ? endMs - startMs : null,
    linkedEnvironmentEventIds: linked,
    participants: {
      actorId: optionalId(social.actor_id),
      actorLabel: optionalId(social.actor_label),
      targetId: optionalId(social.target_id),
      targetLabel: optionalId(social.target_label),
      relationshipRef: optionalId(social.relationship_ref),
    },
    channel: enumValue(social.channel, VALID.channel),
    contactForm: enumValue(social.contact_form, VALID.form),
    direction: enumValue(social.direction, VALID.direction),
    reciprocity: enumValue(social.reciprocity, VALID.reciprocity),
    socialCharacter: enumValue(social.character, VALID.character),
    resolution: enumValue(social.resolution, VALID.resolution),
    opportunity: {
      opportunityId: optionalId(social.opportunity_id),
      status: String(social.opportunity_status || 'UNKNOWN').toUpperCase(),
      actionExecuted: optionalId(social.action_executed),
    },
    isolation: {
      continuouslyObserved: social.continuously_observed === true,
      aloneEstablished: social.alone_established === true,
      noContactEstablished: social.no_contact_established === true,
    },
    fieldProvenance: 'STRUCTURED_WORLD_FACT',
    socialHomeostaticInterpretation: 'NOT_MODELLED',
    subjectiveLoneliness: 'NOT_MODELLED',
  };
}

export function createSocialContactState(now = Date.now()) {
  return {
    schema: SOCIAL_STATE_SCHEMA, version: SOCIAL_STATE_VERSION,
    modelId: SOCIAL_MODEL_ID, modelVersion: SOCIAL_MODEL_VERSION, provenance: SOCIAL_PROVENANCE,
    installedAtMs: now, episodes: [], observationGaps: [],
    continuity: { status: 'CONTINUOUS', lastObservedAtMs: now },
  };
}

function validEpisode(item) {
  return item && item.schema === SOCIAL_EPISODE_SCHEMA && item.version === SOCIAL_STATE_VERSION
    && typeof item.episodeId === 'string' && item.episodeId && timestampMs(item.startTimestamp) != null
    && VALID.episodeType.has(item.episodeType) && VALID.channel.has(item.channel)
    && VALID.form.has(item.contactForm) && VALID.direction.has(item.direction)
    && VALID.reciprocity.has(item.reciprocity) && VALID.character.has(item.socialCharacter)
    && VALID.resolution.has(item.resolution);
}

export function reconcileSocialContactState(raw, { now = Date.now() } = {}) {
  const out = createSocialContactState(now);
  if (!raw || raw.schema !== SOCIAL_STATE_SCHEMA || raw.version !== SOCIAL_STATE_VERSION) return out;
  out.installedAtMs = Number.isFinite(raw.installedAtMs) ? raw.installedAtMs : now;
  out.episodes = Array.isArray(raw.episodes) ? raw.episodes.filter(validEpisode).map(clone) : [];
  out.observationGaps = Array.isArray(raw.observationGaps) ? raw.observationGaps.filter((gap) =>
    gap && timestampMs(gap.startTimestamp) != null && timestampMs(gap.endTimestamp) != null).map(clone) : [];
  const lastObservedAtMs = Number(raw.continuity && raw.continuity.lastObservedAtMs);
  if (Number.isFinite(lastObservedAtMs) && now > lastObservedAtMs && out.episodes.length) {
    out.observationGaps.push({
      episodeType: 'OBSERVATION_GAP', startTimestamp: new Date(lastObservedAtMs).toISOString(),
      endTimestamp: new Date(now).toISOString(), reason: 'RUNNER_NOT_OBSERVING',
      isolationInference: 'NONE_MADE',
    });
  }
  out.continuity = { status: 'CONTINUOUS', lastObservedAtMs: now };
  return out;
}

export function touchSocialObservation(state, now = Date.now()) {
  if (state && state.continuity && Number.isFinite(now)) {
    state.continuity.status = 'CONTINUOUS';
    state.continuity.lastObservedAtMs = now;
  }
  return state;
}

function mergeEpisode(existing, incoming) {
  const merged = clone(incoming);
  merged.startTimestamp = existing.startTimestamp || incoming.startTimestamp;
  merged.linkedEnvironmentEventIds = [...new Set([
    ...(existing.linkedEnvironmentEventIds || []), ...(incoming.linkedEnvironmentEventIds || []),
  ])];
  if (!incoming.endTimestamp && existing.endTimestamp) merged.endTimestamp = existing.endTimestamp;
  const startMs = timestampMs(merged.startTimestamp);
  const endMs = timestampMs(merged.endTimestamp);
  merged.durationMs = startMs != null && endMs != null && endMs >= startMs ? endMs - startMs : null;
  return merged;
}

export function observeSocialContactRecord(state, record) {
  if (!state || !record) return { updated: false, reason: 'invalid_record' };
  const episode = socialEpisodeFromEnvironment(record);
  if (!episode) return { updated: false, reason: 'not_a_social_episode' };
  if (episode.episodeType === 'CONFIRMED_ISOLATION'
    && !(episode.isolation.continuouslyObserved && episode.isolation.aloneEstablished && episode.isolation.noContactEstablished)) {
    return { updated: false, reason: 'isolation_not_confirmed' };
  }
  const index = state.episodes.findIndex((item) => item.episodeId === episode.episodeId);
  const stored = index >= 0 ? mergeEpisode(state.episodes[index], episode) : clone(episode);
  if (index >= 0) state.episodes[index] = stored; else state.episodes.push(stored);
  if (episode.episodeType === 'OBSERVATION_GAP') {
    state.observationGaps.push({
      episodeId: episode.episodeId, startTimestamp: episode.startTimestamp, endTimestamp: episode.endTimestamp,
      reason: 'RUNNER_NOT_OBSERVING', isolationInference: 'NONE_MADE',
    });
  }
  const observedAt = timestampMs(episode.endTimestamp || episode.startTimestamp);
  if (observedAt != null) state.continuity.lastObservedAtMs = Math.max(state.continuity.lastObservedAtMs, observedAt);
  return { updated: true, modelId: SOCIAL_MODEL_ID, modelVersion: SOCIAL_MODEL_VERSION,
    provenance: SOCIAL_PROVENANCE, sourceEnvironmentEventId: record.world_event.id, episode: clone(stored) };
}

function publicEpisode(episode) {
  if (!episode) return null;
  const item = clone(episode);
  delete item.linkedEnvironmentEventIds;
  if (item.participants) {
    delete item.participants.actorId;
    delete item.participants.targetId;
    delete item.participants.relationshipRef;
  }
  return item;
}

function isContact(episode) {
  return episode.episodeType === 'CONTACT' && episode.contactForm !== 'ATTEMPTED_CONTACT';
}

function latest(episodes, predicate) {
  return [...episodes].filter(predicate).sort((a, b) =>
    timestampMs(b.endTimestamp || b.startTimestamp) - timestampMs(a.endTimestamp || a.startTimestamp))[0] || null;
}

function context(state, now, includePrivate) {
  const episodes = state && state.episodes || [];
  const current = latest(episodes, (item) => item.resolution === 'ONGOING');
  const expose = includePrivate ? clone : publicEpisode;
  const direct = latest(episodes, (item) => isContact(item) && item.contactForm === 'DIRECT_INTERACTION');
  const reciprocal = latest(episodes, (item) => isContact(item) && item.reciprocity === 'RECIPROCAL');
  const supportive = latest(episodes, (item) => isContact(item) && item.socialCharacter === 'SUPPORTIVE');
  const hostile = latest(episodes, (item) => isContact(item) && item.socialCharacter === 'HOSTILE');
  const rejection = latest(episodes, (item) => item.reciprocity === 'REJECTED' || item.socialCharacter === 'REJECTING');
  const isolation = latest(episodes, (item) => item.episodeType === 'CONFIRMED_ISOLATION');
  const unresolved = episodes.filter((item) => item.episodeType === 'OPPORTUNITY' && item.resolution === 'ONGOING');
  const at = (item) => item ? (item.endTimestamp || item.startTimestamp) : null;
  const elapsed = (item) => { const ms = timestampMs(at(item)); return ms == null ? null : Math.max(0, now - ms); };
  return {
    status: 'implemented', publicLabel: 'LIVE',
    meaning: 'Factual social episodes and opportunities; not a Loneliness or affiliation score.',
    modelId: SOCIAL_MODEL_ID, modelVersion: SOCIAL_MODEL_VERSION, provenance: SOCIAL_PROVENANCE,
    currentContext: {
      currentlyInteracting: !!(current && current.episodeType === 'CONTACT'),
      currentlyAlone: !!(current && current.episodeType === 'CONFIRMED_ISOLATION'),
      currentlyWith: current && current.participants ? current.participants.actorLabel : null,
      currentEpisodeType: current ? current.episodeType : 'NONE_OBSERVED',
      currentSocialCharacter: current ? current.socialCharacter : 'UNKNOWN',
    },
    lastDirectContactAt: at(direct), elapsedSinceDirectContactMs: elapsed(direct),
    lastReciprocalContactAt: at(reciprocal), elapsedSinceReciprocalContactMs: elapsed(reciprocal),
    lastSupportiveContactAt: at(supportive), elapsedSinceSupportiveContactMs: elapsed(supportive),
    lastHostileContactAt: at(hostile), elapsedSinceHostileContactMs: elapsed(hostile),
    latestEpisode: expose(latest(episodes, () => true)), recentRejection: expose(rejection),
    confirmedIsolation: expose(isolation), unresolvedOpportunities: unresolved.map(expose),
    observationContinuity: clone(state && state.continuity),
    observationGaps: clone(state && state.observationGaps || []),
    recentEpisodes: episodes.slice(-12).map(expose),
    totalEpisodes: episodes.length,
    socialSetPoint: 'NOT_MODELLED', socialHomeostaticError: 'NOT_MODELLED',
    socialSetPointPlasticity: 'NOT_MODELLED', socialToleranceDynamicRange: 'NOT_MODELLED',
    socialAversiveValue: 'NOT_MODELLED', subjectiveLoneliness: 'NOT_MODELLED',
    legacyDisplayedLoneliness: 'PROVISIONAL',
  };
}

export function socialContactSnapshot(state, now = Date.now()) { return context(state, now, false); }
export function socialContactInspection(state, now = Date.now()) {
  return { ...context(state, now, true), episodes: clone(state && state.episodes || []) };
}
