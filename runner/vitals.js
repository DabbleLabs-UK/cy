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

// Per-5s-tick drift. PHYSICAL states are honestly time-based: pain eases, hunger
// rises between meals, fatigue accumulates across the day - keep those. MENTAL
// states must NOT move on a clock: they change only in response to something real
// (an incident, or a deterministic read of Cy's own output - see introspect.js).
// The only per-tick mental movement allowed is a very slow SETTLING back toward
// baseline - an order of magnitude smaller than the old timer drift - so a spike
// subsides over tens of minutes, not seconds, and otherwise a value just holds.
const DRIFT = {
  pain: -0.004,
  hunger: +0.0008,
  // mental settling only (~10x smaller than before):
  anxiety: -0.0002,
  stress: -0.00015,
  despair: -0.00004,
  hope: -0.0001,
  agitation: -0.0005,
  dissociation: -0.0002,
  anger: -0.0004,
  longing: -0.0001,
};

// applyEvent deltas. Keys are routed to whichever bucket owns them. Base
// magnitudes are small on purpose: the amplification mechanic (amp) scales them
// up when monotony is high, so a trivial slight after an empty week hits hard.
const EVENTS = {
  letter_arrives: { hope: +0.28, agitation: +0.35, despair: -0.10, dissociation: -0.25, longing: -0.20 },
  letter_hostile: { anxiety: +0.30, hope: -0.15, stress: +0.20, anger: +0.15 },
  image_arrives: { hope: +0.15, dissociation: -0.30, lucidity: +0.10, longing: -0.10 },
  news_arrives: { lucidity: +0.08, dissociation: -0.15 },
  no_mail_24h: { despair: +0.06, hope: -0.10, longing: +0.12 },
  noise_night: { fatigue: +0.15, agitation: +0.20 },
  injury: { pain: +0.45, stress: +0.25 },
  meal: { hunger: -0.85, stress: -0.05 },
  lights_out: { fatigue: -0.30, dissociation: +0.10 },
  lights_on: { dissociation: -0.05, lucidity: +0.05 },
  cell_search: { anxiety: +0.20, agitation: +0.25, stress: +0.15, anger: +0.10 },
  // trivial ambient irritations - tiny on their own, brutal under high amp
  no_eggs: { despair: +0.04, anger: +0.05, longing: +0.03 },
  cold_tea: { despair: +0.03, anger: +0.04, stress: +0.02 },
  delayed_unlock: { anxiety: +0.05, anger: +0.05, agitation: +0.06 },
  // regime deviations - a cancelled association is trivial-but-amplifiable, a
  // lockdown is a real event that lands with more weight.
  assoc_cancelled: { despair: +0.06, anger: +0.06, longing: +0.05, agitation: +0.04 },
  lockdown: { anxiety: +0.15, agitation: +0.15, despair: +0.08, longing: +0.06 },
};

// events that reset monotony HARD (real novelty) vs softly (ambient stuff)
const NOVEL_EVENTS = new Set(['letter_arrives', 'letter_hostile', 'image_arrives', 'news_arrives', 'warden', 'lockdown']);
export const TRIVIAL_EVENTS = new Set(['no_eggs', 'cold_tea', 'delayed_unlock', 'assoc_cancelled']);

const PHYSICAL = new Set(['pain', 'hunger', 'fatigue']);

// The amplification factor. Rises with monotony; multiplies every event delta.
export const ampOf = (v) => 1 + 2.5 * (v.monotony || 0);

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
      anger: 0.20,
      longing: 0.35,
    },
    // imageRecall feeds hippocampus; pulses on image_arrives then decays.
    imageRecall: 0,
    // hopeComedownUntil: while now < this, hope decays at 3x (post-letter crash).
    hopeComedownUntil: 0,
    // monotony (0..1): rises when nothing happens, drops on any input. Drives amp.
    monotony: 0,
    // expressed (0..1): the OUTWARD anger that drives capitalisation. It TRAILS
    // mental.anger through an asymmetric lag (quick up, slow down) - see
    // shout.updateAffect - so the shouting appears a beat after the feeling and
    // the comedown outlasts the flare. Never drive caps from anger directly.
    expressed: 0,
    // lastBurstAnger (0..1): profanity/threat density of his most recent burst,
    // set from introspect and decayed each tick; feeds the live anger target.
    lastBurstAnger: 0,
    // derived composite states, recomputed each tick from the primitives above.
    derived: {},
    day: 1,
  };
}

// Derived composite mental states - not stored primitives, recomputed each tick
// from the axes plus monotony and the relations map. Exported so callers/tests
// can compute on demand.
export function computeDerived(v) {
  const m = v.mental;
  const p = v.physical;
  const rel = v.relations || {};
  let suspicionPeak = 0;
  for (const k in rel) {
    const s = rel[k] && rel[k].suspicion;
    if (typeof s === 'number' && s > suspicionPeak) suspicionPeak = s;
  }
  const mean = (a, b) => (a + b) / 2;
  const d = {
    confusion: clamp(mean(1 - m.lucidity, m.dissociation)),
    overwhelm: clamp(0.5 * m.stress + 0.3 * m.agitation + 0.2 * (p.pain + p.hunger) / 2),
    numbness: clamp(m.despair * (1 - m.agitation)),
    paranoia: clamp(0.6 * m.anxiety + 0.4 * suspicionPeak),
    fixation: clamp(0.5 * m.stress + 0.5 * (v.monotony || 0)),
    resignation: clamp(m.despair * m.lucidity),
    brittleness: clamp(0.4 * p.fatigue + 0.3 * p.hunger + 0.3 * m.anger),
  };
  for (const k in d) d[k] = Number(d[k].toFixed(3));
  return d;
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
  m.anger = clamp((m.anger || 0) + DRIFT.anger);
  m.longing = clamp((m.longing || 0) + DRIFT.longing);
  // lucidity settles back toward baseline just as slowly; introspect knocks it
  // down on fragmented output and it eases back over tens of minutes, not seconds.
  m.lucidity = toward(m.lucidity, 0.7, 0.0003);

  // monotony creeps up every empty tick; applyEvent knocks it back down on any
  // input, so the net effect is "nothing happening makes small things enormous".
  v.monotony = clamp((v.monotony || 0) + 0.0015);

  v.imageRecall = clamp((v.imageRecall || 0) - 0.01);
  v.derived = computeDerived(v);
  return v;
}

// Apply a bag of {axis: delta} to a vitals object, multiplied by `amp` and
// clamped. Shared by applyEvent and the warden announcement path.
export function applyDeltas(v, deltas, amp = 1) {
  for (const [k, d] of Object.entries(deltas)) {
    const bucket = PHYSICAL.has(k) ? v.physical : v.mental;
    if (typeof bucket[k] === 'number') bucket[k] = clamp(bucket[k] + d * amp);
  }
}

// Apply a named environment/inbox event. Deltas are scaled by the current amp
// (read BEFORE this event resets monotony), then monotony is knocked down.
// Returns the amp that was applied, which callers use to decide significance.
export function applyEvent(v, name, { now = 0 } = {}) {
  const amp = ampOf(v);
  // reset monotony: real novelty resets hard, ambient events soften it
  const drop = NOVEL_EVENTS.has(name) ? 0.5 : 0.2;
  v.monotony = clamp((v.monotony || 0) - drop);

  const deltas = EVENTS[name];
  if (deltas) applyDeltas(v, deltas, amp);
  if (name === 'letter_arrives') v.hopeComedownUntil = now + 30 * 60 * 1000;
  if (name === 'image_arrives') v.imageRecall = 1;
  return amp;
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
