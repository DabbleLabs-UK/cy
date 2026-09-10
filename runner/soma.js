// soma.js - Cy's non-language cognitive state.
//
// Environment and body observations enter here. The module appraises them,
// updates expectations and durable episodic memory, selects one focus, and
// chooses an action. Generated prose returns only as an efference copy of an
// action Cy took: it can record repetition, commitments and activation of an
// already-learned trigger, but its sentiment never manufactures mental state.

import {
  reconcileExperienced,
  observeExperienced,
  observeExperiencedOutput,
  tickExperienced,
  experiencedSnapshot,
  experiencedDirective,
} from './experienced-state.js';

import { somaImplementationStatus } from './implementation-registry.js';

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
  const learned = learnedAppraisal(state, tokens);
  for (const key of ['threat', 'affiliation', 'deprivation', 'controlLoss']) {
    app[key] = Math.max(app[key], learned[key]);
  }
  const seenFamily = state.memory.episodes.some((e) => e.family === family);
  const novelty = seenFamily ? occurrenceSurprise * 0.35 : 1;
  const preSalience = clamp(
    0.25 * app.threat + 0.18 * app.affiliation + 0.15 * app.deprivation +
      0.18 * app.controlLoss + 0.14 * Math.max(occurrenceSurprise, novelty),
  );
  const prediction = updatePrediction(state, family, observation.name, now, { material: preSalience >= 0.24 });
  if (prediction.error > 0) app.controlLoss = Math.max(app.controlLoss, prediction.error * 0.55);
  for (const key of ['threat', 'affiliation', 'deprivation', 'controlLoss']) {
    state.appraisal[key] = round(Math.max(state.appraisal[key] * 0.6, app[key]));
  }
  state.appraisal.novelty = round(Math.max(state.appraisal.novelty * 0.6, novelty));

  const salience = clamp(
    0.25 * app.threat + 0.18 * app.affiliation + 0.15 * app.deprivation +
      0.18 * app.controlLoss + 0.14 * Math.max(occurrenceSurprise, novelty) + 0.1 * prediction.error,
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

// Feed Cy's own emitted words back as evidence of an ACTION, not as a mood
// detector. This is an efference-copy channel: it records what he expressed and
// lets a word that acquired meaning through earlier lived outcomes reactivate the
// attended material. It never changes threat/affiliation/etc from prose sentiment.
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
  const related = relatedMemory(state, { family: '', tokens, entities: [] }, now);
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

  // A self-spoken learned trigger can keep the already-selected episode active,
  // but cannot create a new appraisal or reverse-engineer an emotion from tone.
  if (state.attention && state.attention.memoryId && triggerActivation > 0.25) {
    state.attention.salience = round(Math.max(state.attention.salience, triggerActivation * 0.45));
  } else if (state.attention && repetition < 0.1 && triggerActivation < 0.15) {
    state.attention.salience = round(state.attention.salience * 0.92);
  }
  selectMemory(state, related, now);
  const outputSalience = clamp(0.08 + 0.24 * triggerActivation + 0.12 * repetition + 0.12 * intensity + (commitment ? 0.2 : 0));
  if (outputSalience >= MEMORY_SALIENCE_MIN) {
    remember(state, {
      name: 'self_expression',
      text: clean,
      tags: ['self-output', mode, commitment ? 'commitment' : 'expression'],
      ts: new Date(now).toISOString(),
      outcome: 'Cy expressed this; it is not evidence that its content happened',
    }, outputSalience, now, 'expression', { kind: 'self_output', tokens });
  }
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
  lastMailMs = Date.now(),
  now = Date.now(),
} = {}) {
  if (!state) return state;
  const elapsed = clamp((now - finite(state.lastTickMs, now)) / 1000, 0, 60);
  state.lastTickMs = now;
  const decay = Math.exp(-elapsed / 600);
  for (const key of Object.keys(state.appraisal)) state.appraisal[key] = round(state.appraisal[key] * decay);
  state.prediction.error = round(state.prediction.error * Math.exp(-elapsed / 900));
  state.attention.salience = round(state.attention.salience * Math.exp(-elapsed / 1800));

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
  const fatigue = clamp(experienced.fatigue.value / 100);
  state.drives.food = round(hunger);
  state.drives.rest = round(asleep ? Math.max(0.2, fatigue * 0.5) : fatigue);
  state.drives.safety = round(Math.max(experienced.anxiety.value / 100, experienced.arousal.value / 120, experienced.anger.value / 140));
  state.drives.contact = round(experienced.loneliness.value / 100);
  state.drives.understanding = round(
    0.2 + 0.42 * state.selfModel.uncertainty + 0.38 * state.prediction.error,
  );
  state.drives.expression = round(
    0.1 + 0.34 * state.attention.salience + 0.22 * state.prediction.error +
      0.22 * experienced.rumination.value / 100 + 0.12 * clamp(monotony),
  );

  // Body state competes for attention before language. This is not sentiment
  // inferred from prose: it comes from the persisted meal, sleep and pain state.
  const bodyCandidates = [];
  const nutrition = state.experienced.body && state.experienced.body.nutrition;
  if (state.drives.food > 0.62) {
    bodyCandidates.push({
      source: 'body:hunger',
      salience: state.drives.food * 0.82,
      text: nutrition && nutrition.lastMealName
        ? `the ${nutrition.lastMealName} that was eaten is a long way behind him now`
        : 'the empty pull in his stomach keeps interrupting everything else',
    });
  }
  if (state.drives.rest > 0.72) {
    bodyCandidates.push({
      source: 'body:fatigue',
      salience: state.drives.rest * 0.78,
      text: 'tiredness keeps breaking concentration and making the next action harder',
    });
  }
  if (pain > 0.45) {
    bodyCandidates.push({
      source: 'body:pain',
      salience: pain * 0.86,
      text: 'bodily discomfort keeps interrupting the present thought',
    });
  }
  const bodyWinner = bodyCandidates.sort((a, b) => b.salience - a.salience)[0];
  if (bodyWinner && bodyWinner.salience > finite(state.attention.salience, 0)) {
    state.attention = {
      memoryId: null,
      text: bodyWinner.text,
      source: bodyWinner.source,
      salience: round(bodyWinner.salience),
      sinceMs: now,
      tokens: contentTokens(bodyWinner.text),
      entities: [],
    };
  }

  // Retrieval is deterministic and state-led. When the present focus has faded
  // (or monotony is high), older episodes compete by stored salience, recency,
  // and relevance to the strongest current need. This is actual episodic recall,
  // not a fresh model invention presented as memory.
  const recallDue = now - finite(state.memory.lastRecallMs, 0) >= 15 * 60 * 1000;
  if (recallDue && state.memory.episodes.length && (state.attention.salience < 0.28 || monotony > 0.55)) {
    const familyDrive = {
      meal: state.drives.food,
      mail: state.drives.contact,
      social: state.drives.contact,
      conflict: state.drives.safety,
      officer: state.drives.safety,
      machine: state.drives.understanding,
      disruption: state.drives.expression,
      texture: state.drives.expression,
    };
    const focusTokens = normaliseList(state.attention.tokens, 16);
    const focusEntities = normaliseList(state.attention.entities, 8);
    const ranked = state.memory.episodes.filter((episode) => episode.kind !== 'self_output').map((episode) => {
      const ageDays = Math.max(0, now - Date.parse(episode.ts || '')) / 86400000;
      const recency = Number.isFinite(ageDays) ? Math.exp(-ageDays / 7) : 0;
      const relevance = Math.max(overlapRatio(focusTokens, episode.tokens || []), overlapRatio(focusEntities, episode.entities || []));
      let activation = 0.42 * clamp(episode.salience) + 0.2 * recency +
        0.2 * clamp(familyDrive[episode.family]) + 0.18 * relevance;
      if (episode.id === state.memory.lastRecalledId) activation *= 0.65;
      return { episode, activation };
    }).sort((a, b) => b.activation - a.activation || b.episode.id - a.episode.id);
    const recalled = ranked[0];
    if (recalled && (recalled.activation > state.attention.salience + 0.05 || monotony > 0.7)) {
      selectMemory(state, recalled, now);
      state.attention = {
        memoryId: recalled.episode.id,
        text: recalled.episode.text,
        source: `memory:${recalled.episode.family}`,
        salience: round(recalled.activation),
        sinceMs: now,
        tokens: normaliseList(recalled.episode.tokens, 16),
        entities: normaliseList(recalled.episode.entities, 8),
      };
    }
    state.memory.lastRecallMs = now;
  }

  state.circuits.interoception = round(Math.max(pain, hunger, fatigue));
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
  if (!state) return;
  if (name === 'investigate') state.drives.understanding = round(state.drives.understanding * 0.82);
  if (name === 'remember' || name === 'write' || name === 'draw') {
    state.drives.expression = round(state.drives.expression * 0.7);
  }
  if (name === 'connect') state.drives.contact = round(state.drives.contact * 0.65);
  if (name === 'silence' || name === 'rest') state.drives.rest = round(state.drives.rest * 0.82);
}

export function somaDirective(state) {
  if (!state) return '';
  const lines = [
    'SOMA - computed before language; this is material and a selected action, not wording to imitate:',
    `- action selected: ${state.action.name} (${state.action.reason})`,
  ];
  lines.push(experiencedDirective(state.experienced));
  if (state.attention && state.attention.text) {
    lines.push(`- what presently has attention: ${state.attention.text}`);
  }
  const pressures = [];
  if (state.drives.safety > 0.55) pressures.push('danger or lost control should colour what is noticed');
  if (state.drives.food > 0.62) pressures.push('bodily deprivation is competing for attention');
  if (state.drives.rest > 0.68) pressures.push('fatigue favours less output');
  if (state.drives.contact > 0.58) pressures.push('contact with another person remains salient');
  if (pressures.length) lines.push(`- active pressure: ${pressures.slice(0, 2).join('; ')}`);
  const selected = selectedEpisode(state);
  if (selected && state.memory.selectedActivation >= RELATED_MEMORY_MIN) {
    const who = selected.entities && selected.entities.length ? ` involving ${selected.entities.join(', ')}` : '';
    lines.push(`- related lived memory${who}: ${selected.text}`);
  }
  if (state.prediction.error > 0.35 && state.prediction.lastObserved) {
    lines.push(`- an expectation was violated: ${state.prediction.lastExpected || 'something else'} was expected next; ${state.prediction.lastObserved} happened`);
  }
  if (state.action.name === 'investigate') {
    lines.push(`- unresolved self-question: ${state.selfModel.question}`);
  }
  if (state.action.name === 'attend_body') {
    lines.push('- bodily need has won attention; begin from what the body interrupts or makes hard to ignore');
  }
  if (state.expression && state.expression.themes && state.expression.themes.length) {
    lines.push(`- recent own wording kept returning to: ${state.expression.themes.slice(0, 4).join(', ')}; this is expression, not proof those things happened`);
  }
  lines.push('Choose your own words. Do not name a score or pretend you were told to feel something.');
  return lines.join('\n');
}

export function somaSampling(state) {
  const c = (state && state.circuits) || {};
  const action = (state && state.action && state.action.name) || 'observe';
  const temperature = clamp(0.64 + 0.22 * clamp(c.predictionError) + 0.12 * (1 - clamp(c.attention)), 0.58, 1.05);
  const lengths = { investigate: 105, remember: 90, connect: 80, attend_body: 58, draw: 45, write: 78, observe: 62 };
  const pressure = Math.max(clamp(state && state.drives && state.drives.rest), clamp(state && state.drives && state.drives.food));
  const predicted = Math.round((lengths[action] || 70) * (1 - 0.42 * pressure));
  return {
    temperature: Number(temperature.toFixed(3)),
    top_p: Number(clamp(0.84 + 0.1 * clamp(c.predictionError), 0.8, 0.95).toFixed(3)),
    repeat_penalty: Number((1.14 + 0.1 * clamp(c.attention)).toFixed(3)),
    repeat_last_n: 160,
    num_predict: Math.max(28, predicted),
  };
}

export function somaSnapshot(state) {
  if (!state) return null;
  const sources = {
    interoception: 'pain, hunger, and fatigue state',
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
