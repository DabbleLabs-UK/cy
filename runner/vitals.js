// vitals.js - the state engine.
//
// A single mutable state object is ticked every 5s and persisted to
// state/vitals.json. Physical and mental scalars are all 0..1. Everything
// derived (heart rate, brain-region activations) is computed on demand from
// that state so persistence stays small and the model of what CY "is"
// stays in one place.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

// Move `cur` toward `target` by at most `step`.
const toward = (cur, target, step) =>
  cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);

// Per-5s-tick drift toward baselines (baseline is 0 unless noted). fatigue and
// lucidity are special-cased in tick().
const DRIFT = {
  pain: -0.004,
  hunger: +0.0008,
  anxiety: -0.002,
  stress: -0.0015,
  despair: -0.0004,
  hope: -0.001,
  agitation: -0.005,
  dissociation: -0.002,
};

// applyEvent deltas. Keys are routed to whichever bucket owns them.
const EVENTS = {
  letter_arrives: { hope: +0.28, agitation: +0.35, despair: -0.10, dissociation: -0.25 },
  letter_hostile: { anxiety: +0.30, hope: -0.15, stress: +0.20 },
  image_arrives: { hope: +0.15, dissociation: -0.30, lucidity: +0.10 },
  news_arrives: { lucidity: +0.08, dissociation: -0.15 },
  no_mail_24h: { despair: +0.06, hope: -0.10 },
  noise_night: { fatigue: +0.15, agitation: +0.20 },
  injury: { pain: +0.45, stress: +0.25 },
  meal: { hunger: -0.85, stress: -0.05 },
  lights_out: { fatigue: -0.30, dissociation: +0.10 },
};

const PHYSICAL = new Set(['pain', 'hunger', 'fatigue']);

export function initialVitals() {
  return {
    physical: { pain: 0.15, hunger: 0.25, fatigue: 0.30 },
    mental: {
      anxiety: 0.35,
      stress: 0.30,
      despair: 0.40,
      hope: 0.30,
      lucidity: 0.65,
      agitation: 0.25,
      dissociation: 0.35,
    },
    // imageRecall feeds hippocampus; pulses on image_arrives then decays.
    imageRecall: 0,
    // hopeComedownUntil: while now < this, hope decays at 3x (post-letter crash).
    hopeComedownUntil: 0,
    day: 1,
  };
}

// Advance one tick. opts: { asleep:boolean, now:ms }.
export function tick(v, { asleep = false, now = 0 } = {}) {
  const p = v.physical;
  const m = v.mental;

  p.pain = clamp(p.pain + DRIFT.pain);
  p.hunger = clamp(p.hunger + DRIFT.hunger);
  p.fatigue = clamp(p.fatigue + (asleep ? -0.004 : 0.0006));

  m.anxiety = clamp(m.anxiety + DRIFT.anxiety);
  m.stress = clamp(m.stress + DRIFT.stress);
  m.despair = clamp(m.despair + DRIFT.despair);

  // COMEDOWN RULE: 30 min after a letter, hope decays 3x fast.
  let hopeDrift = DRIFT.hope;
  if (v.hopeComedownUntil && now < v.hopeComedownUntil) hopeDrift *= 3;
  m.hope = clamp(m.hope + hopeDrift);

  m.agitation = clamp(m.agitation + DRIFT.agitation);
  m.dissociation = clamp(m.dissociation + DRIFT.dissociation);
  m.lucidity = toward(m.lucidity, 0.7, 0.003);

  v.imageRecall = clamp((v.imageRecall || 0) - 0.01);
  return v;
}

// Apply a named environment/inbox event. opts.now used to arm the comedown.
export function applyEvent(v, name, { now = 0 } = {}) {
  const deltas = EVENTS[name];
  if (!deltas) return v;
  for (const [k, d] of Object.entries(deltas)) {
    const bucket = PHYSICAL.has(k) ? v.physical : v.mental;
    if (typeof bucket[k] === 'number') bucket[k] = clamp(bucket[k] + d);
  }
  if (name === 'letter_arrives') v.hopeComedownUntil = now + 30 * 60 * 1000;
  if (name === 'image_arrives') v.imageRecall = 1;
  return v;
}

// Derived heart rate. asleep is coerced 0/1.
export function heartRate(v, asleep = false) {
  const p = v.physical;
  const m = v.mental;
  const a = asleep ? 1 : 0;
  return Math.round(
    clamp(
      62 + 46 * m.agitation + 30 * m.anxiety + 22 * p.pain + 10 * p.hunger - 8 * (p.fatigue * a),
      48,
      150,
    ),
  );
}

// Brain-region activations, all clamped 0..1. broca and v1 are live-signal
// inputs the loop passes in (token rate; whether an image is driving output).
export function brainRegions(v, { broca = 0, v1 = 0, asleep = false } = {}) {
  const p = v.physical;
  const m = v.mental;
  const r = {
    amygdala: 0.2 + 0.7 * m.anxiety + 0.3 * m.agitation,
    acc: 0.25 + 0.6 * m.stress + 0.3 * p.pain,
    insula: 0.2 + 0.6 * p.pain + 0.4 * p.hunger,
    hippocampus: 0.3 + 0.5 * (v.imageRecall || 0) - 0.3 * p.fatigue,
    dlpfc: 0.85 * m.lucidity,
    broca,
    v1,
    locusCoeruleus: 0.2 + 0.8 * m.agitation,
    dmn: 0.3 + 0.6 * m.dissociation,
    thalamus: asleep ? 0.02 : 0.5 + 0.3 * m.lucidity,
  };
  for (const k of Object.keys(r)) r[k] = Number(clamp(r[k]).toFixed(3));
  return r;
}

export async function loadVitals(path) {
  try {
    const raw = await readFile(path, 'utf8');
    const v = JSON.parse(raw);
    // Merge over defaults so a partial/old file still boots.
    const base = initialVitals();
    return {
      ...base,
      ...v,
      physical: { ...base.physical, ...(v.physical || {}) },
      mental: { ...base.mental, ...(v.mental || {}) },
    };
  } catch {
    return initialVitals();
  }
}

export async function saveVitals(path, v) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(v, null, 2));
}
