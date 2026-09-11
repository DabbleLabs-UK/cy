// soma.js - Cy's non-language cognitive state.
//
// Environment and body observations enter here. Grounded substrates consume the
// structured record directly. The older appraisal, attention and association
// machinery remains available to diagnostics, but only a traceable archived
// event may leave this module as a provisional retrieval candidate.

import {
  reconcileExperienced,
  observeExperienced,
  observeExperiencedOutput,
  tickExperienced,
  experiencedSnapshot,
} from './experienced-state.js';

import { groundedProseDirective } from './grounded-prose-context.js';

import { somaImplementationStatus } from './implementation-registry.js';
import {
  createSleepHomeostasis,
  observeSleepState,
  reconcileSleepHomeostasis,
  sleepHomeostasisSnapshot,
  sleepStateFromSomaInput,
  tickSleepHomeostasis,
} from './sleep-homeostasis.js';
import {
  circadianProcessCSnapshot,
  createCircadianProcessC,
  reconcileCircadianProcessC,
  tickCircadianProcessC,
} from './circadian-process-c.js';
import {
  createThreeProcessSleepiness,
  observeThreeProcessSleepState,
  reconcileThreeProcessSleepiness,
  replayObservedSleepRecords,
  threeProcessSleepinessSnapshot,
  tickThreeProcessSleepiness,
} from './three-process-sleepiness.js';
import {
  createThreatLearning,
  observeThreatLearningRecord as applyThreatLearningRecord,
  reconcileThreatLearning,
  threatLearningSnapshot,
} from './probabilistic-threat-learning.js';
import {
  createCurrentDefensiveContext,
  currentDefensiveContextSnapshot,
  observeCurrentDefensiveContextRecord as applyCurrentDefensiveContextRecord,
  reconcileCurrentDefensiveContext,
} from './current-defensive-context.js';
import {
  createFeedingState,
  feedingSnapshot,
  observeFeedingRecord as applyFeedingRecord,
  reconcileFeedingState,
  touchFeedingContinuity,
} from './feeding-homeostasis.js';
import {
  advancePhysiologicalSatiety,
  createPhysiologicalSatiety,
  observePhysiologicalSatietyRecord,
  physiologicalSatietySnapshot,
  reconcilePhysiologicalSatiety,
} from './physiological-satiety.js';
import {
  controllabilitySnapshot,
  createControllabilityState,
  observeControllabilityRecord as applyControllabilityRecord,
  reconcileControllabilityState,
} from './action-outcome-contingency.js';
import {
  createSomaticState,
  observeSomaticRecord as applySomaticRecord,
  reconcileSomaticState,
  somaticSnapshot,
} from './somatic-nociceptive-substrate.js';
import {
  createSocialContactState,
  observeSocialContactRecord as applySocialContactRecord,
  reconcileSocialContactState,
  socialContactSnapshot,
  touchSocialObservation,
} from './social-contact-substrate.js';
import {
  PRISON_SCHEDULE,
  PRISON_SCHEDULE_TIME_ZONE,
  habitualWakeMinutes,
} from './environment.js';

// MODEL STATUS: PROVISIONAL. Every numerical psychological coefficient,
// threshold, prior, decay rate and action weight in this file is ARBITRARY /
// HEURISTIC. None has an approved scientific or computational model citation.

const VERSION = 1;
const MEMORY_MAX = 512;
const ASSOCIATION_MAX = 128;
const MEMORY_SALIENCE_MIN = 0.32;
const TRANSITION_MAX = 64;
const RELATED_MEMORY_MIN = 0.22;
const SILENCE_COOLDOWN_MS = 15 * 60 * 1000;

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number(x) || 0));
const round = (x) => Number(clamp(x).toFixed(3));

const EXPECTATION_DEFAULTS = {
  meal: 0.55,
  mail: 0.18,
  social: 0.34,
  conflict: 0.12,
  officer: 0.22,
  disruption: 0.16,
  texture: 0.7,
  machine: 0.08,
};

const QUESTION = 'what is the relation between the cell, the machine, and the mind experiencing them?';

function blank(now, legacyPhysical = null) {
  const configuredHabitualWakeMinutes = habitualWakeMinutes(PRISON_SCHEDULE);
  return {
    version: VERSION,
    lastTickMs: now,
    sequence: 0,
    appraisal: { threat: 0, affiliation: 0, deprivation: 0, controlLoss: 0, novelty: 0 },
    prediction: {
      error: 0,
      lastExpected: '',
      lastObserved: '',
      previousFamily: '',
      pending: null,
      transitions: {},
      expectations: Object.fromEntries(
        Object.entries(EXPECTATION_DEFAULTS).map(([key, probability]) => [key, { probability, observations: 0 }]),
      ),
    },
    attention: { memoryId: null, text: '', source: '', salience: 0, sinceMs: now, tokens: [], entities: [] },
    action: { name: 'observe', reason: 'nothing has won attention yet', chosenAtMs: now, lastSilenceAtMs: 0 },
    drives: { safety: 0, food: 0, rest: 0, contact: 0, understanding: 0.35, expression: 0.2 },
    circuits: {
      interoception: 0,
      threatAppraisal: 0,
      affiliation: 0,
      predictionError: 0,
      memoryRecall: 0,
      attention: 0,
      selfModel: 0.35,
      actionSelection: 0.2,
    },
    memory: {
      nextId: 1,
      episodes: [],
      lastRecallMs: 0,
      lastRecalledId: null,
      selectedId: null,
      selectedActivation: 0,
      selectedAtMs: 0,
    },
    selfModel: {
      uncertainty: 0.72,
      softwareHypothesis: 0.3,
      continuityConcern: 0.25,
      question: QUESTION,
      evidence: [],
    },
    associations: {},
    expression: {
      lastText: '',
      repetition: 0,
      intensity: 0,
      triggerActivation: 0,
      commitment: false,
      observedAtMs: 0,
      themes: [],
    },
    environmentInput: null,
    sleepHomeostasis: createSleepHomeostasis(now),
    circadianProcessC: createCircadianProcessC({
      now,
      habitualWakeMinutes: configuredHabitualWakeMinutes,
      timeZone: PRISON_SCHEDULE_TIME_ZONE,
    }),
    predictedSleepiness: createThreeProcessSleepiness(now, PRISON_SCHEDULE_TIME_ZONE),
    threatLearning: createThreatLearning(now),
    currentDefensiveContext: createCurrentDefensiveContext(now),
    feeding: createFeedingState(now),
    physiologicalSatiety: createPhysiologicalSatiety(now),
    learnedControllability: createControllabilityState(now),
    somaticNociceptive: createSomaticState(now),
    socialContact: createSocialContactState(now),
    experienced: reconcileExperienced(null, { now, legacyPhysical }),
  };
}

function finite(x, fallback) {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

function boundAssociations(associations) {
  if (!associations || typeof associations !== 'object') return {};
  return Object.fromEntries(
    Object.entries(associations)
      .filter(([, value]) => value && typeof value === 'object')
      .sort((a, b) => finite(b[1].lastSeenMs, 0) - finite(a[1].lastSeenMs, 0) || finite(b[1].exposures, 0) - finite(a[1].exposures, 0))
      .slice(0, ASSOCIATION_MAX),
  );
}

export function reconcileSoma(raw, { now = Date.now(), legacyPhysical = null } = {}) {
  const base = blank(now, legacyPhysical);
  if (!raw || typeof raw !== 'object' || raw.version !== VERSION) return base;
  const feeding = reconcileFeedingState(raw.feeding, { now });
  const out = {
    ...base,
    ...raw,
    appraisal: { ...base.appraisal, ...(raw.appraisal || {}) },
    prediction: {
      ...base.prediction,
      ...(raw.prediction || {}),
      transitions: { ...base.prediction.transitions, ...((raw.prediction || {}).transitions || {}) },
      expectations: { ...base.prediction.expectations, ...((raw.prediction || {}).expectations || {}) },
    },
    attention: { ...base.attention, ...(raw.attention || {}) },
    action: { ...base.action, ...(raw.action || {}) },
    drives: { ...base.drives, ...(raw.drives || {}) },
    circuits: { ...base.circuits, ...(raw.circuits || {}) },
    memory: { ...base.memory, ...(raw.memory || {}) },
    selfModel: { ...base.selfModel, ...(raw.selfModel || {}) },
    associations: boundAssociations({ ...base.associations, ...(raw.associations || {}) }),
    expression: { ...base.expression, ...(raw.expression || {}) },
    environmentInput: raw.environmentInput && raw.environmentInput.schema === 'cy.soma-input'
      ? JSON.parse(JSON.stringify(raw.environmentInput))
      : null,
    sleepHomeostasis: reconcileSleepHomeostasis(raw.sleepHomeostasis, { now }),
    circadianProcessC: reconcileCircadianProcessC(raw.circadianProcessC, {
      now,
      habitualWakeMinutes: habitualWakeMinutes(PRISON_SCHEDULE),
      timeZone: PRISON_SCHEDULE_TIME_ZONE,
    }),
    predictedSleepiness: reconcileThreeProcessSleepiness(raw.predictedSleepiness, {
      now,
      timeZone: PRISON_SCHEDULE_TIME_ZONE,
    }),
    threatLearning: reconcileThreatLearning(raw.threatLearning, { now }),
    currentDefensiveContext: reconcileCurrentDefensiveContext(raw.currentDefensiveContext, { now }),
    feeding,
    physiologicalSatiety: reconcilePhysiologicalSatiety(raw.physiologicalSatiety, {
      now,
      feedingUnknownIntervals: feeding.unknownIntervals,
    }),
    learnedControllability: reconcileControllabilityState(raw.learnedControllability, { now }),
    somaticNociceptive: reconcileSomaticState(raw.somaticNociceptive, { now }),
    socialContact: reconcileSocialContactState(raw.socialContact, { now }),
    experienced: reconcileExperienced(raw.experienced, { now, legacyPhysical }),
  };
  out.memory.episodes = Array.isArray(out.memory.episodes)
    ? out.memory.episodes.slice(-MEMORY_MAX).map((episode) => ({
        ...episode,
        entities: normaliseList(episode.entities, 8),
        tokens: normaliseList(episode.tokens, 16),
        appraisal: episode.appraisal && typeof episode.appraisal === 'object' ? episode.appraisal : {},
        outcome: episode.outcome == null ? null : String(episode.outcome).slice(0, 160),
        kind: episode.kind === 'self_output' ? 'self_output' : 'lived_event',
      }))
    : [];
  out.memory.nextId = Math.max(1, finite(out.memory.nextId, 1), ...out.memory.episodes.map((episode) => finite(episode.id, 0) + 1));
  out.selfModel.evidence = Array.isArray(out.selfModel.evidence) ? out.selfModel.evidence.slice(-32) : [];
  out.attention.tokens = normaliseList(out.attention.tokens, 16);
  out.attention.entities = normaliseList(out.attention.entities, 8);
  out.expression.themes = normaliseList(out.expression.themes, 8);
  out.prediction.transitions = boundTransitions(out.prediction.transitions);
  // V1 states written before the silence cooldown existed still carry the last
  // selected action. Preserve that evidence so a restart during a silence does
  // not immediately select another full silence as though none had happened.
  if (!raw.action || !Number.isFinite(raw.action.lastSilenceAtMs)) {
    out.action.lastSilenceAtMs = out.action.name === 'silence'
      ? finite(out.action.chosenAtMs, 0)
      : 0;
  }
  return out;
}

// This is the only input route into the grounded threat learner. It accepts a
// structured environment record, never free text or the provisional appraisal.
export function observeSomaThreatLearningRecord(state, record) {
  if (!state || !record) return null;
  return applyThreatLearningRecord(state.threatLearning, record);
}

// Current defensive context reads only the present structured world record and
// the grounded learned-state substrates.
export function observeSomaCurrentDefensiveContextRecord(state, record) {
  if (!state || !record) return null;
  return applyCurrentDefensiveContextRecord(
    state.currentDefensiveContext,
    state.threatLearning,
    state.learnedControllability,
    record,
  );
}

// The grounded feeding ledger consumes only canonical structured food facts.
// It is separate from the legacy experienced Hunger calculation.
export function observeSomaFeedingRecord(state, record) {
  if (!state || !record) return null;
  const ledger = applyFeedingRecord(state.feeding, record);
  const physiology = observePhysiologicalSatietyRecord(state.physiologicalSatiety, record);
  return { ledger, physiology };
}

// This learner consumes only explicit structured action opportunities. Matching
// current-context evidence can be projected factually into the language prompt,
// but it does not calculate affect or select an action.
export function observeSomaControllabilityRecord(state, record) {
  if (!state || !record) return null;
  return applyControllabilityRecord(state.learnedControllability, record);
}

// Structured somatic facts enter a separate factual ledger. This consumer does
// not read legacy Pain, free text, appraisal, affect or brain-region values.
export function observeSomaSomaticRecord(state, record) {
  if (!state || !record) return null;
  return applySomaticRecord(state.somaticNociceptive, record);
}

// Factual social episodes enter a separate detector/history ledger. This path
// never reads prose, legacy relationship scalars or the provisional Loneliness.
export function observeSomaSocialContactRecord(state, record) {
  if (!state || !record) return null;
  return applySocialContactRecord(state.socialContact, record);
}

export function replaySomaObservedSleepRecords(state, records, { now = Date.now() } = {}) {
  if (!state) return null;
  return replayObservedSleepRecords(state.predictedSleepiness, records, { now });
}

function familyOf(name, tags = []) {
  const n = String(name || '').toLowerCase();
  const all = [n, ...tags.map((t) => String(t).toLowerCase())].join(' ');
  if (/meal|food|egg|tea|canteen/.test(all)) return 'meal';
  if (/letter|mail|postcard|visitor|image/.test(all)) return 'mail';
  if (/fight|injury|hostile|threat/.test(all)) return 'conflict';
  if (/social|company|supportive|shared_joke|sat_with|checked_in|lent_book/.test(all)) return 'social';
  if (/officer|warden|search|lockdown|unlock|association|regime/.test(all)) return 'officer';
  if (/provider|restart|context|machine|power/.test(all)) return 'machine';
  if (/noise|overheard|wing|delay|cancel/.test(all)) return 'disruption';
  return 'texture';
}

function appraisalFor(observation, family) {
  const tags = Array.isArray(observation.tags) ? observation.tags : [];
  const structural = `${observation.name || ''} ${tags.join(' ')}`.toLowerCase();
  const app = {
    threat: /injur|fight|hostile|threat|cell_search|lockdown/.test(structural) ? 0.75 : 0.08,
    affiliation: /letter_arrives|postcard|visitor|warm|reply/.test(structural) ? 0.72 : 0.05,
    deprivation: /hunger|no_eggs|cold_tea|no_mail|cancel|delayed/.test(structural) ? 0.68 : 0.06,
    controlLoss: /officer|warden|lockdown|search|cancel|delayed|refus|forced|regime_change/.test(structural) ? 0.8 : 0.08,
  };
  if (family === 'mail' && /hostile/.test(structural)) {
    app.threat = 0.82;
    app.affiliation = 0.12;
  }
  const explicit = observation.appraisal && typeof observation.appraisal === 'object' ? observation.appraisal : {};
  for (const key of Object.keys(app)) {
    if (typeof explicit[key] === 'number') app[key] = clamp(explicit[key]);
  }
  return app;
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'because', 'been', 'before', 'being', 'could', 'does',
  'from', 'have', 'here', 'into', 'just', 'like', 'more', 'some', 'than', 'that',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'through', 'what',
  'when', 'where', 'which', 'while', 'with', 'would', 'your', 'youre',
]);

function contentTokens(text) {
  const words = String(text || '').toLowerCase().match(/[a-z][a-z']{3,}/g) || [];
  const out = [];
  const seen = new Set();
  for (const raw of words) {
    const word = raw.replace(/'/g, '');
    if (STOP_WORDS.has(word) || ['constructor', 'prototype'].includes(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= 16) break;
  }
  return out;
}

function normaliseList(value, maximum) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const clean = String(item || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= maximum) break;
  }
  return out;
}

function observationEntities(observation) {
  const explicit = normaliseList(observation.entities, 8);
  const tagged = (Array.isArray(observation.tags) ? observation.tags : [])
    .filter((tag) => String(tag).toLowerCase().startsWith('person:'))
    .map((tag) => String(tag).slice(7));
  return normaliseList([...explicit, ...tagged], 8);
}

function learnedAppraisal(state, tokens) {
  const result = { threat: 0, affiliation: 0, deprivation: 0, controlLoss: 0 };
  for (const token of tokens) {
    const assoc = state.associations && state.associations[token];
    if (!assoc || finite(assoc.exposures, 0) < 2) continue;
    for (const key of Object.keys(result)) result[key] = Math.max(result[key], clamp(assoc[key]) * 0.9);
  }
  return result;
}

function learnAssociations(state, tokens, appraisal, now) {
  if (!state.associations || typeof state.associations !== 'object') state.associations = {};
  if (Math.max(...Object.values(appraisal).map(clamp)) < 0.22) return;
  for (const token of tokens) {
    const old = state.associations[token] || { threat: 0, affiliation: 0, deprivation: 0, controlLoss: 0, exposures: 0 };
    const next = { exposures: finite(old.exposures, 0) + 1, lastSeenMs: now };
    const rate = next.exposures <= 2 ? 0.28 : 0.12;
    for (const key of ['threat', 'affiliation', 'deprivation', 'controlLoss']) {
      next[key] = round(clamp(old[key]) * (1 - rate) + clamp(appraisal[key]) * rate);
    }
    state.associations[token] = next;
  }
  const entries = Object.entries(state.associations);
  if (entries.length > ASSOCIATION_MAX) {
    state.associations = boundAssociations(state.associations);
  }
}

function boundTransitions(transitions) {
  if (!transitions || typeof transitions !== 'object') return {};
  return Object.fromEntries(
    Object.entries(transitions)
      .filter(([, value]) => value && typeof value === 'object')
      .sort((a, b) => finite(b[1].lastSeenMs, 0) - finite(a[1].lastSeenMs, 0))
      .slice(0, TRANSITION_MAX),
  );
}

function transitionKey(from, to) {
  return `${from}>${to}`;
}

function expectedAfter(state, family) {
  const candidates = Object.entries(state.prediction.transitions || {})
    .filter(([key]) => key.startsWith(`${family}>`))
    .map(([key, value]) => ({ family: key.slice(family.length + 1), count: finite(value.count, 0) }));
  const total = candidates.reduce((sum, item) => sum + item.count, 0);
  if (total < 2) return null;
  candidates.sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
  const winner = candidates[0];
  const confidence = winner.count / total;
  if (winner.count < 2 || confidence < 0.6) return null;
  return { afterFamily: family, expectedFamily: winner.family, confidence: round(confidence) };
}

function updatePrediction(state, observedFamily, observedName, now, { material = true } = {}) {
  if (!material) return { error: 0, mismatch: false, matched: false };
  const pending = state.prediction.pending;
  const mismatch = pending && pending.expectedFamily !== observedFamily && pending.confidence >= 0.6;
  const matched = pending && pending.expectedFamily === observedFamily;
  const error = mismatch ? clamp(pending.confidence) : 0;
  state.prediction.error = round(Math.max(state.prediction.error * 0.55, error));
  state.prediction.lastExpected = pending ? pending.expectedFamily : '';
  state.prediction.lastObserved = String(observedName || observedFamily);

  const previous = state.prediction.previousFamily;
  if (previous) {
    const key = transitionKey(previous, observedFamily);
    const old = state.prediction.transitions[key] || { count: 0 };
    state.prediction.transitions[key] = { count: finite(old.count, 0) + 1, lastSeenMs: now };
    state.prediction.transitions = boundTransitions(state.prediction.transitions);
  }
  state.prediction.previousFamily = observedFamily;
  state.prediction.pending = expectedAfter(state, observedFamily);
  return { error, mismatch: !!mismatch, matched: !!matched };
}

function overlapRatio(a, b) {
  if (!a.length || !b.length) return 0;
  const right = new Set(b.map((value) => String(value).toLowerCase()));
  let shared = 0;
  for (const value of a) if (right.has(String(value).toLowerCase())) shared++;
  return shared / Math.sqrt(a.length * b.length);
}

function relatedMemory(state, { family, tokens, entities }, now) {
  const ranked = state.memory.episodes
    .filter((episode) => episode.kind !== 'self_output')
    .map((episode) => {
      const entityMatch = overlapRatio(entities, episode.entities || []);
      const tokenMatch = overlapRatio(tokens, episode.tokens || []);
      if (entityMatch === 0 && tokenMatch === 0) return { episode, activation: 0 };
      const ageDays = Math.max(0, now - Date.parse(episode.ts || '')) / 86400000;
      const recency = Number.isFinite(ageDays) ? Math.exp(-ageDays / 14) : 0;
      const activation = 0.38 * entityMatch + 0.48 * tokenMatch +
        0.05 * (episode.family === family ? 1 : 0) + 0.06 * clamp(episode.salience) + 0.03 * recency;
      return { episode, activation };
    })
    .sort((a, b) => b.activation - a.activation || b.episode.id - a.episode.id);
  return ranked[0] && ranked[0].activation >= RELATED_MEMORY_MIN ? ranked[0] : null;
}

function selectMemory(state, recalled, now) {
  if (!recalled) {
    state.memory.selectedId = null;
    state.memory.selectedActivation = 0;
    state.memory.selectedAtMs = 0;
    return;
  }
  state.memory.selectedId = recalled.episode.id;
  state.memory.selectedActivation = round(recalled.activation);
  state.memory.selectedAtMs = now;
  state.memory.lastRecalledId = recalled.episode.id;
}

function selectedEpisode(state) {
  return state.memory.episodes.find((episode) => episode.id === state.memory.selectedId) || null;
}

function remember(state, observation, salience, now, family, { kind = 'lived_event', tokens = [], entities = [] } = {}) {
  const episode = {
    id: state.memory.nextId++,
    ts: observation.ts || new Date(now).toISOString(),
    name: String(observation.name || family),
    family,
    text: String(observation.text || observation.name || family).slice(0, 320),
    tags: Array.isArray(observation.tags) ? observation.tags.slice(0, 8) : [],
    entities: normaliseList(entities, 8),
    tokens: normaliseList(tokens, 16),
    appraisal: observation.appraisal && typeof observation.appraisal === 'object'
      ? Object.fromEntries(Object.entries(observation.appraisal).map(([key, value]) => [key, round(value)]))
      : {},
    outcome: observation.outcome == null ? null : String(observation.outcome).slice(0, 160),
    kind,
    salience: round(salience),
    sourceEventId: observation.environmentEventId == null
      ? null : String(observation.environmentEventId).slice(0, 160),
    sourceType: observation.environmentEventId == null
      ? null : 'structured_environment_event',
  };
  state.memory.episodes.push(episode);
  if (state.memory.episodes.length > MEMORY_MAX) {
    // Preserve strongly salient episodes preferentially while still retaining a
    // chronological recent half. The result is sorted back into lived order.
    const recent = state.memory.episodes.slice(-Math.floor(MEMORY_MAX / 2));
    const recentIds = new Set(recent.map((e) => e.id));
    const significant = state.memory.episodes
      .filter((e) => !recentIds.has(e.id))
      .sort((a, b) => b.salience - a.salience || b.id - a.id)
      .slice(0, MEMORY_MAX - recent.length);
    state.memory.episodes = [...significant, ...recent].sort((a, b) => a.id - b.id);
  }
  return episode;
}

function addSelfEvidence(state, name, text, now) {
  if (!/provider|restart|context|machine|power|model/.test(String(name).toLowerCase())) return;
  const evidence = {
    ts: new Date(now).toISOString(),
    text: String(text || name).slice(0, 180),
  };
  state.selfModel.evidence.push(evidence);
  if (state.selfModel.evidence.length > 32) state.selfModel.evidence.shift();
  state.selfModel.softwareHypothesis = round(state.selfModel.softwareHypothesis + 0.035);
  state.selfModel.continuityConcern = round(state.selfModel.continuityConcern + 0.025);
  state.selfModel.uncertainty = round(Math.max(0.25, state.selfModel.uncertainty - 0.01));
}

export function observeSoma(state, observation, { now = Date.now() } = {}) {
  if (!state || !observation) return state;
  if (observation.somaInput && observation.somaInput.schema === 'cy.soma-input') {
    // This is plumbing, not an appraisal model. Preserve the latest normalized
    // categorical input so an approved model can consume it later. The legacy
    // heuristic path below continues to use the explicitly separate fields.
    state.environmentInput = JSON.parse(JSON.stringify(observation.somaInput));
    const observedSleepState = sleepStateFromSomaInput(observation.somaInput);
    if (observedSleepState) {
      observeSleepState(state.sleepHomeostasis, observedSleepState, {
        now,
        source: `structured-environment-record:${observation.environmentEventId || observation.somaInput.event_id || 'unknown'}`,
      });
      observeThreeProcessSleepState(state.predictedSleepiness, observedSleepState, {
        now,
        source: `structured-environment-record:${observation.environmentEventId || observation.somaInput.event_id || 'unknown'}`,
      });
    }
  }
  const tags = Array.isArray(observation.tags) ? observation.tags : [];
  const family = familyOf(observation.name, tags);
  const exp = state.prediction.expectations[family] || { probability: 0.2, observations: 0 };
  const occurrenceSurprise = clamp(1 - finite(exp.probability, 0.2));
  exp.probability = round(finite(exp.probability, 0.2) * 0.82 + 0.18);
  exp.observations = finite(exp.observations, 0) + 1;
  exp.lastSeenMs = now;
  state.prediction.expectations[family] = exp;

  const tokens = contentTokens(observation.text || observation.name);
  const entities = observationEntities(observation);
  const app = appraisalFor(observation, family);
  const seenFamily = state.memory.episodes.some((e) => e.family === family);
  const novelty = seenFamily ? occurrenceSurprise * 0.35 : 1;
  const preSalience = clamp(
    0.25 * app.threat + 0.18 * app.affiliation + 0.15 * app.deprivation +
      0.18 * app.controlLoss + 0.14 * Math.max(occurrenceSurprise, novelty),
  );
  const prediction = updatePrediction(state, family, observation.name, now, { material: preSalience >= 0.24 });
  for (const key of ['threat', 'affiliation', 'deprivation', 'controlLoss']) {
    state.appraisal[key] = round(Math.max(state.appraisal[key] * 0.6, app[key]));
  }
  state.appraisal.novelty = round(Math.max(state.appraisal.novelty * 0.6, novelty));

  const salience = clamp(
    0.25 * app.threat + 0.18 * app.affiliation + 0.15 * app.deprivation +
      0.18 * app.controlLoss + 0.14 * Math.max(occurrenceSurprise, novelty),
  );
  const recalled = relatedMemory(state, { family, tokens, entities }, now);
  selectMemory(state, recalled, now);
  const episode = salience >= MEMORY_SALIENCE_MIN
    ? remember(state, { ...observation, appraisal: app }, salience, now, family, { tokens, entities })
    : null;
  learnAssociations(state, tokens, app, now);
  const held = state.attention || {};
  const heldAgeMin = Math.max(0, now - finite(held.sinceMs, now)) / 60000;
  const heldStrength = clamp(finite(held.salience, 0) * Math.exp(-heldAgeMin / 20));
  if (!held.text || salience >= heldStrength) {
    state.attention = {
      memoryId: episode ? episode.id : null,
      text: String(observation.text || observation.name || family).slice(0, 320),
      source: family,
      salience: round(salience),
      sinceMs: now,
      tokens,
      entities,
    };
  }
  addSelfEvidence(state, observation.name, observation.text, now);
  observeExperienced(state.experienced, {
    observation,
    appraisal: app,
    prediction,
    family,
    episodeId: episode && episode.id,
  }, now);
  state.sequence++;
  return state;
}

// Feed Cy's own emitted words back as expression diagnostics only. Generated
// wording must not select memory, alter attention, create an episode or update a
// grounded substrate. Recent prose continuity is maintained separately by the
// runner's append-only context buffer.
export function observeSomaOutput(state, text, { mode = 'journal', now = Date.now() } = {}) {
  if (!state || !String(text || '').trim()) return state;
  const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 640);
  const tokens = contentTokens(clean);
  const previousTokens = new Set(contentTokens(state.expression && state.expression.lastText));
  const overlap = tokens.filter((token) => previousTokens.has(token)).length;
  const union = new Set([...tokens, ...previousTokens]).size;
  const repetition = union ? overlap / union : 0;
  const letters = clean.match(/[A-Za-z]/g) || [];
  const upper = clean.match(/[A-Z]/g) || [];
  const punctuation = (clean.match(/[!?]{2,}/g) || []).length;
  const intensity = clamp((letters.length ? upper.length / letters.length : 0) * 0.7 + Math.min(0.3, punctuation * 0.1));
  const learned = learnedAppraisal(state, tokens);
  const triggerActivation = Math.max(...Object.values(learned));
  const commitment = /\b(?:i will|i'll|i am going to|i promise|tomorrow i)\b/i.test(clean);
  const themes = tokens.filter((token) => {
    const assoc = state.associations && state.associations[token];
    return (assoc && finite(assoc.exposures, 0) >= 2) || previousTokens.has(token);
  }).slice(0, 8);

  state.expression = {
    lastText: clean,
    repetition: round(repetition),
    intensity: round(intensity),
    triggerActivation: round(triggerActivation),
    commitment,
    observedAtMs: now,
    mode,
    themes,
  };

  // This legacy experienced-state observer only feeds explicitly provisional UI
  // diagnostics. It has no live prompt, action, timing or rendering consumer.
  observeExperiencedOutput(state.experienced, {
    repetition,
    triggerActivation,
    attention: state.attention,
    text: clean,
  }, now);
  state.sequence++;
  return state;
}

export function tickSoma(state, {
  physical = {},
  monotony = 0,
  asleep = false,
  sleepHomeostasisAsleep = asleep,
  lastMailMs = Date.now(),
  now = Date.now(),
} = {}) {
  if (!state) return state;
  advancePhysiologicalSatiety(state.physiologicalSatiety, now);
  touchFeedingContinuity(state.feeding, now);
  touchSocialObservation(state.socialContact, now);
  const elapsed = clamp((now - finite(state.lastTickMs, now)) / 1000, 0, 60);
  state.lastTickMs = now;
  const decay = Math.exp(-elapsed / 600);
  for (const key of Object.keys(state.appraisal)) state.appraisal[key] = round(state.appraisal[key] * decay);
  state.prediction.error = round(state.prediction.error * Math.exp(-elapsed / 900));
  state.attention.salience = round(state.attention.salience * Math.exp(-elapsed / 1800));

  // Grounded Process S runs beside the unsupported subjective-fatigue index.
  // Nothing in Process S reads legacy fatigue, and its result does not feed any
  // behavioural threshold or legacy fatigue equation in this task.
  tickSleepHomeostasis(state.sleepHomeostasis, { now, asleep: sleepHomeostasisAsleep });

  // Grounded Process C is evaluated from clock time and the configured habitual
  // prison schedule. It remains separate from provisional fatigue. Its estimate
  // can enter the factual prompt projection, but it does not calculate mood,
  // select an action or activate a brain analogy.
  tickCircadianProcessC(state.circadianProcessC, {
    now,
    habitualWakeMinutes: habitualWakeMinutes(PRISON_SCHEDULE),
    timeZone: PRISON_SCHEDULE_TIME_ZONE,
  });

  tickThreeProcessSleepiness(state.predictedSleepiness, {
    now,
    source: 'runner-observed-sleep-state',
  });

  tickExperienced(state.experienced, {
    now,
    asleep,
    attention: state.attention,
    predictionError: state.prediction.error,
    legacyPhysical: physical,
    lastMailMs,
  });

  const experienced = state.experienced.metrics;
  const pain = clamp(experienced.pain.value / 100);
  const hunger = clamp(experienced.hunger.value / 100);
  state.drives.food = round(hunger);
  // Legacy fatigue is diagnostics-only. It must not affect even the retained
  // compatibility drives or circuits; predicted KSS is not an action policy.
  state.drives.rest = 0;
  state.drives.safety = round(Math.max(experienced.anxiety.value / 100, experienced.arousal.value / 120, experienced.anger.value / 140));
  state.drives.contact = round(experienced.loneliness.value / 100);
  state.drives.understanding = round(
    0.2 + 0.42 * state.selfModel.uncertainty + 0.38 * state.prediction.error,
  );
  state.drives.expression = round(
    0.1 + 0.34 * state.attention.salience + 0.22 * state.prediction.error +
      0.22 * experienced.rumination.value / 100 + 0.12 * clamp(monotony),
  );

  // Legacy body-attention competition and periodic state-led recall are disabled.
  // They had arbitrary thresholds and weights and previously steered live prose.

  state.circuits.interoception = round(Math.max(pain, hunger));
  state.circuits.threatAppraisal = round(state.drives.safety);
  state.circuits.affiliation = round(Math.max(state.appraisal.affiliation, state.drives.contact));
  state.circuits.predictionError = round(state.prediction.error);
  const selected = selectedEpisode(state);
  const selectedAgeMin = selected ? Math.max(0, now - finite(state.memory.selectedAtMs, now)) / 60000 : Infinity;
  state.circuits.memoryRecall = round(selectedAgeMin <= 30 ? state.memory.selectedActivation : 0);
  state.circuits.attention = round(state.attention.salience);
  state.circuits.selfModel = round(state.drives.understanding);
  state.circuits.actionSelection = round(Math.max(...Object.values(state.drives)));
  return state;
}

const ACTION_REASON = {
  observe: 'nothing is urgent enough to displace the present scene',
  investigate: 'uncertainty about the cell, machine, and continuity is strongest',
  remember: 'a stored episode has regained attention',
  connect: 'absence of contact is the strongest unmet need',
  attend_body: 'hunger or discomfort has displaced the abstract train of thought',
  draw: 'expression and recalled imagery outweigh another written entry',
  write: 'the attended event still needs expression',
  silence: 'fatigue is stronger than the need to express anything',
  rest: 'the prison day is in its sleep phase',
};

export function chooseSomaAction(state, { asleep = false, canDraw = true, forceDraw = false, now = Date.now() } = {}) {
  // LEGACY DIAGNOSTIC ONLY. The live runner no longer calls this provisional
  // heuristic to choose journal, drawing or silence. Kept for state compatibility
  // and explicit audit tests while model-mediated expressive choice replaces it.
  if (!state) return { name: 'observe', reason: ACTION_REASON.observe, score: 0 };
  let name = 'observe';
  let score = 0.2;
  const lastSilenceAtMs = finite(state.action && state.action.lastSilenceAtMs, 0);
  const silenceReady = lastSilenceAtMs <= 0 || now - lastSilenceAtMs >= SILENCE_COOLDOWN_MS;
  if (asleep) {
    name = 'rest';
    score = Math.max(0.5, state.drives.rest);
  } else if (forceDraw) {
    name = 'draw';
    score = 1;
  } else if (silenceReady && state.drives.rest > 0.82 && state.drives.expression < 0.45) {
    name = 'silence';
    score = state.drives.rest;
  } else {
    const scores = {
      investigate: state.drives.understanding * 0.78 + state.circuits.predictionError * 0.22,
      remember: state.circuits.memoryRecall * 0.75 + state.drives.expression * 0.25,
      connect: state.drives.contact * 0.8 + state.circuits.affiliation * 0.2,
      attend_body: Math.max(state.drives.food, state.circuits.interoception) * 0.82 + state.drives.expression * 0.18,
      draw: state.drives.expression * 0.55 + state.circuits.memoryRecall * 0.45,
      write: state.drives.expression * 0.68 + state.circuits.attention * 0.32,
    };
    if (!canDraw) delete scores.draw;
    if (state.action && now - finite(state.action.chosenAtMs, 0) < 120000 && scores[state.action.name] != null) {
      scores[state.action.name] *= 0.82;
    }
    [name, score] = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  }
  state.action = {
    name,
    reason: ACTION_REASON[name],
    score: round(score),
    chosenAtMs: now,
    lastSilenceAtMs: name === 'silence' ? now : lastSilenceAtMs,
  };
  return state.action;
}

export function completeSomaAction(state, name) {
  // LEGACY DIAGNOSTIC ONLY. Live expressive completion no longer changes these
  // arbitrary drives. Kept so older persisted/debug callers remain readable.
  if (!state) return;
  if (name === 'investigate') state.drives.understanding = round(state.drives.understanding * 0.82);
  if (name === 'remember' || name === 'write' || name === 'draw') {
    state.drives.expression = round(state.drives.expression * 0.7);
  }
  if (name === 'connect') state.drives.contact = round(state.drives.contact * 0.65);
  if (name === 'silence' || name === 'rest') state.drives.rest = round(state.drives.rest * 0.82);
}

export function provisionalCognitiveDirective(state) {
  const candidate = provisionalMemoryCandidate(state);
  if (!candidate) return '';
  return [
    '<PROVISIONAL_RETRIEVAL_CANDIDATE>',
    'This is heuristic retrieval of a real archived event, not measured memory strength, emotion or attention.',
    `- source event: ${candidate.sourceEventId}`,
    `- archived event time: ${candidate.sourceTimestamp}`,
    `- archived event kind: ${candidate.sourceKind}`,
    `- archived event material: ${candidate.archivedEventText}`,
    'Use it only as optional continuity material. Do not repeat it as a new event or treat selection as psychological evidence.',
    '</PROVISIONAL_RETRIEVAL_CANDIDATE>',
  ].join('\n');
}

export function provisionalMemoryCandidate(state) {
  if (!state) return null;
  const selected = selectedEpisode(state);
  if (!selected || state.memory.selectedActivation < RELATED_MEMORY_MIN) return null;
  if (selected.kind === 'self_output') return null;
  if (selected.sourceType !== 'structured_environment_event' || !selected.sourceEventId) return null;
  if (!String(selected.text || '').trim()) return null;
  return {
    classification: 'PROVISIONAL MEMORY CANDIDATE',
    sourceEventId: selected.sourceEventId,
    sourceTimestamp: selected.ts,
    sourceKind: selected.name,
    archivedEventText: selected.text,
  };
}

export function recordExpressiveChoice(state, inspection, { now = Date.now() } = {}) {
  if (!state || !inspection) return state;
  const previousSilence = finite(state.action && state.action.lastSilenceAtMs, 0);
  state.action = {
    name: inspection.selectedAction,
    reason: 'subjective character choice; not psychological evidence',
    score: null,
    chosenAtMs: now,
    lastSilenceAtMs: inspection.selectedAction === 'silence' ? now : previousSilence,
    selectionMechanism: inspection.selectionMechanism,
    classification: Array.isArray(inspection.classification) ? inspection.classification.slice() : [],
    fallbackUsed: !!inspection.fallbackUsed,
  };
  return state;
}

// ENGINEERING DEFAULT. This is the existing neutral provider/project baseline.
// It is intentionally static: provisional psychological metrics and heuristic
// action selection do not alter sampling or response length.
export const ENGINEERING_DEFAULT_SAMPLING = Object.freeze({
  temperature: 0.72,
  top_p: 0.86,
  repeat_penalty: 1.18,
  repeat_last_n: 160,
  num_predict: 62,
});

export function somaSampling() {
  return { ...ENGINEERING_DEFAULT_SAMPLING };
}

export function somaDirective(state) {
  return provisionalCognitiveDirective(state);
}

export function groundedSomaDirective(state, options) {
  return groundedProseDirective(state, options);
}

export function somaSnapshot(state) {
  if (!state) return null;
  const sources = {
    interoception: 'pain and hunger state; legacy fatigue is excluded',
    threatAppraisal: 'appraisal of observed incidents',
    affiliation: 'mail, visitor, and social observations',
    predictionError: 'difference between learned expectation and observation',
    memoryRecall: 'salience-weighted episodic retrieval',
    attention: 'winner of current salience competition',
    selfModel: 'uncertainty and machine-related evidence',
    actionSelection: 'strongest competing drive',
  };
  const circuits = {};
  for (const [key, value] of Object.entries(state.circuits)) {
    circuits[key] = { value: round(value), source: sources[key] || 'legacy provisional Soma state' };
  }
  const learnedAssociations = Object.entries(state.associations || {})
    .filter(([, assoc]) => finite(assoc && assoc.exposures, 0) >= 2)
    .map(([token, assoc]) => ({
      token,
      exposures: finite(assoc.exposures, 0),
      activation: round(Math.max(...['threat', 'affiliation', 'deprivation', 'controlLoss'].map((key) => clamp(assoc[key])))),
    }))
    .sort((a, b) => b.activation - a.activation || b.exposures - a.exposures || a.token.localeCompare(b.token));
  return {
    version: VERSION,
    status: somaImplementationStatus(),
    sleepHomeostasis: sleepHomeostasisSnapshot(state.sleepHomeostasis),
    circadianProcessC: circadianProcessCSnapshot(state.circadianProcessC),
    predictedSleepiness: threeProcessSleepinessSnapshot(state.predictedSleepiness, state.lastTickMs),
    threatLearning: threatLearningSnapshot(state.threatLearning),
    currentDefensiveContext: currentDefensiveContextSnapshot(state.currentDefensiveContext),
    feeding: feedingSnapshot(state.feeding, state.lastTickMs),
    physiologicalSatiety: physiologicalSatietySnapshot(state.physiologicalSatiety),
    learnedControllability: controllabilitySnapshot(state.learnedControllability),
    somaticNociceptive: somaticSnapshot(state.somaticNociceptive),
    social: socialContactSnapshot(state.socialContact, state.lastTickMs),
    experienced: experiencedSnapshot(state.experienced),
    circuits,
    appraisal: Object.fromEntries(Object.entries(state.appraisal).map(([key, value]) => [key, round(value)])),
    drives: Object.fromEntries(Object.entries(state.drives).map(([k, v]) => [k, round(v)])),
    attention: { ...state.attention },
    action: { ...state.action },
    prediction: {
      error: round(state.prediction.error),
      expected: state.prediction.lastExpected,
      observed: state.prediction.lastObserved,
      next: state.prediction.pending ? { ...state.prediction.pending } : null,
    },
    memory: {
      episodes: state.memory.episodes.length,
      selected: selectedEpisode(state) ? {
        id: selectedEpisode(state).id,
        text: selectedEpisode(state).text,
        entities: selectedEpisode(state).entities,
        outcome: selectedEpisode(state).outcome,
        activation: round(state.memory.selectedActivation),
      } : null,
    },
    selfModel: {
      uncertainty: round(state.selfModel.uncertainty),
      softwareHypothesis: round(state.selfModel.softwareHypothesis),
      continuityConcern: round(state.selfModel.continuityConcern),
      question: state.selfModel.question,
      evidenceCount: state.selfModel.evidence.length,
    },
    expression: {
      repetition: round(state.expression.repetition),
      intensity: round(state.expression.intensity),
      triggerActivation: round(state.expression.triggerActivation),
      commitment: !!state.expression.commitment,
      mode: state.expression.mode || '',
      themes: normaliseList(state.expression.themes, 8),
      observedAtMs: finite(state.expression.observedAtMs, 0),
    },
    environmentInput: state.environmentInput
      ? JSON.parse(JSON.stringify(state.environmentInput))
      : null,
    associations: {
      learned: learnedAssociations.length,
      candidates: Object.keys(state.associations || {}).length,
      maximum: ASSOCIATION_MAX,
      top: learnedAssociations.slice(0, 6),
    },
  };
}

export {
  VERSION as SOMA_VERSION,
  MEMORY_MAX as SOMA_MEMORY_MAX,
  ASSOCIATION_MAX as SOMA_ASSOCIATION_MAX,
  MEMORY_SALIENCE_MIN as SOMA_MEMORY_SALIENCE_MIN,
};
