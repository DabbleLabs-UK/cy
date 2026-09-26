// vitals.js - the state engine.
//
// Every physical/mental default, drift, event delta, derived-state coefficient
// and brain-region weight here is ARBITRARY / HEURISTIC and LEGACY.
// A single mutable state object is ticked every 5s and persisted through the
// sectioned state store under state/vitals-v2/. Physical and mental scalars are
// all 0..1. Everything
// derived (heart rate, old brain-region activations) is computed on demand.
// These scalar mappings are legacy placeholders. Implemented cognition lives
// in the nested `cognition` state managed by soma.js.

import { readFile, mkdir, copyFile, access, open, rename, unlink, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  SECTIONED_STORAGE_FORMAT_VERSION,
  STATE_CHECKPOINT_CONFLICT_CODE,
  SectionedStateStore,
} from './sectioned-state-store.js';

const PERSISTENCE_FORMAT_VERSION = 1;
const DEFAULT_SAVE_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAYS_MS = [100, 500];
const RECOVERY_REFRESH_MS = 60_000;
// The five-second simulation tick is much more frequent than the durability
// requirement for continuously drifting, timestamp-reconciled state. Defer
// routine checkpoints until state has either gone quiet or remained dirty for
// ten minutes. Continuity-critical external events and shutdowns still use
// saveVitals(), which flushes immediately.
const DEFAULT_QUIET_FLUSH_MS = 30_000;
const DEFAULT_MAX_CHECKPOINT_MS = 10 * 60_000;
const RECOVERY_REQUIRED_CODE = 'CY_STATE_RECOVERY_REQUIRED';
const INITIALIZATION_EVIDENCE = new Set([
  'bookkeeping.json',
  'context.jsonl',
  'events.jsonl',
  'power.json',
  'spend.json',
  'queue.json',
  'inbox.json',
  'memory-queue.json',
]);

let tempSequence = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class StateRecoveryRequiredError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StateRecoveryRequiredError';
    this.code = RECOVERY_REQUIRED_CODE;
    this.details = details;
  }
}

export function isStateRecoveryRequired(error) {
  return Boolean(error && error.code === RECOVERY_REQUIRED_CODE);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

export function validateVitalsState(value, { requireFormatVersion = false } = {}) {
  assertObject(value, 'vitals');
  if (requireFormatVersion || value.persistenceFormatVersion !== undefined) {
    if (value.persistenceFormatVersion !== PERSISTENCE_FORMAT_VERSION) {
      throw new Error(`unsupported persistenceFormatVersion ${String(value.persistenceFormatVersion)}`);
    }
  }
  assertObject(value.physical, 'vitals.physical');
  for (const key of ['pain', 'hunger', 'fatigue']) {
    assertFiniteNumber(value.physical[key], `vitals.physical.${key}`);
  }
  assertObject(value.mental, 'vitals.mental');
  for (const key of ['anxiety', 'stress', 'despair', 'hope', 'lucidity', 'agitation', 'dissociation', 'anger', 'longing']) {
    assertFiniteNumber(value.mental[key], `vitals.mental.${key}`);
  }
  assertFiniteNumber(value.day, 'vitals.day');
  if (value.day < 1) throw new Error('vitals.day must be at least 1');
  if (value.cognition !== undefined) assertObject(value.cognition, 'vitals.cognition');
  return true;
}

function validateBookkeeping(value) {
  assertObject(value, 'bookkeeping');
  return true;
}

async function runHook(hooks, phase, details) {
  if (hooks && typeof hooks[phase] === 'function') return hooks[phase](details);
  return undefined;
}

async function atomicWriteText(targetPath, text, validate, { hooks = null } = {}) {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tempPath = join(
    dir,
    `.${basename(targetPath)}.${process.pid}.${Date.now()}.${tempSequence++}.tmp`,
  );
  let handle = null;
  try {
    handle = await open(tempPath, 'wx');
    const override = await runHook(hooks, 'beforeWrite', { targetPath, tempPath, text, handle });
    const writeText = override && typeof override.text === 'string' ? override.text : text;
    await handle.writeFile(writeText, 'utf8');
    await runHook(hooks, 'afterWrite', { targetPath, tempPath, text: writeText, handle });
    await handle.sync();
    await handle.close();
    handle = null;
    await runHook(hooks, 'afterClose', { targetPath, tempPath });

    const candidateText = await readFile(tempPath, 'utf8');
    const candidate = JSON.parse(candidateText);
    validate(candidate);
    await runHook(hooks, 'beforeRename', { targetPath, tempPath, candidate });
    await rename(tempPath, targetPath);
    return Buffer.byteLength(text, 'utf8');
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch { /* best effort */ }
    }
    try { await unlink(tempPath); } catch { /* best effort */ }
    throw error;
  }
}

async function atomicWriteOpaque(targetPath, data) {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tempPath = join(dir, `.vitals-forensic.${process.pid}.${Date.now()}.${tempSequence++}.tmp`);
  let handle = null;
  try {
    handle = await open(tempPath, 'wx');
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, targetPath);
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch { /* best effort */ }
    }
    try { await unlink(tempPath); } catch { /* best effort */ }
    throw error;
  }
}

async function parseValidated(path, validate) {
  const text = await readFile(path, 'utf8');
  const value = JSON.parse(text);
  validate(value);
  return { text, value };
}

export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

// Move `cur` toward `target` by at most `step`.
const toward = (cur, target, step) =>
  cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);

// Per-5s-tick drift. PHYSICAL states are honestly time-based: pain eases, hunger
// rises between meals, fatigue accumulates across the day - keep those. MENTAL
// states must NOT move on a clock: they change only in response to something real.
// The live runner no longer reads generated output back into state.
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
    // Legacy placeholder retained for compatibility with the old affect renderer.
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
    overwhelm: clamp(0.5 * m.stress + 0.3 * m.agitation + 0.1 * p.hunger),
    numbness: clamp(m.despair * (1 - m.agitation)),
    paranoia: clamp(0.6 * m.anxiety + 0.4 * suspicionPeak),
    fixation: clamp(0.5 * m.stress + 0.5 * (v.monotony || 0)),
    resignation: clamp(m.despair * m.lucidity),
    // Legacy fatigue is retained as a diagnostic scalar only.
    brittleness: clamp(0.3 * p.hunger + 0.3 * m.anger),
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
      62 + 46 * m.agitation + 10 * p.hunger,
      48,
      150,
    ),
  );
}

// LEGACY PLACEHOLDER brain-region activations. These are synthetic mappings,
// not physiology and not implemented Soma circuits. broca and v1 include live
// inputs (token rate and image presence), but the anatomical labels remain an
// analogy retained only for compatibility.
export function brainRegions(v, { broca = 0, v1 = 0, asleep = false } = {}) {
  const p = v.physical;
  const m = v.mental;
  const r = {
    amygdala: 0.2 + 0.3 * m.agitation,
    acc: 0.25 + 0.6 * m.stress,
    insula: 0.2 + 0.4 * p.hunger,
    hippocampus: 0.3 + 0.5 * (v.imageRecall || 0),
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

// ---------------------------------------------------------------------------
// LEGACY STORAGE ZONE SPLIT. The single `vitals` grab-bag is split into
// three zones with three lifecycles:
//   - soma        : persisted legacy state plus the nested implemented
//                   `cognition` object. The zone name predates soma.js.
//   - signals     : derived outputs (currently `derived`), recomputed every
//                   tick, read-only downstream, NEVER persisted.
//   - bookkeeping : render/prompt scaffolding. Persisted as its own section in
//                   the coherent V2 checkpoint; never read by a state circuit.
//
// For this build the split is INTERNAL only: loadVitals returns a proxy that
// exposes every old flat path (vitals.mental.anxiety, vitals.derived.numbness,
// vitals.recentOpeners, ...) routed onto the right zone, so not one call site
// has to change. Later steps migrate call sites onto the zones one at a time.
// ---------------------------------------------------------------------------

// Which zone owns each top-level field. Anything not listed defaults to soma,
// so a field we failed to enumerate is still persisted (in soma) rather than
// silently dropped.
const ZONE_OF = new Map([
  // signals - recomputed each tick, not persisted
  ['derived', 'signals'],
  // bookkeeping - render/prompt scaffolding, persisted separately
  ['recentOpeners', 'bookkeeping'],
  ['introspectPrev', 'bookkeeping'],
  ['readEpochMs', 'bookkeeping'],
  ['readCharsSinceEpoch', 'bookkeeping'],
  // everything else is soma (physical, mental, imageRecall, hopeComedownUntil,
  // monotony, expressed, lastBurstAnger, relations, ledger, dreamPool, the
  // last*Ms clocks, dream* dates, day, ...)
]);

const zoneFor = (key) => ZONE_OF.get(key) || 'soma';

// Retrieve the raw zone objects off a proxy (used by saveVitals). Non-string so
// it never collides with a real field name and stays out of enumeration.
const ZONES = Symbol('somaZones');
const LOAD_ISSUE = Symbol('vitalsLoadIssue');
const PERSISTENCE = Symbol('vitalsPersistence');

// Build the flat-facing proxy over the three zone objects. Reads and writes to
// any old flat path route to the owning zone; nested objects (physical, mental,
// derived, relations) are returned by reference so in-place mutation
// (vitals.mental.anxiety = x, vitals.recentOpeners.push(...)) works unchanged.
function makeVitals(soma, signals, bookkeeping, loadIssue = null, persistence = null) {
  const zones = { soma, signals, bookkeeping };
  const flatKeys = () =>
    [...new Set([...Object.keys(soma), ...Object.keys(signals), ...Object.keys(bookkeeping)])];
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === ZONES) return zones;
        if (prop === LOAD_ISSUE) return loadIssue;
        if (prop === PERSISTENCE) return persistence;
        if (typeof prop === 'symbol') return undefined;
        return zones[zoneFor(prop)][prop];
      },
      set(_t, prop, value) {
        if (typeof prop === 'symbol') return false;
        zones[zoneFor(prop)][prop] = value;
        return true;
      },
      has(_t, prop) {
        if (typeof prop === 'symbol') return false;
        return prop in zones[zoneFor(prop)];
      },
      deleteProperty(_t, prop) {
        if (typeof prop === 'symbol') return false;
        delete zones[zoneFor(prop)][prop];
        return true;
      },
      ownKeys() {
        return flatKeys();
      },
      getOwnPropertyDescriptor(_t, prop) {
        if (typeof prop === 'symbol') return undefined;
        const z = zones[zoneFor(prop)];
        if (!(prop in z)) return undefined;
        return { value: z[prop], writable: true, enumerable: true, configurable: true };
      },
    },
  );
}

const fileExists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

async function stateDirectoryHasEvidence(path) {
  try {
    const names = await readdir(dirname(path));
    return names.some((name) => INITIALIZATION_EVIDENCE.has(name));
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

class VitalsPersistence {
  constructor(path, options = {}) {
    this.path = path;
    this.bookPath = join(dirname(path), 'bookkeeping.json');
    this.previousPath = join(dirname(path), 'vitals.previous.json');
    this.markerPath = join(dirname(path), 'vitals.initialized.json');
    this.hooks = options.hooks || null;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.sectioned = new SectionedStateStore(path, { hooks: this.hooks, now: this.now });
    this.maxAttempts = Number.isInteger(options.maxAttempts)
      ? Math.max(1, options.maxAttempts)
      : DEFAULT_SAVE_ATTEMPTS;
    this.retryDelaysMs = Array.isArray(options.retryDelaysMs)
      ? options.retryDelaysMs.map((value) => Math.max(0, Number(value) || 0))
      : DEFAULT_RETRY_DELAYS_MS;
    this.recoveryRefreshMs = Number.isFinite(options.recoveryRefreshMs)
      ? Math.max(0, options.recoveryRefreshMs)
      : RECOVERY_REFRESH_MS;
    this.quietFlushMs = Number.isFinite(options.quietFlushMs)
      ? Math.max(0, options.quietFlushMs)
      : DEFAULT_QUIET_FLUSH_MS;
    this.maxCheckpointMs = Number.isFinite(options.maxCheckpointMs)
      ? Math.max(1, options.maxCheckpointMs)
      : DEFAULT_MAX_CHECKPOINT_MS;
    this.lastCommittedText = null;
    this.lastCommittedBookkeepingText = null;
    this.previousExists = false;
    this.markerExists = false;
    this.pendingJob = null;
    this.deferredJob = null;
    this.deferredTimer = null;
    this.dirtySinceMs = null;
    this.draining = false;
    this.status = {
      persistenceFormatVersion: PERSISTENCE_FORMAT_VERSION,
      storageFormatVersion: SECTIONED_STORAGE_FORMAT_VERSION,
      lastSuccessfulSave: null,
      lastSaveDurationMs: null,
      stateSizeBytes: null,
      lastValidationResult: 'not-yet-saved',
      recoverySnapshotTimestamp: null,
      inProgress: false,
      pending: false,
      coalescedSaveCount: 0,
      deferredSaveCount: 0,
      skippedUnchangedSaveCount: 0,
      stateWriteCount: 0,
      bookkeepingWriteCount: 0,
      sectionWriteCount: 0,
      manifestWriteCount: 0,
      lastChangedSectionCount: 0,
      lastChangedSectionBytes: 0,
      lastManifestSizeBytes: null,
      largestWriteBytes: 0,
      retainedGenerationBytes: null,
      bytesWritten: 0,
      lastSerializationDurationMs: null,
      dirtySince: null,
      nextCheckpointDue: null,
      failedSaveCount: 0,
      lastError: null,
      startupRecoveryUsed: false,
      startupRecoveryReason: null,
      firstInstall: false,
    };
  }

  initialise({ committedText = null, committedBookkeepingText = null, previousExists = false, markerExists = false, recoveryTimestamp = null, firstInstall = false } = {}) {
    // Compare semantic compact JSON, regardless of whitespace used by an older
    // build. The next checkpoint therefore only writes when state actually
    // differs, not merely because the on-disk formatting changed.
    this.lastCommittedText = committedText === null
      ? null
      : JSON.stringify(JSON.parse(committedText));
    this.lastCommittedBookkeepingText = committedBookkeepingText === null
      ? null
      : JSON.stringify(JSON.parse(committedBookkeepingText));
    this.previousExists = previousExists;
    this.markerExists = markerExists;
    this.status.recoverySnapshotTimestamp = recoveryTimestamp;
    this.status.firstInstall = firstInstall;
    if (this.lastCommittedText !== null) {
      this.status.stateSizeBytes = Buffer.byteLength(this.lastCommittedText, 'utf8');
    }
  }

  snapshot() {
    return { ...this.status, pending: Boolean(this.pendingJob || this.deferredJob) };
  }

  markStartupRecovery(reason) {
    this.status.startupRecoveryUsed = true;
    this.status.startupRecoveryReason = reason;
    this.status.lastValidationResult = 'recovered-from-previous-checkpoint';
  }

  serialize(soma, bookkeeping) {
    const started = this.now();
    const persistedSoma = { ...soma, persistenceFormatVersion: PERSISTENCE_FORMAT_VERSION };
    validateVitalsState(persistedSoma, { requireFormatVersion: true });
    validateBookkeeping(bookkeeping);
    const somaText = JSON.stringify(persistedSoma);
    const bookkeepingText = JSON.stringify(bookkeeping);
    this.status.lastSerializationDurationMs = Math.max(0, this.now() - started);
    return { somaText, bookkeepingText };
  }

  requestSave(soma, bookkeeping) {
    const serialized = this.serialize(soma, bookkeeping);
    const scheduled = this.takeDeferredJob();

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      const waiters = [...(scheduled ? scheduled.waiters : []), waiter];
      if (this.pendingJob) {
        this.pendingJob.somaText = serialized.somaText;
        this.pendingJob.bookkeepingText = serialized.bookkeepingText;
        this.pendingJob.waiters.push(...waiters);
        this.status.coalescedSaveCount++;
      } else {
        this.pendingJob = { ...serialized, waiters };
      }
      this.status.pending = true;
      if (!this.draining) void this.drain();
    });
  }

  scheduleSave(soma, bookkeeping) {
    // A new installation or a legacy-format startup must establish both
    // authoritative and recovery V2 manifests before write-behind is allowed.
    if (this.lastCommittedText === null || this.sectioned.currentManifest === null) {
      return this.requestSave(soma, bookkeeping);
    }
    return new Promise((resolve, reject) => {
      const now = this.now();
      const waiter = { resolve, reject };
      if (this.deferredJob) {
        this.deferredJob.soma = soma;
        this.deferredJob.bookkeeping = bookkeeping;
        this.deferredJob.waiters.push(waiter);
        this.status.coalescedSaveCount++;
      } else {
        this.deferredJob = { soma, bookkeeping, waiters: [waiter], lastRequestMs: now };
        this.dirtySinceMs = now;
      }
      this.deferredJob.lastRequestMs = now;
      this.status.deferredSaveCount++;
      this.status.pending = true;
      this.armDeferredTimer();
    });
  }

  armDeferredTimer() {
    if (!this.deferredJob) return;
    if (this.deferredTimer) clearTimeout(this.deferredTimer);
    const now = this.now();
    const quietDue = this.deferredJob.lastRequestMs + this.quietFlushMs;
    const maximumDue = (this.dirtySinceMs ?? now) + this.maxCheckpointMs;
    const due = Math.min(quietDue, maximumDue);
    this.status.dirtySince = new Date(this.dirtySinceMs ?? now).toISOString();
    this.status.nextCheckpointDue = new Date(due).toISOString();
    this.deferredTimer = setTimeout(() => {
      this.deferredTimer = null;
      // Callers hold the waiter promises that receive the failure. Consume the
      // internal timer promise so a failed disk write is not reported twice as
      // an unhandled rejection.
      void this.flushDeferred().catch(() => {});
    }, Math.max(0, due - now));
  }

  takeDeferredJob() {
    if (!this.deferredJob) return null;
    if (this.deferredTimer) clearTimeout(this.deferredTimer);
    this.deferredTimer = null;
    const job = this.deferredJob;
    this.deferredJob = null;
    this.dirtySinceMs = null;
    this.status.dirtySince = null;
    this.status.nextCheckpointDue = null;
    return job;
  }

  async flushDeferred() {
    const scheduled = this.takeDeferredJob();
    if (!scheduled) return this.snapshot();
    let serialized;
    try {
      serialized = this.serialize(scheduled.soma, scheduled.bookkeeping);
    } catch (error) {
      for (const waiter of scheduled.waiters) waiter.reject(error);
      throw error;
    }
    if (this.pendingJob) {
      this.pendingJob.somaText = serialized.somaText;
      this.pendingJob.bookkeepingText = serialized.bookkeepingText;
      this.pendingJob.waiters.push(...scheduled.waiters);
      this.status.coalescedSaveCount++;
    } else {
      this.pendingJob = { ...serialized, waiters: scheduled.waiters };
    }
    this.status.pending = true;
    if (!this.draining) void this.drain();
    return this.snapshot();
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;
    this.status.inProgress = true;
    try {
      while (this.pendingJob) {
        const job = this.pendingJob;
        this.pendingJob = null;
        this.status.pending = false;
        try {
          // Establish recovery/authority metadata even when an imported current
          // file is semantically unchanged.
          const somaChanged = job.somaText !== this.lastCommittedText
            || this.sectioned.currentManifest === null
            || !this.previousExists
            || !this.markerExists;
          const bookkeepingChanged = job.bookkeepingText !== this.lastCommittedBookkeepingText;
          if (!somaChanged && !bookkeepingChanged) {
            this.status.skippedUnchangedSaveCount++;
          } else {
            await this.commitWithRetry({ ...job, somaChanged, bookkeepingChanged });
          }
          for (const waiter of job.waiters) waiter.resolve(this.snapshot());
        } catch (error) {
          for (const waiter of job.waiters) waiter.reject(error);
        }
      }
    } finally {
      this.draining = false;
      this.status.inProgress = false;
      this.status.pending = Boolean(this.pendingJob || this.deferredJob);
      if (this.pendingJob) void this.drain();
    }
  }

  async commitWithRetry(job) {
    let lastError = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        await this.commitOnce(job);
        return;
      } catch (error) {
        lastError = error;
        this.status.lastValidationResult = 'save-failed';
        this.status.lastError = error && error.message ? error.message : String(error);
        if (error && error.code === STATE_CHECKPOINT_CONFLICT_CODE) break;
        if (attempt < this.maxAttempts) {
          const delay = this.retryDelaysMs[Math.min(attempt - 1, this.retryDelaysMs.length - 1)] || 0;
          if (delay > 0) await sleep(delay);
        }
      }
    }
    this.status.failedSaveCount++;
    throw lastError;
  }

  async commitOnce(job) {
    const started = this.now();
    let bytesWritten = 0;
    let stateSizeBytes = this.status.stateSizeBytes;
    if (job.somaChanged || job.bookkeepingChanged) {
      const state = JSON.parse(job.somaText);
      const bookkeeping = JSON.parse(job.bookkeepingText);
      const result = await this.sectioned.commit(state, bookkeeping, {
        validateState: (value) => validateVitalsState(value, { requireFormatVersion: true }),
        validateBookkeeping,
      });
      bytesWritten += result.bytesWritten;
      stateSizeBytes = result.stateSizeBytes;
      this.lastCommittedText = job.somaText;
      this.lastCommittedBookkeepingText = job.bookkeepingText;
      this.previousExists = true;
      this.status.recoverySnapshotTimestamp = new Date(this.now()).toISOString();
      this.status.stateWriteCount++;
      if (job.bookkeepingChanged) this.status.bookkeepingWriteCount++;
      this.status.sectionWriteCount += result.sectionWriteCount;
      this.status.manifestWriteCount += 2;
      this.status.lastChangedSectionCount = result.sectionWriteCount;
      this.status.lastChangedSectionBytes = result.changedSectionBytes;
      this.status.lastManifestSizeBytes = result.manifestSizeBytes;
      this.status.largestWriteBytes = Math.max(this.status.largestWriteBytes, result.largestWriteBytes);
      this.status.retainedGenerationBytes = (await this.sectioned.diskUsage()).bytes;
    }
    if (!this.markerExists) {
      await atomicWriteText(
        this.markerPath,
        JSON.stringify({ persistenceFormatVersion: PERSISTENCE_FORMAT_VERSION, initialisedAt: new Date(this.now()).toISOString() }),
        (value) => {
          assertObject(value, 'initialisation marker');
          if (value.persistenceFormatVersion !== PERSISTENCE_FORMAT_VERSION) throw new Error('invalid initialisation marker');
        },
      );
      this.markerExists = true;
    }

    const completed = this.now();
    this.status.lastSuccessfulSave = new Date(completed).toISOString();
    this.status.lastSaveDurationMs = Math.max(0, completed - started);
    this.status.stateSizeBytes = stateSizeBytes;
    this.status.bytesWritten += bytesWritten;
    this.status.lastValidationResult = 'valid';
    this.status.lastError = null;
    this.status.firstInstall = false;
  }
}

async function recoveryTimestamp(path) {
  try {
    return (await stat(path)).mtime.toISOString();
  } catch {
    return null;
  }
}

async function preserveCorruptState(path) {
  try {
    const bytes = await readFile(path);
    await atomicWriteOpaque(join(dirname(path), 'vitals.corrupt.json'), bytes);
  } catch {
    // Recovery remains fail-safe even when the bounded forensic copy cannot be written.
  }
}

export async function loadVitals(path, options = {}) {
  const bookPath = join(dirname(path), 'bookkeeping.json');
  const persistence = new VitalsPersistence(path, options.persistence || {});
  const previousPath = persistence.previousPath;

  let raw = null;
  let rawText = null;
  let book = null;
  let bookText = null;
  let loadIssue = null;
  let loadedSectioned = false;
  const sectioned = await persistence.sectioned.load({
    validateState: (value) => validateVitalsState(value, { requireFormatVersion: true }),
    validateBookkeeping,
  });
  if (sectioned.state !== null) {
    raw = sectioned.state;
    rawText = JSON.stringify(sectioned.state);
    book = sectioned.bookkeeping;
    bookText = JSON.stringify(sectioned.bookkeeping);
    loadedSectioned = true;
    if (sectioned.source === 'previous') {
      persistence.markStartupRecovery(
        `sectioned current generation was unavailable; ${sectioned.errors.join('; ') || 'previous generation selected'}`,
      );
    }
  } else if (sectioned.evidence) {
    loadIssue = `sectioned state unavailable: ${sectioned.errors.join('; ') || 'no valid manifest'}`;
  }

  const authorityExists = await fileExists(path);
  const previousExists = await fileExists(previousPath);
  const markerExists = await fileExists(persistence.markerPath);

  if (raw === null && authorityExists) {
    try {
      const parsed = await parseValidated(path, (value) => validateVitalsState(value));
      raw = parsed.value;
      rawText = parsed.text;
    } catch (error) {
      const legacyIssue = `persisted vitals failed validation: ${error && error.message ? error.message : 'invalid JSON'}`;
      loadIssue = loadIssue ? `${loadIssue}; ${legacyIssue}` : legacyIssue;
      await preserveCorruptState(path);
    }
  }

  if (raw === null && (authorityExists || previousExists)) {
    try {
      const recovered = await parseValidated(previousPath, (value) => validateVitalsState(value));
      await atomicWriteText(path, recovered.text, (value) => validateVitalsState(value));
      raw = recovered.value;
      rawText = recovered.text;
      persistence.markStartupRecovery(loadIssue || 'authoritative vitals.json was missing');
      loadIssue = null;
    } catch (recoveryError) {
      throw new StateRecoveryRequiredError(
        'Cy state is unavailable: neither vitals.json nor vitals.previous.json is valid; no defaults were loaded',
        {
          authorityExists,
          previousExists,
          authorityError: loadIssue,
          sectionedEvidence: sectioned.evidence,
          sectionedErrors: sectioned.errors,
          recoveryError: recoveryError && recoveryError.message ? recoveryError.message : String(recoveryError),
        },
      );
    }
  }

  let firstInstall = false;
  if (raw === null) {
    if (sectioned.evidence || markerExists || await stateDirectoryHasEvidence(path)) {
      throw new StateRecoveryRequiredError(
        'Cy state is missing from an existing installation; refusing to create defaults over prior history',
        {
          authorityExists: false,
          previousExists: false,
          markerExists,
          sectionedEvidence: sectioned.evidence,
          sectionedErrors: sectioned.errors,
        },
      );
    }
    firstInstall = true;
  }

  if (!loadedSectioned) {
    try {
      bookText = await readFile(bookPath, 'utf8');
      book = JSON.parse(bookText);
    } catch {
      book = null;
      bookText = null;
    }
  }

  // One-time backup of an older pre-split monolithic state file. Detected by
  // the presence of a field that moved zone or stopped being persisted;
  // guarded so the migration backup is created exactly once.
  if (!loadedSectioned && raw && ('derived' in raw || 'recentOpeners' in raw || 'introspectPrev' in raw)) {
    const bak = path + '.pre-soma.bak';
    if (!(await fileExists(bak))) {
      try {
        await copyFile(path, bak);
      } catch {
        /* best-effort backup; never block boot on it */
      }
    }
  }

  // Merge the old flat file over defaults, exactly as before, so a partial/old
  // file still boots with every default filled in.
  const base = initialVitals();
  const merged = raw
    ? {
        ...base,
        ...raw,
        physical: { ...base.physical, ...(raw.physical || {}) },
        mental: { ...base.mental, ...(raw.mental || {}) },
      }
    : base;

  // Split the merged flat object into zones by ownership.
  const soma = {};
  const signals = {};
  const bookkeeping = {};
  const zones = { soma, signals, bookkeeping };
  for (const [k, v] of Object.entries(merged)) {
    zones[zoneFor(k)][k] = v;
  }
  // Sectioned bookkeeping is authoritative when V2 loaded. During legacy
  // migration, a dedicated bookkeeping.json remains authoritative over fields
  // carried by an old vitals.json.
  if (book && typeof book === 'object') Object.assign(bookkeeping, book);

  // `derived` is a signal: recomputable, never authoritative on disk. When we
  // booted from a persisted file, reconstruct it from the loaded soma so it is
  // present for the first burst just as the old persisted snapshot was. This is
  // deterministic, so it reproduces that snapshot exactly on a migration boot
  // (empty before/after diff) and fills it in on later soma-only boots, where
  // `derived` is no longer written to disk. A fresh boot with no file keeps the
  // initialVitals default ({}) until the first tick, matching the old code.
  if (raw !== null) signals.derived = computeDerived(soma);

  persistence.initialise({
    committedText: rawText,
    committedBookkeepingText: bookText,
    previousExists: loadedSectioned
      ? await fileExists(persistence.sectioned.paths.previousManifest)
      : previousExists,
    markerExists,
    recoveryTimestamp: await recoveryTimestamp(
      loadedSectioned ? persistence.sectioned.paths.previousManifest : previousPath,
    ),
    firstInstall,
  });
  return makeVitals(soma, signals, bookkeeping, loadIssue, persistence);
}

export function vitalsLoadIssue(v) {
  return v && v[LOAD_ISSUE] ? String(v[LOAD_ISSUE]) : null;
}

export function vitalsPersistenceStatus(v) {
  const persistence = v && v[PERSISTENCE];
  return persistence ? persistence.snapshot() : null;
}

export async function saveVitals(path, v) {
  const zones = v && v[ZONES];
  const persistence = v && v[PERSISTENCE];
  if (!zones || !persistence) throw new Error('saveVitals requires state returned by loadVitals');
  return persistence.requestSave(zones.soma, zones.bookkeeping);
}

// Routine five-second ticks call this write-behind path. It keeps only the
// newest in-memory state, resets a short quiet-period timer, and enforces a hard
// maximum checkpoint age. Call saveVitals() for continuity-critical events and
// shutdown.
export function scheduleVitalsSave(path, v) {
  const zones = v && v[ZONES];
  const persistence = v && v[PERSISTENCE];
  if (!zones || !persistence) throw new Error('scheduleVitalsSave requires state returned by loadVitals');
  return persistence.scheduleSave(zones.soma, zones.bookkeeping);
}
