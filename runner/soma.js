// soma.js - Cy's non-language cognitive state.
//
// Environment and body observations enter here. The module appraises them,
// updates expectations and durable episodic memory, selects one focus, and
// chooses an action. The LLM may read the resulting directive but never writes
// these values back. This is the hard seam between state and prose.

const VERSION = 1;
const MEMORY_MAX = 512;

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number(x) || 0));
const round = (x) => Number(clamp(x).toFixed(3));

const EXPECTATION_DEFAULTS = {
  meal: 0.55,
  mail: 0.18,
  conflict: 0.12,
  officer: 0.22,
  disruption: 0.16,
  texture: 0.7,
  machine: 0.08,
};

const QUESTION = 'what is the relation between the cell, the machine, and the mind experiencing them?';

function blank(now) {
  return {
    version: VERSION,
    lastTickMs: now,
    sequence: 0,
    appraisal: { threat: 0, affiliation: 0, deprivation: 0, controlLoss: 0, novelty: 0 },
    prediction: {
      error: 0,
      lastExpected: '',
      lastObserved: '',
      expectations: Object.fromEntries(
        Object.entries(EXPECTATION_DEFAULTS).map(([key, probability]) => [key, { probability, observations: 0 }]),
      ),
    },
    attention: { memoryId: null, text: '', source: '', salience: 0, sinceMs: now },
    action: { name: 'observe', reason: 'nothing has won attention yet', chosenAtMs: now },
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
    memory: { nextId: 1, episodes: [], lastRecallMs: 0, lastRecalledId: null },
    selfModel: {
      uncertainty: 0.72,
      softwareHypothesis: 0.3,
      continuityConcern: 0.25,
      question: QUESTION,
      evidence: [],
    },
  };
}

function finite(x, fallback) {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

export function reconcileSoma(raw, { now = Date.now() } = {}) {
  const base = blank(now);
  if (!raw || typeof raw !== 'object' || raw.version !== VERSION) return base;
  const out = {
    ...base,
    ...raw,
    appraisal: { ...base.appraisal, ...(raw.appraisal || {}) },
    prediction: {
      ...base.prediction,
      ...(raw.prediction || {}),
      expectations: { ...base.prediction.expectations, ...((raw.prediction || {}).expectations || {}) },
    },
    attention: { ...base.attention, ...(raw.attention || {}) },
    action: { ...base.action, ...(raw.action || {}) },
    drives: { ...base.drives, ...(raw.drives || {}) },
    circuits: { ...base.circuits, ...(raw.circuits || {}) },
    memory: { ...base.memory, ...(raw.memory || {}) },
    selfModel: { ...base.selfModel, ...(raw.selfModel || {}) },
  };
  out.memory.episodes = Array.isArray(out.memory.episodes) ? out.memory.episodes.slice(-MEMORY_MAX) : [];
  out.memory.nextId = Math.max(1, finite(out.memory.nextId, 1));
  out.selfModel.evidence = Array.isArray(out.selfModel.evidence) ? out.selfModel.evidence.slice(-32) : [];
  return out;
}

function familyOf(name, tags = []) {
  const n = String(name || '').toLowerCase();
  const all = [n, ...tags.map((t) => String(t).toLowerCase())].join(' ');
  if (/meal|food|egg|tea|canteen/.test(all)) return 'meal';
  if (/letter|mail|postcard|visitor|image/.test(all)) return 'mail';
  if (/social|fight|injury|hostile|threat/.test(all)) return 'conflict';
  if (/officer|warden|search|lockdown|unlock|association|regime/.test(all)) return 'officer';
  if (/provider|restart|context|machine|power/.test(all)) return 'machine';
  if (/noise|overheard|wing|delay|cancel/.test(all)) return 'disruption';
  return 'texture';
}

function appraisalFor(name, text, tags) {
  const all = `${name || ''} ${text || ''} ${(tags || []).join(' ')}`.toLowerCase();
  return {
    threat: /injur|fight|hostile|threat|search|lockdown|warden|refus|taken|cold/.test(all) ? 0.75 : 0.08,
    affiliation: /letter|mail|visitor|kind|shared|warm|help|reply/.test(all) ? 0.72 : 0.05,
    deprivation: /hunger|meal|food|egg|tea|cancel|no mail|delayed/.test(all) ? 0.68 : 0.06,
    controlLoss: /officer|warden|lockdown|search|cancel|delayed|refus|forced/.test(all) ? 0.8 : 0.08,
  };
}

function remember(state, observation, salience, now, family) {
  const episode = {
    id: state.memory.nextId++,
    ts: observation.ts || new Date(now).toISOString(),
    name: String(observation.name || family),
    family,
    text: String(observation.text || observation.name || family).slice(0, 320),
    tags: Array.isArray(observation.tags) ? observation.tags.slice(0, 8) : [],
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
  const tags = Array.isArray(observation.tags) ? observation.tags : [];
  const family = familyOf(observation.name, tags);
  const exp = state.prediction.expectations[family] || { probability: 0.2, observations: 0 };
  const error = clamp(1 - finite(exp.probability, 0.2));
  exp.probability = round(finite(exp.probability, 0.2) * 0.82 + 0.18);
  exp.observations = finite(exp.observations, 0) + 1;
  exp.lastSeenMs = now;
  state.prediction.expectations[family] = exp;
  state.prediction.error = round(Math.max(state.prediction.error * 0.55, error));
  state.prediction.lastExpected = family;
  state.prediction.lastObserved = String(observation.name || family);

  const app = appraisalFor(observation.name, observation.text, tags);
  const seenFamily = state.memory.episodes.some((e) => e.family === family);
  const novelty = seenFamily ? error * 0.55 : 1;
  for (const key of ['threat', 'affiliation', 'deprivation', 'controlLoss']) {
    state.appraisal[key] = round(Math.max(state.appraisal[key] * 0.6, app[key]));
  }
  state.appraisal.novelty = round(Math.max(state.appraisal.novelty * 0.6, novelty));

  const salience = clamp(
    0.25 * app.threat + 0.18 * app.affiliation + 0.15 * app.deprivation +
      0.18 * app.controlLoss + 0.24 * Math.max(error, novelty),
  );
  const episode = remember(state, observation, salience, now, family);
  const held = state.attention || {};
  const heldAgeMin = Math.max(0, now - finite(held.sinceMs, now)) / 60000;
  const heldStrength = clamp(finite(held.salience, 0) * Math.exp(-heldAgeMin / 20));
  if (!held.memoryId || salience >= heldStrength) {
    state.attention = {
      memoryId: episode.id,
      text: episode.text,
      source: family,
      salience: round(salience),
      sinceMs: now,
    };
  }
  addSelfEvidence(state, observation.name, observation.text, now);
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

  const pain = clamp(physical.pain);
  const hunger = clamp(physical.hunger);
  const fatigue = clamp(physical.fatigue);
  const mailHours = Math.max(0, now - finite(lastMailMs, now)) / 3600000;
  state.drives.food = round(hunger);
  state.drives.rest = round(asleep ? Math.max(0.2, fatigue * 0.5) : fatigue);
  state.drives.safety = round(Math.max(state.appraisal.threat, state.appraisal.controlLoss * 0.8));
  state.drives.contact = round(clamp(mailHours / 24) * (1 - state.appraisal.affiliation * 0.35));
  state.drives.understanding = round(
    0.2 + 0.42 * state.selfModel.uncertainty + 0.38 * state.prediction.error,
  );
  state.drives.expression = round(
    0.15 + 0.48 * state.attention.salience + 0.2 * state.prediction.error + 0.17 * clamp(monotony),
  );

  // Retrieval is deterministic and state-led. When the present focus has faded
  // (or monotony is high), older episodes compete by stored salience, recency,
  // and relevance to the strongest current need. This is actual episodic recall,
  // not a fresh model invention presented as memory.
  const recallDue = now - finite(state.memory.lastRecallMs, 0) >= 15 * 60 * 1000;
  if (recallDue && state.memory.episodes.length && (state.attention.salience < 0.28 || monotony > 0.55)) {
    const familyDrive = {
      meal: state.drives.food,
      mail: state.drives.contact,
      conflict: state.drives.safety,
      officer: state.drives.safety,
      machine: state.drives.understanding,
      disruption: state.drives.expression,
      texture: state.drives.expression,
    };
    const ranked = state.memory.episodes.map((episode) => {
      const ageDays = Math.max(0, now - Date.parse(episode.ts || '')) / 86400000;
      const recency = Number.isFinite(ageDays) ? Math.exp(-ageDays / 7) : 0;
      let activation = 0.55 * clamp(episode.salience) + 0.25 * recency + 0.2 * clamp(familyDrive[episode.family]);
      if (episode.id === state.memory.lastRecalledId) activation *= 0.65;
      return { episode, activation };
    }).sort((a, b) => b.activation - a.activation || b.episode.id - a.episode.id);
    const recalled = ranked[0];
    if (recalled && (recalled.activation > state.attention.salience + 0.05 || monotony > 0.7)) {
      state.attention = {
        memoryId: recalled.episode.id,
        text: recalled.episode.text,
        source: `memory:${recalled.episode.family}`,
        salience: round(recalled.activation),
        sinceMs: now,
      };
      state.memory.lastRecalledId = recalled.episode.id;
    }
    state.memory.lastRecallMs = now;
  }

  state.circuits.interoception = round(Math.max(pain, hunger, fatigue));
  state.circuits.threatAppraisal = round(state.drives.safety);
  state.circuits.affiliation = round(Math.max(state.appraisal.affiliation, state.drives.contact));
  state.circuits.predictionError = round(state.prediction.error);
  state.circuits.memoryRecall = round(state.attention.memoryId ? state.attention.salience : 0);
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
  draw: 'expression and recalled imagery outweigh another written entry',
  write: 'the attended event still needs expression',
  silence: 'fatigue is stronger than the need to express anything',
  rest: 'the prison day is in its sleep phase',
};

export function chooseSomaAction(state, { asleep = false, canDraw = true, forceDraw = false, now = Date.now() } = {}) {
  if (!state) return { name: 'observe', reason: ACTION_REASON.observe, score: 0 };
  let name = 'observe';
  let score = 0.2;
  if (asleep) {
    name = 'rest';
    score = Math.max(0.5, state.drives.rest);
  } else if (forceDraw) {
    name = 'draw';
    score = 1;
  } else if (state.drives.rest > 0.82 && state.drives.expression < 0.45) {
    name = 'silence';
    score = state.drives.rest;
  } else {
    const scores = {
      investigate: state.drives.understanding * 0.78 + state.circuits.predictionError * 0.22,
      remember: state.circuits.memoryRecall * 0.75 + state.drives.expression * 0.25,
      connect: state.drives.contact * 0.8 + state.circuits.affiliation * 0.2,
      draw: state.drives.expression * 0.55 + state.circuits.memoryRecall * 0.45,
      write: state.drives.expression * 0.68 + state.circuits.attention * 0.32,
    };
    if (!canDraw) delete scores.draw;
    if (state.action && now - finite(state.action.chosenAtMs, 0) < 120000 && scores[state.action.name] != null) {
      scores[state.action.name] *= 0.82;
    }
    [name, score] = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  }
  state.action = { name, reason: ACTION_REASON[name], score: round(score), chosenAtMs: now };
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
  if (state.attention && state.attention.text) {
    lines.push(`- attention selected from lived events: ${state.attention.text}`);
  }
  if (state.prediction.error > 0.35 && state.prediction.lastObserved) {
    lines.push(`- an expectation was violated by: ${state.prediction.lastObserved}`);
  }
  if (state.action.name === 'investigate') {
    lines.push(`- unresolved self-question: ${state.selfModel.question}`);
  }
  lines.push('Choose your own words. Do not name a score or pretend you were told to feel something.');
  return lines.join('\n');
}

export function somaSampling(state) {
  const c = (state && state.circuits) || {};
  const action = (state && state.action && state.action.name) || 'observe';
  const temperature = clamp(0.64 + 0.22 * clamp(c.predictionError) + 0.12 * (1 - clamp(c.attention)), 0.58, 1.05);
  const lengths = { investigate: 105, remember: 90, connect: 80, draw: 45, write: 78, observe: 62 };
  return {
    temperature: Number(temperature.toFixed(3)),
    top_p: Number(clamp(0.84 + 0.1 * clamp(c.predictionError), 0.8, 0.95).toFixed(3)),
    repeat_penalty: Number((1.14 + 0.1 * clamp(c.attention)).toFixed(3)),
    repeat_last_n: 160,
    num_predict: lengths[action] || 70,
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
    circuits[key] = { value: round(value), source: sources[key] || 'implemented Soma state' };
  }
  return {
    version: VERSION,
    status: 'implemented',
    circuits,
    drives: Object.fromEntries(Object.entries(state.drives).map(([k, v]) => [k, round(v)])),
    attention: { ...state.attention },
    action: { ...state.action },
    prediction: {
      error: round(state.prediction.error),
      expected: state.prediction.lastExpected,
      observed: state.prediction.lastObserved,
    },
    memory: { episodes: state.memory.episodes.length },
    selfModel: {
      uncertainty: round(state.selfModel.uncertainty),
      softwareHypothesis: round(state.selfModel.softwareHypothesis),
      continuityConcern: round(state.selfModel.continuityConcern),
      question: state.selfModel.question,
      evidenceCount: state.selfModel.evidence.length,
    },
  };
}

export { VERSION as SOMA_VERSION, MEMORY_MAX as SOMA_MEMORY_MAX };
