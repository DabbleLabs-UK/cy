// run.js - the main loop.
//
// Continuously drives inmate 7734: streams tokens from ollama, screens them
// through the warden, batches everything to the API (or state/events.jsonl in
// dryRun), and modulates voice + sampling from a vitals state engine ticked
// every 5s. A deterministic (non-LLM) scheduler fires ambient prison events on
// a Europe/London clock; inbound letters interrupt the stream mid-word.
//
//   node runner/run.js            # uses runner/config.json (falls back to sample)
//
// SIGINT flushes the batch queue and persists vitals before exiting.

import os from 'node:os';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  initialVitals,
  loadVitals,
  saveVitals,
  tick,
  applyEvent,
  applyDeltas,
  ampOf,
  heartRate,
  brainRegions,
  clamp,
  TRIVIAL_EVENTS,
} from './vitals.js';
import {
  ZONE_A,
  buildDirectives,
  buildPrompt,
  options,
  letterPredict,
  amplifiedDirective,
  styleDirective,
  pickForm,
  bansDirective,
  wingnoiseDirective,
  applyBurstSeparator,
  NUM_CTX,
  isSleepWindow,
  shapeMurmur,
  dreamMaterial,
  dreamMurmurGapMs,
} from './prompt.js';
import {
  parseStrokes,
  splitPasses,
  moodSnapshot,
  drawDecision,
  detectDrawRequest,
  resolveRequest,
  subjectFromLine,
  drawIntentDirective,
  drawDslSystem,
  drawDslPrompt,
  dreamDrawing,
  dreamStrokeGapMs,
  isSmallHours,
  pickDreamStartMin,
} from './draw.js';
import { introspect } from './introspect.js';
import {
  reconcileLedger,
  makeIncident,
  pushIncident,
  incidentsDirective,
  incidentLine,
  resolveThreads,
} from './incidents.js';
import {
  reconcileRelations,
  pickSocial,
  applySocialEvent,
  castForPrompt,
  grudgeDirective,
  pickOfficer,
  applyOfficerEvent,
  officerDirective,
  pickOverheard,
  overheardDirective,
  mishearChance,
  visitorForPrompt,
  visitorNoteLine,
  mergeVisitorNotes,
  updateVisitorStanding,
  isOfficer,
  BY_KEY,
  CAST,
} from './cast.js';
import { PowerMeter, costInjection } from './power.js';
import { createWarden, sanitize, stripScaffold, isRepeat, repeatsWithinBurst } from './warden.js';
import { Client, tsNow } from './client.js';
import { tempoIdleMs } from './tempo.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(HERE, 'state');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- config ---------------------------------------------------------------

async function loadConfig() {
  for (const name of ['config.json', 'config.sample.json']) {
    try {
      const raw = await readFile(join(HERE, name), 'utf8');
      const cfg = JSON.parse(raw);
      if (name === 'config.sample.json') {
        console.warn('[cy] no config.json - running from config.sample.json');
      }
      return cfg;
    } catch {
      /* try next */
    }
  }
  throw new Error('no config.json or config.sample.json in runner/');
}

// ---- Europe/London clock helpers ------------------------------------------

const londonFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function londonParts(d = new Date()) {
  const p = Object.fromEntries(londonFmt.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = +p.hour % 24; // 'en-GB' can render midnight as 24
  const minute = +p.minute;
  return { date: `${p.year}-${p.month}-${p.day}`, hour, minute, mins: hour * 60 + minute };
}

// asleep between lights_out (22:30) and lights_on (06:30). The predicate lives in
// prompt.js so the loop and the dream tests read the window from one place.
const isAsleep = isSleepWindow;

const SCHEDULE = [
  { name: 'lights_on', mins: 6 * 60 + 30 },
  { name: 'meal', mins: 7 * 60 + 30 }, // slop
  { name: 'meal', mins: 11 * 60 + 45 }, // lunch
  { name: 'meal', mins: 16 * 60 + 45 }, // tea
  { name: 'lights_out', mins: 22 * 60 + 30 },
];

// THE REGIME - the shape of a British prison day. The current phase is put in
// every waking prompt so the day has structure; some transitions can DEVIATE
// (late unlock, cancelled association, a lockdown), and a deviation is itself an
// incident, amplified by the monotony multiplier so a 20-minute late unlock in a
// dead week becomes the event of the day.
const REGIME = [
  { mins: 6 * 60 + 30, phase: 'lights_on', label: 'lights on. the strip light. awake whether you want to be or not.' },
  { mins: 7 * 60 + 30, phase: 'unlock_slop', label: 'unlock and slop. doors off, breakfast such as it is.' },
  { mins: 8 * 60 + 30, phase: 'work_assoc', label: 'work or association. out of the cell, among them.' },
  { mins: 11 * 60 + 45, phase: 'lunch_bangup', label: 'lunch and bang-up. fed and locked back in.' },
  { mins: 13 * 60 + 30, phase: 'exercise_yard', label: 'unlock again, exercise or the yard.' },
  { mins: 16 * 60 + 45, phase: 'tea', label: 'tea. the last hot thing of the day.' },
  { mins: 17 * 60 + 30, phase: 'bangup_night', label: 'banged up for the night. that is you til morning.' },
  { mins: 22 * 60 + 30, phase: 'lights_out', label: 'lights out.' },
];

// The regime block in force at minutes-of-day `mins` (wraps: before 06:30 it is
// still last night's lights_out).
function currentRegime(mins) {
  let cur = REGIME[REGIME.length - 1];
  for (const r of REGIME) if (mins >= r.mins) cur = r;
  return cur;
}

function regimeDirective(mins) {
  const r = currentRegime(mins);
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return `REGIME ${hh}:${mm}: ${r.label}`;
}

// Is any standing charged enough that the volatile cast block earns its chars?
// The fixed roster (names + blurbs) always sits in cached Zone A, so at true
// baseline the Zone C standing block adds nothing the model does not already
// have. Only surface it once a feud/warmth has actually moved past the start
// values - conditional inclusion, the single biggest saving in the calm case.
function castCharged(relations) {
  for (const k in relations || {}) {
    const r = relations[k];
    if (!r) continue;
    if ((r.grudge || 0) >= 0.35 || (r.suspicion || 0) >= 0.7 || (r.warmth || 0) >= 0.6 || (r.warmth || 0) <= 0.05) {
      return true;
    }
  }
  return false;
}

// Regime transitions that can go wrong, and the deviation each throws. Checked
// when the day crosses that boundary.
const DEVIATIONS = {
  unlock_slop: { chance: 0.22, sub: 'late_unlock', event: 'delayed_unlock' },
  exercise_yard: { chance: 0.22, sub: 'late_unlock', event: 'delayed_unlock' },
  work_assoc: { chance: 0.15, sub: 'assoc_cancelled', event: 'assoc_cancelled' },
};

// did we cross `target` going from prev -> cur minutes-of-day (handles midnight)?
function crossed(target, cur, prev) {
  if (prev === null) return false;
  if (prev <= cur) return prev < target && target <= cur;
  return target > prev || target <= cur; // wrapped past midnight
}

// ---- host metrics ---------------------------------------------------------

function cpuSnapshot() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const t in c.times) total += c.times[t];
    idle += c.times.idle;
  }
  return { idle, total };
}

// ---- letter classification ------------------------------------------------

const HOSTILE = /\b(rot|die|deserve|scum|hate you|worthless|nonce|freak|monster|disgusting|filth|burn|evil|scumbag|waste of)\b/i;
const isHostile = (body) => HOSTILE.test(body || '');

const WARM = /\b(love|miss you|thinking of you|proud|hope you|stay strong|here for you|care|dear|hang in|take care|god bless|xx)\b/i;
const isWarm = (body) => WARM.test(body || '');

// ---- silence: real gaps where nothing is written --------------------------
//
// Probability of stopping rises with despair, numbness, resignation and sleep,
// and falls with agitation and just after a fresh incident (something concrete
// pulls him back to the page). Awake silences run ~20s to ~4min; asleep, much
// longer. Returns { silent, seconds, reason }.
function silenceDecision(v, asleep, sinceIncidentMs, rnd = Math.random) {
  const m = v.mental || {};
  const p = v.physical || {};
  const d = v.derived || {};
  let prob = 0.05 + 0.32 * (m.despair || 0) + 0.28 * (d.numbness || 0) + 0.22 * (d.resignation || 0);
  if (asleep) prob += 0.42;
  prob -= 0.4 * (m.agitation || 0);
  if (sinceIncidentMs < 30000) prob -= 0.5; // a fresh incident pulls him back
  prob = clamp(prob, asleep ? 0.05 : 0.02, asleep ? 0.9 : 0.55);
  if (rnd() >= prob) return { silent: false };
  const heavy = clamp(0.4 + 0.6 * (((m.despair || 0) + (d.resignation || 0)) / 2));
  const seconds = asleep
    ? 60 + Math.floor(rnd() * 300) + Math.floor(heavy * 180) // 60..~540s
    : 20 + Math.floor(rnd() * 90) + Math.floor(heavy * 120); // 20..~230s
  const reason = asleep
    ? 'under'
    : (d.numbness || 0) > 0.55
      ? 'numb'
      : (m.despair || 0) > 0.6
        ? 'nothing to write'
        : (p.fatigue || 0) > 0.7
          ? 'too tired'
          : 'staring at the wall';
  return { silent: true, seconds, reason };
}

// First word of a generation, lowercased, for the opener ban ring.
function firstWord(text) {
  const m = String(text || '').trim().match(/[A-Za-z0-9']+/);
  return m ? m[0].toLowerCase() : '';
}

// ---------------------------------------------------------------------------

async function main() {
  const config = await loadConfig();
  const vitalsPath = join(STATE_DIR, 'vitals.json');
  const contextPath = join(STATE_DIR, 'context.jsonl');
  const blockedLogPath = join(STATE_DIR, 'blocked.log');

  const vitals = await loadVitals(vitalsPath);
  if (!vitals.lastMailMs) vitals.lastMailMs = Date.now();
  if (typeof vitals.monotony !== 'number') vitals.monotony = 0;
  // the cast + grudge map lives on the vitals object so it persists with state
  vitals.relations = reconcileRelations(vitals.relations);
  // the incident ledger, last-openers ring and last-incident clock ride on the
  // vitals object too, so they persist with state.
  vitals.ledger = reconcileLedger(vitals.ledger);
  if (!Array.isArray(vitals.recentOpeners)) vitals.recentOpeners = [];
  if (typeof vitals.lastIncidentMs !== 'number') vitals.lastIncidentMs = 0;
  if (typeof vitals.lastWingNoiseMs !== 'number') vitals.lastWingNoiseMs = 0;
  // drawing state (rides on the vitals object so it persists with everything else)
  if (typeof vitals.lastDrawMs !== 'number') vitals.lastDrawMs = 0;
  if (typeof vitals.lastImageMs !== 'number') vitals.lastImageMs = 0;
  if (typeof vitals.lastDrawSubject !== 'string') vitals.lastDrawSubject = '';
  // DREAM state (persists with everything else). dreamPool holds the memory
  // material dreams recombine (postcard images/captions + news headlines, decayed
  // by recency and scaled by significance); the date fields cap the night's one
  // slow drawing to a single occurrence.
  if (!Array.isArray(vitals.dreamPool)) vitals.dreamPool = [];
  if (typeof vitals.dreamDrawDate !== 'string') vitals.dreamDrawDate = '';
  if (typeof vitals.dreamPlanDate !== 'string') vitals.dreamPlanDate = '';
  if (typeof vitals.dreamStartMin !== 'number') vitals.dreamStartMin = 0;

  const warden = createWarden(config, blockedLogPath);
  const client = new Client(config, STATE_DIR);
  const emit = (ev) => client.enqueue(ev);

  // ---- electricity meter ----
  const powerMeter = new PowerMeter(config, join(STATE_DIR, 'power.json'));
  await powerMeter.load();

  // ---- viewer-driven tempo ----
  // When the polled tempo changes, mirror it into the public stream as a `tempo`
  // event so the viewer can display speed, viewer count and the cost of watching
  // live. The pence/hour anchors are derived from the power model here (the web
  // side does not know the watts model): with the duty cycle, average draw is
  // idle + (speed/100)*(load-idle), so pence/hour is linear in speed between
  // pph_idle (speed->0) and pph_load (speed=100). The viewer interpolates.
  client.onTempo = (t) => {
    const pph = (w) => (w / 1000) * powerMeter.tariff * 100;
    emit({
      kind: 'tempo',
      payload: {
        speed: t.speed,
        viewers: t.viewers,
        custom: t.custom,
        pph_idle: Number(pph(powerMeter.idleWatts).toFixed(3)),
        pph_load: Number(pph(powerMeter.loadWatts).toFixed(3)),
      },
    });
  };
  let lastPound = Math.floor(powerMeter.costTotal); // for whole-pound crossings
  let forceCost = false; // set true on a pound crossing, consumed by next gen
  let genCount = 0;
  const COST_EVERY = config.costInjectEvery || 40; // inject roughly every Nth gen
  // optional debug: mirror each built system prompt to state/prompts.log
  const logPrompts = !!config.logPrompts;
  async function logPrompt(mode, system) {
    if (!logPrompts) return;
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'prompts.log'), `\n===== ${mode} @ ${tsNow()} =====\n${system}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }

  // A trivial event that fired under high amp becomes the day's defining thing.
  // Consumed by the next generation, then cleared.
  let amplifiedCue = null; // { label, until }
  const TRIVIAL_LABELS = {
    no_eggs: 'no eggs on the tray this morning',
    cold_tea: 'the tea came cold',
    delayed_unlock: 'unlock came late, no reason given',
    assoc_cancelled: 'association cancelled, banged up through it',
  };

  // Build one incident and file it: stamp the time, push onto the rolling
  // ledger, and reset the "fresh incident" clock the silence engine reads.
  function recordIncident(kind, ctx = {}) {
    const inc = makeIncident(kind, { relations: vitals.relations, ...ctx });
    inc.ts = tsNow();
    pushIncident(vitals.ledger, inc);
    vitals.lastIncidentMs = Date.now();
    return inc;
  }

  // Capture a piece of memory into the dream pool: a postcard image/caption or a
  // news headline. `sig` (0..1, from the amplification the event landed under) is
  // stored so significant material weighs heavier in dreams; the timestamp lets
  // recency decay it. Capped so the pool stays small and recent.
  function pushDreamMemory(kind, text, sig) {
    const t = (text || '').toString().trim();
    if (!t) return;
    vitals.dreamPool.push({ kind, text: t.slice(0, 120), sig: clamp(typeof sig === 'number' ? sig : 0.5), ts: Date.now() });
    while (vitals.dreamPool.length > 24) vitals.dreamPool.shift();
  }

  // Assemble the weighted candidate pool a dream recombines: recent images/
  // headlines (significance * recency decay), older incidents from the ledger,
  // and the cast (whoever is charged rises). Weight folds significance and
  // recency exactly as the image significance/decay weighting does.
  function buildDreamPool() {
    const now = Date.now();
    const out = [];
    for (const it of vitals.dreamPool || []) {
      const ageH = (now - (it.ts || now)) / 3600000;
      const decay = Math.max(0.1, 1 - ageH / 72); // ~3-day fade
      const w = (typeof it.sig === 'number' ? it.sig : 0.5) * decay;
      if (w > 0.02) out.push({ kind: it.kind, text: it.text, weight: Number(w.toFixed(3)) });
    }
    const led = Array.isArray(vitals.ledger) ? vitals.ledger : [];
    led.forEach((inc, i) => {
      const text = incidentLine(inc);
      if (!text) return;
      const recency = led.length ? (i + 1) / led.length : 0.5; // newer -> heavier
      out.push({ kind: 'incident', text, weight: Number((0.3 + 0.3 * recency).toFixed(3)) });
    });
    for (const c of CAST) {
      const r = (vitals.relations || {})[c.key] || {};
      const charge = (r.grudge || 0) + (r.warmth || 0) * 0.5 + (r.suspicion || 0) * 0.4;
      out.push({ kind: 'person', text: c.name, weight: Number((0.25 + charge).toFixed(3)) });
    }
    return out;
  }

  // ZONE B: the model's own CLEANED output, fed back in. Only scaffold-free prose
  // ever lands here (see onChunk), so the model never re-reads its own instruction
  // frames and echoes them. APPEND-ONLY: it grows at the END every burst and is
  // NEVER re-sliced from the front per burst, so the KV-cache prefix (Zone A +
  // this) stays stable and keeps GROWING. Only when it crosses CONTEXT_HARD is it
  // trimmed - in one large chunk back to CONTEXT_SOFT - so the cache is broken
  // rarely (every ~6 bursts) instead of every single burst.
  const CONTEXT_SOFT = 3000;
  const CONTEXT_HARD = 4600;
  let contextBuf = await loadContext(contextPath);
  if (contextBuf.length > CONTEXT_HARD) contextBuf = contextBuf.slice(-CONTEXT_SOFT);
  const contextText = () => contextBuf;
  async function appendContext(chunk) {
    contextBuf += chunk;
    if (contextBuf.length > CONTEXT_HARD) contextBuf = contextBuf.slice(-CONTEXT_SOFT); // rare, large trim
    await saveContext(contextPath, contextBuf);
  }
  // Shrink the effective context tail (on a near-repeat, to jolt the model off
  // the passage it keeps copying) - a deliberate, one-off cache break.
  function trimContext(frac) {
    const keep = Math.max(0, contextBuf.length - Math.floor(contextBuf.length * frac));
    contextBuf = keep > 0 ? contextBuf.slice(-keep) : '';
  }
  // Discards go to state/run.out.log so the loop is observable in the detached
  // process; console too, for a foreground run.
  async function logDiscard(mode, text, n) {
    const snippet = (text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const line = `[cy] discard#${n} (${mode}) near-repeat, retry: "${snippet}"`;
    console.warn(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }
  // The introspect deltas, logged so the state->text link is observable: a mental
  // move that lands here is attributable to a specific feature of what he wrote.
  async function logIntrospect(ins) {
    const sig = (ins && ins.signals) || [];
    if (!sig.length) return;
    const line = `[cy] introspect: ${sig.join(' | ')}`;
    console.log(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }
  // Read Cy's just-finished burst and let his own text move the mental state
  // (never a clock). Deltas apply WITHOUT amplification - a burst nudges, it does
  // not swing - and relations nudges harden/soften standing toward whoever he
  // named in a threatening or a kindly breath.
  async function applyIntrospection(text) {
    const ins = introspect(text, { prev: vitals.introspectPrev || '' });
    vitals.introspectPrev = String(text || '').slice(-1200);
    if (!ins) return;
    applyDeltas(vitals, ins.deltas || {}, 1);
    for (const [k, d] of Object.entries(ins.rel || {})) {
      const r = vitals.relations[k];
      if (!r) continue;
      if (typeof d.suspicion === 'number') r.suspicion = clamp(r.suspicion + d.suspicion);
      if (typeof d.warmth === 'number') r.warmth = clamp(r.warmth + d.warmth);
    }
    await logIntrospect(ins);
  }

  // ---- generation telemetry: emit a `gen` event after a completed burst ----
  // Folds ollama's per-generation counters (prompt_eval_count, eval_count and the
  // nanosecond durations) into interpretable numbers, plus the live runner state
  // the diagnostics readout needs (duty cycle, poll health, model/threads/ctx).
  // Guards on stats so an aborted/errored generation with no `done` line is a
  // no-op rather than a run of dashes.
  // `detail` (optional) carries the per-burst material the RAW debugging view
  // renders: the three prompt zones (A fixed voice, B fed-back context, C volatile
  // directives), the sampling options actually sent to ollama, the full post-warden
  // output as one block, and the mode/form/style directives that shaped it. It is
  // POST-WARDEN and prompt text is fine to publish (the repo is public). Absent for
  // paths that do not assemble it - the RAW view simply shows less for those bursts.
  function emitGen(r, mode, detail = {}) {
    const s = r && r.stats;
    if (!s) return;
    const ns = (x) => (typeof x === 'number' && x > 0 ? x : 0);
    const promptTokS = ns(s.prompt_eval_duration)
      ? (s.prompt_eval_count || 0) / (s.prompt_eval_duration / 1e9)
      : 0;
    const genTokS = ns(s.eval_duration) ? (s.eval_count || 0) / (s.eval_duration / 1e9) : 0;
    const o = detail.opts || {};
    emit({
      kind: 'gen',
      payload: {
        tokens_in: s.prompt_eval_count || 0,
        tokens_out: s.eval_count || 0,
        prompt_tok_s: Number(promptTokS.toFixed(1)),
        gen_tok_s: Number(genTokS.toFixed(2)),
        ttft_ms: r.ttftMs != null ? Math.round(r.ttftMs) : null,
        total_ms: ns(s.total_duration) ? Math.round(s.total_duration / 1e6) : null,
        load_ms: ns(s.load_duration) ? Math.round(s.load_duration / 1e6) : null,
        mode,
        ctx_chars: contextBuf.length,
        duty: client.tempo.speed,
        threads: config.threads,
        model: config.model,
        num_ctx: NUM_CTX,
        inbox_ok: client.lastInboxOk,
        tempo_ok: client.lastTempoOk,
        last_error: client.lastError || null,
        // ---- RAW debugging view: the prompt that produced this burst ----
        zone_a: detail.zoneA != null ? String(detail.zoneA) : null,
        zone_b: detail.zoneB != null ? String(detail.zoneB) : null,
        zone_c: detail.zoneC != null ? String(detail.zoneC) : null,
        // the full generated output for this burst, post-warden, as one block
        output: detail.output != null ? String(detail.output) : (r.full || null),
        // the active form and which style directives fired, for the burst detail
        form: detail.form != null ? String(detail.form) : null,
        styles: detail.styles != null ? String(detail.styles) : null,
        // sampling actually sent to ollama
        temperature: typeof o.temperature === 'number' ? o.temperature : null,
        top_p: typeof o.top_p === 'number' ? o.top_p : null,
        repeat_penalty: typeof o.repeat_penalty === 'number' ? o.repeat_penalty : null,
        num_predict: typeof o.num_predict === 'number' ? o.num_predict : null,
      },
    });
  }

  // ---- shared loop state ----
  let running = true;
  let currentMode = 'journal';
  let currentAbort = null; // AbortController for the in-flight generation
  let tokenCount = 0; // tokens this vitals-tick window (broca)
  const pendingPostcards = [];
  const pendingWarden = [];
  const pendingDrawRequests = []; // postcards that asked him to draw something
  // ambient cues armed by the scheduler, consumed once by the next generation
  let officerCue = null; // { key, ev, until }
  let overheardCue = null; // { item, misheard, until }
  let wingNoiseCue = null; // { line, mid, wake, until } - wing noise, texture only
  // whether the burst currently being built carried a wing noise, and the last
  // two bursts' answer: if both had one, the next noise is suppressed (no drumbeat)
  let noiseThisBurst = false;
  let recentNoise = [false, false];
  let prevMins = null;
  let prevDate = londonParts().date;
  let prevCpu = cpuSnapshot();

  // ---- honest per-process attribution (ollama + this runner node) ------------
  // Whole-machine cpu/mem (os.*) includes unrelated work, so it is misleading to
  // call it "Cy". We ALSO attribute honestly: the only thing that is Cy is the
  // ollama model process plus this runner's own Node process. ollama figures come
  // from an occasional powershell probe (Windows) that runs detached and lands on
  // cyProc for a LATER host tick - it never blocks the generation loop. The
  // runner's own RSS is read in-process. cpu% is normalised to 0-100 across all
  // logical cores, matching the system reading, by deltaing cumulative CPU-seconds.
  const NCPU = Math.max(1, os.cpus().length);
  const cyProc = { ollamaCpu: null, ollamaMB: null, ollamaProcs: null };
  let prevOllamaCpuSec = null;
  let prevOllamaProbeMs = null;
  let probingOllama = false;
  function probeOllama() {
    if (process.platform !== 'win32') return; // Windows-only probe; leave nulls elsewhere
    if (probingOllama) return; // never overlap probes
    probingOllama = true;
    // Sum CPU-seconds and working set over every ollama process; emit "cpu|ws|n".
    const script =
      '$p=Get-Process ollama -ErrorAction SilentlyContinue;' +
      'if($p){$c=($p|Measure-Object CPU -Sum).Sum;$w=($p|Measure-Object WorkingSet64 -Sum).Sum;$n=($p|Measure-Object).Count}' +
      'else{$c=0;$w=0;$n=0};' +
      "Write-Output ('{0}|{1}|{2}' -f $c,$w,$n)";
    let child;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
      });
    } catch {
      probingOllama = false;
      return;
    }
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', () => {
      probingOllama = false;
    });
    child.on('close', () => {
      probingOllama = false;
      const parts = out.trim().split('|');
      if (parts.length < 3) return;
      const cpuSec = Number(parts[0]); // cumulative CPU-seconds across ollama procs
      const ws = Number(parts[1]); // summed working set (bytes)
      const n = Number(parts[2]); // process count
      const nowMs = Date.now();
      if (Number.isFinite(cpuSec) && prevOllamaCpuSec != null && prevOllamaProbeMs != null) {
        const dSec = cpuSec - prevOllamaCpuSec;
        const dWall = (nowMs - prevOllamaProbeMs) / 1000;
        if (dWall > 0 && dSec >= 0) {
          cyProc.ollamaCpu = Number((clamp(dSec / dWall / NCPU) * 100).toFixed(1));
        }
      }
      if (Number.isFinite(cpuSec)) {
        prevOllamaCpuSec = cpuSec;
        prevOllamaProbeMs = nowMs;
      }
      if (Number.isFinite(ws)) cyProc.ollamaMB = Math.round(ws / 1024 / 1024);
      if (Number.isFinite(n)) cyProc.ollamaProcs = n;
    });
  }
  probeOllama(); // prime a baseline now so the first host tick can show a delta

  // Per-burst emit state, reset at the start of every generation (streamGenerate).
  // `burstEmitted` is the text emitted so far in THIS burst, used to catch a burst
  // restating its own phrase; `burstAllowRepeat` exempts the forms that repeat by
  // design (the repeat form, "you repeat yourself", sleep) from that guard.
  let burstEmitted = '';
  let burstAllowRepeat = false;
  let burstStopped = false; // set once the within-burst repeat guard cuts the burst

  // ---- one emitted chunk: screen, then text-event or in-world lost-thought ----
  // THE single choke point every generation path funnels chunks through. Two
  // defensive normalisations live here so no code path can bypass them:
  //   1. BURST BOUNDARY - splice exactly one separator whenever this chunk would
  //      glue onto the already-emitted text with no whitespace between, so two
  //      bursts (or two chunks) can never touch ('...canteen rn' + 'swept...').
  //      The SAME separated chunk goes to both the emitted event and the fed-back
  //      Zone B context (contextBuf), so the stream and the context never drift.
  //   2. WITHIN-BURST REPEAT - if this chunk restates a phrase already emitted in
  //      this same burst, drop it and cut the burst short, so a burst cannot loop
  //      the same line twice ("im finished the thought of ... im finished ...").
  async function onChunk(rawChunk, mode) {
    if (burstStopped) return; // the repeat guard already ended this burst
    let chunk = stripScaffold(sanitize(rawChunk));
    if (!chunk.trim()) return; // was nothing but control tokens / scaffold
    const res = warden.screenOut(chunk);
    if (!res.ok) {
      emit({ kind: 'abort', payload: { cause: 'warden', reason: res.reason } });
      // A redaction marker for the RAW debugging view: category + how many chars
      // were dropped, but NEVER the blocked content itself. This is the only
      // record of a warden drop that reaches any viewer, and it stays post-warden.
      emit({ kind: 'warden', payload: { category: res.reason, chars: chunk.length, mode } });
      await warden.logBlock(res.reason, chunk, tsNow());
      return; // dropped: boundary/repeat state is untouched, carries to next chunk
    }
    // (1) boundary - checked against the full emitted context, applied every chunk
    chunk = applyBurstSeparator(contextBuf, chunk);
    // (2) within-burst repeat - drop the restated chunk and stop the burst here
    if (!burstAllowRepeat && repeatsWithinBurst(chunk, burstEmitted)) {
      burstStopped = true;
      if (currentAbort) currentAbort.abort();
      return;
    }
    emit({ kind: 'text', payload: { s: chunk, mode } });
    burstEmitted += chunk;
    await appendContext(chunk);
  }

  // ---- stream one generation from ollama ----
  // When `contextTail` is given (journal/sleep continuation), the opening of the
  // generation is held back until ~PRIME_CHARS have arrived and checked against
  // the context tail: if it is a verbatim replay, the whole generation is
  // discarded (nothing emitted) and { repeat:true } is returned for the caller
  // to retry. Postcard/warden replies pass no contextTail and stream straight
  // through. Either way every chunk is scaffold-stripped before it is emitted.
  async function streamGenerate({ system, prompt, opts, mode, contextTail, allowRepeat = false }) {
    burstEmitted = ''; // fresh generation: nothing emitted yet this burst
    burstAllowRepeat = allowRepeat; // repeat-by-design forms opt out of the guard
    burstStopped = false;
    const ac = new AbortController();
    currentAbort = ac;
    const buffer = warden.newBuffer();
    const PRIME_CHARS = 100;
    let full = '';
    let head = '';
    let primed = contextTail === undefined; // only continuation mode primes
    let repeat = false;
    // generation telemetry: wall-clock to the first token (ttft), and the final
    // ollama `done` line which carries prompt_eval_count/eval_count/durations.
    const t0 = Date.now();
    let ttftMs = null;
    let stats = null;
    const cleanedFull = () => stripScaffold(sanitize(full));

    // Decide the held opening: discard on replay, otherwise release it.
    const commitHead = async () => {
      primed = true;
      const cleaned = stripScaffold(sanitize(head));
      if (contextTail && cleaned.trim() && isRepeat(cleaned, contextTail)) {
        repeat = true;
        ac.abort();
        return;
      }
      for (const chunk of buffer.push(head)) await onChunk(chunk, mode);
      head = '';
    };

    let res;
    try {
      res = await fetch(`${config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, system, prompt, options: opts, keep_alive: -1, stream: true }),
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return { full: cleanedFull(), aborted: true };
      console.warn('[cy] ollama unreachable:', err.message);
      await sleep(2000);
      return { full, error: true };
    }
    if (!res.ok || !res.body) {
      console.warn('[cy] ollama HTTP', res.status);
      await sleep(1000);
      return { full, error: true };
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let lineBuf = '';
    try {
      outer: for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.slice(0, nl);
          lineBuf = lineBuf.slice(nl + 1);
          if (!line.trim()) continue;
          let obj;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          if (typeof obj.response === 'string' && obj.response.length) {
            if (ttftMs === null) ttftMs = Date.now() - t0; // first token out
            full += obj.response;
            tokenCount++;
            if (!primed) {
              head += obj.response;
              if (head.length >= PRIME_CHARS) {
                await commitHead();
                if (repeat) break outer;
              }
            } else {
              for (const chunk of buffer.push(obj.response)) await onChunk(chunk, mode);
            }
          }
          // the final streamed line carries the timing/counters for the burst
          if (obj.done) stats = obj;
        }
      }
    } catch (err) {
      if (repeat) return { full: cleanedFull(), repeat: true };
      if (ac.signal.aborted) return { full: cleanedFull(), aborted: true };
      console.warn('[cy] stream error:', err.message);
      return { full, error: true };
    } finally {
      if (currentAbort === ac) currentAbort = null;
    }
    if (repeat) return { full: cleanedFull(), repeat: true };
    // generation ended before priming completed (shorter than PRIME_CHARS)
    if (!primed) await commitHead();
    if (repeat) return { full: cleanedFull(), repeat: true };
    // natural end: flush trailing partial thought
    for (const chunk of buffer.flush()) await onChunk(chunk, mode);
    return { full: cleanedFull(), aborted: false, stats, ttftMs };
  }

  // A one-shot, non-streaming generation whose text is NOT emitted chunk by
  // chunk (used for the drawing DSL, which must never reach the pen as prose).
  // Wired to currentAbort so an inbound postcard/notice can cut it short.
  async function rawGenerate({ system, prompt, opts }) {
    const ac = new AbortController();
    currentAbort = ac;
    try {
      const res = await fetch(`${config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, system, prompt, options: opts, keep_alive: -1, stream: false }),
        signal: ac.signal,
      });
      if (!res.ok) return '';
      const j = await res.json();
      return j.response || '';
    } catch {
      return ''; // aborted, unreachable, or bad body - caller treats as no drawing
    } finally {
      if (currentAbort === ac) currentAbort = null;
    }
  }

  // Assemble the contextual prompt injections for a waking generation: the cast
  // standing, any hot grudge, an amplified trivial event, and - on a cadence or a
  // whole-pound crossing - the running electricity cost.
  function buildCtx() {
    genCount++;
    const ctx = {
      grudge: grudgeDirective(vitals.relations),
    };
    // cast standing block only when a relation is actually charged (roster itself
    // is always in Zone A); keeps Zone C small on calm days.
    if (castCharged(vitals.relations)) ctx.cast = castForPrompt(vitals.relations);
    if (amplifiedCue && Date.now() < amplifiedCue.until) {
      ctx.amplified = amplifiedDirective(amplifiedCue.label);
      amplifiedCue = null; // fire once
    }
    if (officerCue && Date.now() < officerCue.until) {
      ctx.officer = officerDirective(officerCue.key, officerCue.ev);
      officerCue = null; // fire once
    }
    if (overheardCue && Date.now() < overheardCue.until) {
      ctx.overheard = overheardDirective(overheardCue.item, overheardCue.misheard);
      overheardCue = null; // fire once
    }
    if (wingNoiseCue && Date.now() < wingNoiseCue.until) {
      ctx.wingnoise = wingnoiseDirective(wingNoiseCue.line, wingNoiseCue.mid, wingNoiseCue.wake);
      wingNoiseCue = null; // fire once
      noiseThisBurst = true;
    }
    const doCost = forceCost || genCount % COST_EVERY === 0;
    if (doCost) {
      ctx.cost = costInjection(powerMeter.snapshot());
      forceCost = false;
    }
    return ctx;
  }

  // ---- postcard mode: interrupt, transition, recognise, reply, remember ----
  async function doPostcard(pc) {
    emit({ kind: 'abort', payload: { cause: 'postcard' } });
    const from = currentMode;
    currentMode = 'letter'; // 'letter' remains the viewer mode label for a reply
    emit({ kind: 'mode', payload: { from, to: 'letter', cause: pc.from_name || 'mail' } });

    const hostile = isHostile(pc.body);
    const warm = isWarm(pc.body);
    const evName = hostile ? 'letter_hostile' : 'letter_arrives';
    fireEvent(evName, { from: pc.from_name || null });
    vitals.lastMailMs = Date.now();
    vitals.noMailFiredMs = 0;
    if (pc.image_path) {
      vitals.lastImageMs = Date.now(); // a picture just came - he may draw off it
      // remember the picture for dreams: its caption/attribution is the material,
      // significance scaled by the amplification the mail landed under.
      const sig = clamp(0.3 + 0.2 * (ampOf(vitals) - 1));
      pushDreamMemory('image', pc.caption || pc.image_attrib || 'a picture through the door', sig);
    }
    // a reply arriving clears the mail-wait / awaiting-reply threads in the ledger
    resolveThreads(vitals.ledger, ['reply', 'message', 'mail']);

    // the public, streamed record of the incoming postcard (no private memory)
    emit({
      kind: 'postcard_in',
      payload: {
        id: pc.id,
        from: pc.from_name || null,
        body: pc.body || null,
        image: pc.image_path || null,
        attrib: pc.image_attrib || null,
        visitor_id: pc.visitor_id || null,
        visit_count: pc.visitor ? pc.visitor.visit_count : null,
      },
    });

    // recognition: fold the visitor into the relations mechanism for this reply
    const visitor = pc.visitor ? { ...pc.visitor, from_name: pc.from_name } : null;
    const ctx = buildCtx();
    const recog = visitorForPrompt(visitor, { now: Date.now() });
    if (recog) ctx.visitor = recog;

    const directives = buildDirectives(vitals, 'letter', ctx);
    const letterTail = contextText();
    const prompt = buildPrompt(letterTail, 'postcard', pc, directives);
    const opts = options(vitals, config.threads, 'letter', { num_predict: letterPredict(pc.body) });
    await logPrompt('postcard', ZONE_A + '\n\n---PROMPT---\n' + prompt);
    const r = await streamGenerate({ system: ZONE_A, prompt, opts, mode: 'letter' });
    emitGen(r, 'letter', {
      zoneA: ZONE_A,
      zoneB: letterTail,
      zoneC: directives,
      form: ctx.form || null,
      styles: styleDirective(vitals),
      opts,
      output: r.full,
    });

    // the public, streamed record of Cy's reply (kept as postcard_out)
    const reply = (r.full || '').trim();
    if (reply) {
      emit({ kind: 'postcard_out', payload: { id: pc.id, reply_to: pc.id, body: reply } });
    }

    // remember them: a cheap compressed note + a standing nudge, written back to
    // the DB via a private visitor_seen event (never enters the public stream).
    if (visitor && visitor.visitor_id) {
      const a = ampOf(vitals);
      const line = visitorNoteLine(pc.body, !!pc.image_path, hostile);
      const notes = mergeVisitorNotes(visitor.notes, line);
      const standing = updateVisitorStanding(visitor, { hostile, warm }, a);
      emit({
        kind: 'visitor_seen',
        payload: { visitor_id: visitor.visitor_id, notes, ...standing },
      });
    }

    emit({ kind: 'mode', payload: { from: 'letter', to: 'journal' } });
    currentMode = 'journal';
  }

  // ---- warden notice: a signed announcement lands with weight and CY reacts ----
  async function doWarden(notice) {
    emit({ kind: 'abort', payload: { cause: 'notice' } });
    const from = currentMode;
    currentMode = 'warden';
    emit({ kind: 'mode', payload: { from, to: 'warden', cause: 'Warden Florian' } });

    // {anxiety+0.2, anger+0.15, lucidity+0.1} times amp, then reset monotony hard
    const a = ampOf(vitals);
    applyDeltas(vitals, { anxiety: +0.2, anger: +0.15, lucidity: +0.1 }, a);
    vitals.monotony = clamp((vitals.monotony || 0) - 0.5);
    emit({ kind: 'event', payload: { name: 'warden', amp: Number(a.toFixed(3)), text: notice.text } });

    const directives = buildDirectives(vitals, 'journal', buildCtx());
    const prompt = buildPrompt(contextText(), 'warden', notice, directives);
    const opts = options(vitals, config.threads, 'journal', { num_predict: letterPredict(notice.text) });
    await logPrompt('warden', ZONE_A + '\n\n---PROMPT---\n' + prompt);
    await streamGenerate({ system: ZONE_A, prompt, opts, mode: 'warden' });

    emit({ kind: 'mode', payload: { from: 'warden', to: 'journal' } });
    currentMode = 'journal';
  }

  // ---- drawing: he picks up the pen and draws instead of writing ----
  //
  // Two stages. First he decides, in ONE line of his own voice, what he is
  // drawing and why - streamed like any other thought, so it lands in the page.
  // Then a second, non-streamed generation produces ONLY the stroke DSL, which
  // is parsed defensively, split into build-up passes, and emitted as `draw`
  // events (one per pass) plus a private `draw_saved` record for the drawings
  // table. Fewer than MIN_STROKES valid strokes and the drawing is discarded -
  // the decision line still stands.
  async function doDraw() {
    const now = Date.now();
    currentMode = 'journal';

    // resolve a queued request, or draw something of his own
    const req = pendingDrawRequests.shift() || null;
    const intent = req ? resolveRequest(req, vitals) : { mode: 'spontaneous', subject: null, requestedBy: null };

    // fixation: he keeps redrawing the same thing
    const fixation = (vitals.derived && vitals.derived.fixation) || 0;
    const redraw = !req && fixation > 0.6 && vitals.lastDrawSubject && Math.random() < 0.6;

    // ---- stage 1: the one-line decision, in voice, streamed to the page ----
    const ctx = buildCtx();
    ctx.bans = bansDirective(vitals.recentOpeners);
    ctx.form = drawIntentDirective(intent, { redrawSubject: redraw ? vitals.lastDrawSubject : null });
    const dir1 = buildDirectives(vitals, 'journal', ctx);
    const p1 = buildPrompt(contextText(), 'journal', null, dir1);
    const o1 = options(vitals, config.threads, 'journal', { num_predict: 40 });
    o1.stop = [...o1.stop, '\n']; // one line only
    await logPrompt('draw-decide', ZONE_A + '\n\n---PROMPT---\n' + p1);
    const r1 = await streamGenerate({ system: ZONE_A, prompt: p1, opts: o1, mode: 'journal' });
    if (r1.aborted) return; // an interrupt landed - let the loop handle it, try drawing again later
    const line = (r1.full || '').trim();

    // what he is actually drawing
    let subject;
    if (intent.mode === 'honour' || intent.mode === 'badly') subject = intent.subject || subjectFromLine(line);
    else if (redraw) subject = vitals.lastDrawSubject;
    else subject = subjectFromLine(line);
    const title = line ? line.slice(0, 100) : subject;

    // ---- stage 2: the DSL, non-streamed, prose stopped hard ----
    const sys2 = drawDslSystem();
    const pr2 = drawDslPrompt(subject, { badly: intent.mode === 'badly' });
    const o2 = {
      temperature: 0.6,
      top_p: 0.9,
      repeat_penalty: 1.12,
      num_predict: 320,
      num_ctx: NUM_CTX,
      num_thread: config.threads,
      stop: ['END', '\nEND', 'END\n'],
    };
    await logPrompt('draw-dsl', sys2 + '\n---\n' + pr2);
    const raw = await rawGenerate({ system: sys2, prompt: pr2, opts: o2 });

    const { strokes } = parseStrokes(raw);
    if (strokes.length < 3) {
      // not enough to be a drawing - discard it; the decision line stands.
      await logDiscard('draw', raw, 0);
      vitals.lastDrawMs = now; // still counts as an attempt so he does not hammer
      return;
    }

    const passes = splitPasses(strokes);
    const mood = moodSnapshot(vitals);
    const id = 'd' + now.toString(36) + Math.floor(Math.random() * 1e5).toString(36);
    const n = passes.length;
    passes.forEach((ps, i) => {
      emit({
        kind: 'draw',
        payload: { id, title, strokes: ps.strokes, pass: { i, n, label: ps.label }, mood },
      });
    });
    // private record for the drawings table (like visitor_seen: consumed by
    // ingest.php, never inserted into the event log or streamed).
    emit({
      kind: 'draw_saved',
      payload: {
        id,
        ts: tsNow(),
        title,
        subject,
        strokes,
        mood,
        stroke_count: strokes.length,
        requested_by: intent.requestedBy || null,
      },
    });

    vitals.lastDrawMs = now;
    vitals.lastDrawSubject = subject;
    vitals.monotony = clamp((vitals.monotony || 0) - 0.15); // drawing is something happening
  }

  // ---- inbox: postcards interrupt; news just colours the state ----
  client.onInbox = (data) => {
    let interrupt = false;
    for (const pc of data.postcards || []) {
      // screen any text; an image-only postcard (no body) is always allowed
      if (pc.body && !warden.screenIn(pc.body).ok) continue; // silent reject
      pendingPostcards.push(pc);
      // a postcard can also ASK him to draw something - queue it (he may honour
      // it, honour it badly, or refuse, decided later against standing + mood).
      if (pc.body) {
        const dr = detectDrawRequest(pc.body);
        if (dr) {
          pendingDrawRequests.push({
            subject: dr.subject,
            visitor_id: pc.visitor_id || null,
            warmth: pc.visitor ? pc.visitor.warmth : null,
            grudge: pc.visitor ? pc.visitor.grudge : null,
          });
        }
      }
      interrupt = true;
    }
    for (const n of data.news || []) {
      const a = fireEvent('news_arrives', { headline: n.headline || null });
      // a headline is dream material too: significance from the amp it landed under
      if (n.headline) pushDreamMemory('headline', n.headline, clamp(0.3 + 0.2 * (a - 1)));
    }
    for (const w of data.warden || []) {
      if (!w || !w.text) continue;
      pendingWarden.push(w);
      interrupt = true;
    }
    if (interrupt && currentAbort) currentAbort.abort(); // cut the current thought mid-word
  };

  // Fire a named event: capture amp BEFORE it resets monotony, apply it, and if
  // it was a trivial thing landing under high amplification, arm the "this is the
  // day" cue. Returns the amp that was applied.
  function fireEvent(name, extra = {}) {
    const a = ampOf(vitals);
    applyEvent(vitals, name, { now: Date.now() });
    if (TRIVIAL_EVENTS.has(name) && a > 2.0) {
      amplifiedCue = { label: TRIVIAL_LABELS[name] || name, until: Date.now() + 3 * 60 * 1000 };
    }
    emit({ kind: 'event', payload: { name, amp: Number(a.toFixed(3)), ...extra } });
    return a;
  }

  // Fire a social event: nudge one inmate's standing, scaled by amp, and knock
  // monotony down (a slight is still an event). Emits the standing so viewers can
  // watch a feud build.
  function fireSocial() {
    const { castKey, ev } = pickSocial();
    const a = ampOf(vitals);
    applySocialEvent(vitals.relations, castKey, ev, a);
    vitals.monotony = clamp((vitals.monotony || 0) - 0.2);
    const { mins } = londonParts();
    recordIncident('social', { actorKey: castKey, slight: ev.slight, evType: ev.type, phase: currentRegime(mins).phase, mins });
    const r = vitals.relations[castKey];
    emit({
      kind: 'event',
      payload: {
        name: 'social',
        cast: castKey,
        who: (BY_KEY[castKey] || {}).name || castKey,
        type: ev.type,
        amp: Number(a.toFixed(3)),
        standing: { warmth: r.warmth, suspicion: r.suspicion, grudge: r.grudge },
      },
    });
  }

  // Fire an officer event: nudge one officer's standing scaled by amp, soften
  // monotony, arm a prompt cue, and emit the standing so viewers see it build.
  function fireOfficer() {
    const { officerKey, ev } = pickOfficer();
    const a = ampOf(vitals);
    applyOfficerEvent(vitals.relations, officerKey, ev, a);
    vitals.monotony = clamp((vitals.monotony || 0) - 0.25);
    const { mins } = londonParts();
    recordIncident('officer', { actorKey: officerKey, slight: ev.slight, evType: ev.type, phase: currentRegime(mins).phase, mins });
    officerCue = { key: officerKey, ev, until: Date.now() + 3 * 60 * 1000 };
    const r = vitals.relations[officerKey];
    emit({
      kind: 'event',
      payload: {
        name: 'officer',
        cast: officerKey,
        who: (BY_KEY[officerKey] || {}).name || officerKey,
        type: ev.type,
        amp: Number(a.toFixed(3)),
        standing: { warmth: r.warmth, suspicion: r.suspicion, grudge: r.grudge },
      },
    });
  }

  // Fire an overheard event: Cy half-hears something and may misinterpret it -
  // more likely at low lucidity or high paranoia. Arms a prompt cue and emits
  // the fact (but not the paranoid content) for the ticker.
  function fireOverheard() {
    const item = pickOverheard();
    const paranoia = (vitals.derived && vitals.derived.paranoia) || 0;
    const p = mishearChance({ lucidity: vitals.mental.lucidity, paranoia });
    const misheard = Math.random() < p;
    vitals.monotony = clamp((vitals.monotony || 0) - 0.2);
    const { mins } = londonParts();
    recordIncident('overheard', { phase: currentRegime(mins).phase, mins });
    overheardCue = { item, misheard, until: Date.now() + 3 * 60 * 1000 };
    emit({
      kind: 'event',
      payload: { name: 'overheard', source: item.source, misheard },
    });
  }

  // Wing noise: sparse texture. A specific thing that goes off on the wing and
  // that Cy notices mid-thought. It lands in the ledger as a real, dated thing
  // but moves the numbers barely (awake) or wakes him (night). Rate-limited hard
  // so it never becomes a drumbeat: at most ~1 every 3-4 min awake, rarer asleep,
  // and suppressed outright if the last two bursts both carried a noise.
  // Numbers as digits (matches the VOICE numerals rule) so raw material he echoes
  // never feeds him spelled-out numbers. Landings are the 1s/2s in wing slang.
  const WING_NOISES = [
    'a shout goes up down the landing',
    'a door goes, heavy, somewhere on the 2s',
    'the meds trolley, wheels squeaking along the 1s',
    'someone kicking off 2 doors down, boots and shouting',
    'a radio through the wall, tinny, same station as always',
    'keys close by, jangling, then gone',
    'someone crying further along, low, trying not to be heard',
    'the alarm goes, then boots on the landing, a lot of them',
  ];
  function maybeWingNoise(now, asleep, phase, mins) {
    // rate floor: awake at least 3 min apart, asleep at least 9 min apart
    const minGap = asleep ? 9 * 60 * 1000 : 3 * 60 * 1000;
    if (now - (vitals.lastWingNoiseMs || 0) < minGap) return;
    // no drumbeat: if the last two bursts both carried a noise, hold this one
    if (recentNoise[0] && recentNoise[1]) return;
    // past the floor, a modest per-tick chance so it lands ~every 3-4 min awake
    const p = asleep ? 0.02 : 0.06;
    if (Math.random() >= p) return;

    const line = WING_NOISES[Math.floor(Math.random() * WING_NOISES.length)];
    vitals.lastWingNoiseMs = now;
    recordIncident('wing', { line, phase, mins }); // real, dated, in the ledger

    let mid = false;
    if (asleep) {
      // a night noise is the exception - high impact, it wakes him
      fireEvent('noise_night');
      wingNoiseCue = { line, mid: false, wake: true, until: now + 3 * 60 * 1000 };
    } else {
      // barely moves the needle awake - a small startle, no more
      applyDeltas(vitals, { agitation: +0.015 }, 1);
      mid = Math.random() < 0.5 && !!currentAbort;
      wingNoiseCue = { line, mid, wake: false, until: now + 3 * 60 * 1000 };
      if (mid && currentAbort) currentAbort.abort(); // cut across the thought mid-word
    }
    emit({ kind: 'event', payload: { name: 'wing_noise', line, asleep, mid } });
  }

  // ---- deterministic environment scheduler (runs each vitals tick) ----
  function scheduler(now) {
    const { date, mins } = londonParts(new Date(now));

    if (date !== prevDate) {
      vitals.day = (vitals.day || 1) + 1;
      prevDate = date;
      emit({ kind: 'day', payload: { n: vitals.day, date } });
    }

    for (const s of SCHEDULE) {
      if (crossed(s.mins, mins, prevMins)) fireEvent(s.name);
    }
    // regime boundary crossings that can DEVIATE (late unlock, cancelled
    // association). A deviation is an amplifiable event AND a concrete incident.
    for (const r of REGIME) {
      if (!crossed(r.mins, mins, prevMins)) continue;
      const dev = DEVIATIONS[r.phase];
      if (dev && Math.random() < dev.chance) {
        recordIncident('regime', { sub: dev.sub, phase: r.phase, mins });
        fireEvent(dev.event);
      }
    }
    prevMins = mins;

    const asleep = isAsleep(mins);
    const phase = currentRegime(mins).phase;
    // wing noise: sparse texture, rate-limited (awake and asleep both routed here)
    maybeWingNoise(now, asleep, phase, mins);
    // random ambient events, low probability per 5s tick
    if (Math.random() < 0.0006) fireEvent('injury');
    if (!asleep && Math.random() < 0.0008) fireEvent('cell_search');
    // a rare full lockdown - a real deviation, felt harder than a late unlock
    if (!asleep && Math.random() < 0.0005) {
      recordIncident('regime', { sub: 'lockdown', phase, mins });
      fireEvent('lockdown');
    }

    // trivial daily irritations (awake) - tiny normally, huge under high amp
    if (!asleep && Math.random() < 0.004) {
      const trivial = ['no_eggs', 'cold_tea'];
      const sub = trivial[Math.floor(Math.random() * trivial.length)];
      recordIncident('trivial', { sub, phase, mins });
      fireEvent(sub);
    }
    // social frictions between inmates (awake) - build warmth/suspicion/grudge
    if (!asleep && Math.random() < 0.006) fireSocial();
    // officers acting through the machinery of the place (awake)
    if (!asleep && Math.random() < 0.004) fireOfficer();
    // half-heard remarks down the wing (awake) - may be misheard under paranoia
    if (!asleep && Math.random() < 0.005) fireOverheard();
    // pure texture - the grain of the day that moves no numbers, only the ledger.
    // A little more often than the number-moving events, so the ledger stays full
    // of specifics. Rarely while asleep (the cell at night still creaks).
    if (Math.random() < (asleep ? 0.006 : 0.012)) recordIncident('texture', { phase, mins });

    // no mail in 24h - fire at most once per 24h
    if (now - (vitals.lastMailMs || now) > 24 * 3600 * 1000 && now - (vitals.noMailFiredMs || 0) > 24 * 3600 * 1000) {
      fireEvent('no_mail_24h');
      vitals.noMailFiredMs = now;
    }
  }

  // ---- vitals tick every tickMs ----
  let powerTickN = 0;
  const tickTimer = setInterval(async () => {
    const now = Date.now();
    const { mins } = londonParts(new Date(now));
    const asleep = isAsleep(mins);
    tick(vitals, { asleep, now });
    scheduler(now);

    const rate = tokenCount / (config.tickMs / 1000); // tok/s over the window
    const broca = clamp(rate / 4); // ~3.4 tok/s model -> ~0.85 at full flow
    tokenCount = 0;
    const v1 = vitals.imageRecall > 0.05 ? clamp(0.3 + 0.6 * vitals.imageRecall) : 0;
    const brain = brainRegions(vitals, { broca: Number(broca.toFixed(3)), v1: Number(v1.toFixed(3)), asleep });
    const hr = heartRate(vitals, asleep);

    emit({
      kind: 'vitals',
      payload: {
        physical: vitals.physical,
        mental: vitals.mental,
        derived: vitals.derived,
        hr,
        brain,
        mode: currentMode,
        asleep,
        day: vitals.day,
        monotony: Number((vitals.monotony || 0).toFixed(3)),
        amp: Number(ampOf(vitals).toFixed(3)),
        relations: vitals.relations,
      },
    });

    // integrate the electricity meter every tick; emit + persist every ~30s
    powerMeter.integrate(now);
    if (++powerTickN % 6 === 0) {
      const snap = powerMeter.snapshot(now);
      emit({ kind: 'power', payload: snap });
      const pound = Math.floor(snap.cost_total);
      if (pound > lastPound) {
        lastPound = pound;
        forceCost = true; // crossing a whole pound forces the next cost injection
      }
      powerMeter.save().catch(() => {});
    }

    try {
      await saveVitals(vitalsPath, vitals);
    } catch {
      /* keep going */
    }
  }, config.tickMs);

  // ---- host metrics every 10s ----
  const hostTimer = setInterval(() => {
    const cur = cpuSnapshot();
    const idleD = cur.idle - prevCpu.idle;
    const totalD = cur.total - prevCpu.total;
    prevCpu = cur;
    const cpu = totalD > 0 ? clamp(1 - idleD / totalD) : 0;
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    probeOllama(); // non-blocking: result lands on cyProc for a later tick
    const nodeMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    emit({
      kind: 'host',
      payload: {
        // SYSTEM: the whole machine, including work that is NOT Cy
        cpu: Number((cpu * 100).toFixed(1)),
        memPct: Number(((used / total) * 100).toFixed(1)),
        memMB: Math.round(used / 1024 / 1024),
        memTotalMB: Math.round(total / 1024 / 1024),
        // CY: only ollama (the model) plus this runner node process
        cyCpu: cyProc.ollamaCpu,
        cyMemMB: cyProc.ollamaMB,
        nodeMB,
        ollamaProcs: cyProc.ollamaProcs,
        gpu: null,
      },
    });
  }, 10000);

  // Interruptible idle: sit still for `ms`, but break early if a postcard or
  // notice lands (so a silence never swallows an interrupt) or on shutdown.
  async function idleSilently(ms) {
    const end = Date.now() + ms;
    while (running && Date.now() < end) {
      if (pendingPostcards.length || pendingWarden.length) break;
      await sleep(Math.min(500, Math.max(0, end - Date.now())));
    }
  }

  // ---- DREAM: murmurs, one slow abstract drawing, night waking ---------------
  //
  // Transient per-night state (the persistent parts - the pool and the one-
  // drawing-per-night date - live on vitals). nextMurmurAt paces murmurs 5-20 min
  // apart; draw holds the night's single slowly-accumulating abstract drawing.
  const dreamState = {
    nextMurmurAt: 0,
    draw: null, // { id, strokes, next, nextStrokeAt, n, mood }
    frag: null, // last dream fragment, for the rare morning carry
    fragSig: 0, // best significance seen this night
  };

  // Emit a dream text event (a murmur, or a lucid night-waking line). Screened
  // like any output, but DELIBERATELY NOT appended to contextBuf: dream content
  // must never enter the waking Zone B context window.
  async function emitDreamText(s, { lucid = false } = {}) {
    const chunk = stripScaffold(sanitize(s));
    if (!chunk.trim()) return;
    const res = warden.screenOut(chunk);
    if (!res.ok) {
      await warden.logBlock(res.reason, chunk, tsNow());
      return;
    }
    const payload = { s: chunk + ' ', mode: 'dream' };
    if (lucid) payload.lucid = true;
    emit({ kind: 'text', payload });
  }

  // Keep one properly punctuated sentence from a night-waking generation.
  function firstSentence(raw) {
    let t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const m = t.match(/^(.*?[.!?])(?:\s|$)/);
    t = m ? m[1] : t.slice(0, 120).replace(/[,;:\s]+$/, '') + '.';
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // Arm the night's ONE slow drawing: pick a random start minute in the small
  // hours once per night, and once the clock reaches it, plan the abstract shape.
  function maybeArmDream(now, mins, date) {
    if (vitals.dreamDrawDate === date) return; // already drew tonight
    if (dreamState.draw) return; // one in progress
    if (!isSmallHours(mins)) return;
    if (vitals.dreamPlanDate !== date) {
      vitals.dreamPlanDate = date;
      vitals.dreamStartMin = pickDreamStartMin();
    }
    if (mins < vitals.dreamStartMin) return;
    vitals.dreamDrawDate = date; // claim the night's single drawing
    const strokes = dreamDrawing();
    dreamState.draw = { id: 'dr' + now.toString(36), strokes, next: 0, nextStrokeAt: 0, n: strokes.length, mood: moodSnapshot(vitals) };
  }

  // Release the next stroke of the dream drawing if one is due (1-2 min apart).
  // Each stroke is its own `draw` event carrying dream:true and a seq/total, so
  // the slow accumulation is real and survives a page reload mid-drawing.
  function advanceDreamDraw(now) {
    const d = dreamState.draw;
    if (!d) return false;
    if (now < (d.nextStrokeAt || 0)) return false;
    if (d.next >= d.strokes.length) {
      dreamState.draw = null;
      return false;
    }
    const stroke = d.strokes[d.next];
    emit({ kind: 'draw', payload: { id: d.id, dream: true, strokes: [stroke], seq: d.next, total: d.n, mood: d.mood } });
    d.next++;
    d.nextStrokeAt = now + dreamStrokeGapMs();
    if (d.next >= d.strokes.length) dreamState.draw = null;
    return true;
  }

  // He just woke: he does NOT remember the dream at unlock, UNLESS the material
  // scored highly, in which case a fragment may surface as an incident this
  // morning. Then reset the night's transient dream state.
  function leaveDream() {
    if (dreamState.frag && dreamState.fragSig >= 0.6 && Math.random() < 0.5) {
      pushIncident(vitals.ledger, {
        actor: '',
        verb: '',
        object: '',
        detail: 'something left over from a dream, ' + dreamState.frag,
        resolved: false,
        ts: tsNow(),
      });
      vitals.lastIncidentMs = Date.now();
    }
    dreamState.frag = null;
    dreamState.fragSig = 0;
    dreamState.draw = null;
    dreamState.nextMurmurAt = 0;
  }

  // One night iteration: a night-waking lucid line if a wing noise surfaced him,
  // else advance the slow drawing, else a murmur if one is due, else sit still a
  // short slice so the next stroke lands within its 1-2 min window.
  async function dreamStep(mins) {
    const now = Date.now();
    const date = londonParts(new Date(now)).date;

    // NIGHT WAKING: a wing noise drags him up for ONE lucid line, then back under.
    if (wingNoiseCue && wingNoiseCue.wake && now < wingNoiseCue.until) {
      const line = wingNoiseCue.line;
      wingNoiseCue = null; // fire once
      const directives = buildDirectives(vitals, 'dream', { wake: true, wakeLine: line });
      const prompt = buildPrompt('', 'dream', { wake: true }, directives);
      const opts = options(vitals, config.threads, 'dream', { num_predict: 48 });
      await logPrompt('dream-wake', ZONE_A + '\n\n---PROMPT---\n' + prompt);
      const raw = await rawGenerate({ system: ZONE_A, prompt, opts });
      const one = firstSentence(raw);
      if (one) await emitDreamText(one, { lucid: true });
      dreamState.nextMurmurAt = now + dreamMurmurGapMs(); // settle back under
      await idleSilently(4000);
      return;
    }

    // the night's one slow abstract drawing: arm it, then release a due stroke
    maybeArmDream(now, mins, date);
    if (advanceDreamDraw(now)) {
      await idleSilently(3000);
      return;
    }

    // a murmur, spaced far apart (5-20 min)
    if (now >= dreamState.nextMurmurAt) {
      const mat = dreamMaterial(buildDreamPool(), {});
      if (mat.items.length) {
        dreamState.frag = mat.items[0].text;
        dreamState.fragSig = Math.max(dreamState.fragSig || 0, mat.significance || 0);
      }
      const directives = buildDirectives(vitals, 'dream', { material: mat.directive });
      const prompt = buildPrompt('', 'dream', null, directives);
      const opts = options(vitals, config.threads, 'dream');
      await logPrompt('dream', ZONE_A + '\n\n---PROMPT---\n' + prompt);
      const raw = await rawGenerate({ system: ZONE_A, prompt, opts });
      const murmur = shapeMurmur(raw);
      if (murmur) await emitDreamText(murmur);
      dreamState.nextMurmurAt = now + dreamMurmurGapMs();
      await idleSilently(2000);
      return;
    }

    // nothing due: hold still a short slice (strokes are serviced ~every 1-2 min)
    await idleSilently(20000);
  }

  // ---- main generation loop ----
  async function genLoop() {
    while (running) {
      if (pendingWarden.length) {
        await doWarden(pendingWarden.shift());
        continue;
      }
      if (pendingPostcards.length) {
        await doPostcard(pendingPostcards.shift());
        continue;
      }
      const { mins } = londonParts();
      const asleep = isAsleep(mins);

      // ASLEEP: DREAM mode runs its own step - murmurs spaced far apart, one slow
      // abstract drawing accumulating through the small hours, and the rare night
      // waking. It is a wholly separate branch from the waking journal below (its
      // own prompt, sampling and rendering), so dream incoherence never touches
      // the waking coherence rules.
      if (asleep) {
        if (currentMode !== 'dream') {
          emit({ kind: 'mode', payload: { from: currentMode, to: 'dream' } });
          currentMode = 'dream';
        }
        await dreamStep(mins);
        continue;
      }
      // just woke: carry a dream fragment into the morning only if it scored high
      // (he does not otherwise remember it), then resume the ruled-paper journal.
      if (currentMode === 'dream') {
        leaveDream();
        emit({ kind: 'mode', payload: { from: 'dream', to: 'journal' } });
      }
      const mode = 'journal';
      currentMode = mode;

      // REAL SILENCE: sometimes he just stops. Emit a silence event (no text),
      // sit still for its duration - vitals keep ticking on their own timer, so
      // the graphs stay alive while the page goes quiet - then loop.
      const sinceIncident = Date.now() - (vitals.lastIncidentMs || 0);
      const sil = silenceDecision(vitals, false, sinceIncident);
      if (sil.silent) {
        emit({ kind: 'silence', payload: { seconds: sil.seconds, reason: sil.reason } });
        await idleSilently(sil.seconds * 1000);
        continue;
      }

      // DRAWING: occasionally he picks up the pen and draws instead of writing.
      // Weighted by fixation/dissociation/longing, a fresh image, waiting on mail,
      // or a queued request. doDraw does both stages and emits.
      {
        const nowMs = Date.now();
        const dd = drawDecision(vitals, {
          asleep: false,
          sinceDrawMs: nowMs - (vitals.lastDrawMs || 0),
          waiting: nowMs - (vitals.lastMailMs || nowMs) > 3 * 3600 * 1000,
          recentImage: !!vitals.lastImageMs && nowMs - vitals.lastImageMs < 15 * 60 * 1000,
          hasRequestPending: pendingDrawRequests.length > 0,
        });
        if (dd.draw) {
          await doDraw();
          continue;
        }
      }

      // Zone A is the fixed ollama `system` (never rebuilt); the volatile Zone C
      // directives are assembled once per burst and folded into the prompt TAIL by
      // buildPrompt so the KV-cache prefix survives. buildCtx/pickForm have
      // fire-once side effects, so this must happen exactly once per burst - only
      // the sampling and the context tail vary across the repeat-retries below.
      const bans = bansDirective(vitals.recentOpeners);
      noiseThisBurst = false;
      let directives;
      let burstForm = null; // the selected form directive, surfaced to the RAW view
      {
        const ctx = buildCtx();
        ctx.bans = bans;
        ctx.regime = regimeDirective(mins);
        ctx.form = pickForm(vitals, { relations: vitals.relations });
        burstForm = ctx.form || null;
        ctx.incidents = incidentsDirective(vitals.ledger, {
          relations: vitals.relations,
          mailWaitMs: Date.now() - (vitals.lastMailMs || Date.now()),
          rnd: () => 0, // LEDGER CAP: the 3 most recent only, not a random 3-5
        });
        directives = buildDirectives(vitals, 'journal', ctx);
      }
      const baseOpts = options(vitals, config.threads, mode);
      // Forms that restate a phrase on purpose (the repeat form, "you repeat
      // yourself" from fatigue) opt out of the within-burst repeat guard, so a
      // deliberate refrain is not cut short.
      const allowRepeat = /say it again|cannot get past|you repeat yourself/.test(directives);

      const burstStart = Date.now();
      let discards = 0;
      let tempBump = 0;
      let penBump = 0;
      let produced = false;
      let lastFull = '';
      let lastResult = null;
      let lastTail = ''; // Zone B and the sampling actually used on the winning try,
      let lastOpts = null; // captured for the RAW view's per-burst detail
      for (;;) {
        const tail = contextText();
        const prompt = buildPrompt(tail, mode, null, directives);
        const opts = {
          ...baseOpts,
          temperature: Number(Math.min(1.6, baseOpts.temperature + tempBump).toFixed(3)),
          repeat_penalty: Number(Math.min(1.6, baseOpts.repeat_penalty + penBump).toFixed(3)),
        };
        await logPrompt(mode, ZONE_A + '\n\n---PROMPT---\n' + prompt);
        const r = await streamGenerate({ system: ZONE_A, prompt, opts, mode, contextTail: tail, allowRepeat });
        if (r.error) break; // ollama already backed off; move on
        if (!r.repeat) {
          produced = !!(r.full && r.full.trim());
          lastFull = r.full || '';
          lastResult = r;
          lastTail = tail;
          lastOpts = opts;
          break;
        }
        // near-repeat: discard, bump randomness + repeat penalty, trim context
        discards++;
        await logDiscard(mode, r.full, discards);
        tempBump += 0.2;
        penBump += 0.12;
        trimContext(discards >= 2 ? 0.5 : 0.25);
        if (discards >= 2) break; // dropped oldest half - move on to a fresh gen
      }
      const burstMs = Date.now() - burstStart;
      // live diagnostics: publish this burst's generation telemetry (no-op if the
      // burst errored before ollama returned a `done` line with counters).
      if (lastResult) {
        emitGen(lastResult, mode, {
          zoneA: ZONE_A,
          zoneB: lastTail,
          zoneC: directives,
          form: burstForm,
          styles: styleDirective(vitals),
          opts: lastOpts,
          output: lastFull,
        });
      }
      // remember this burst's opening word so the next prompt can forbid it -
      // the last-5-openers ban that keeps him off the same starting word.
      if (produced) {
        const w = firstWord(lastFull);
        if (w) {
          vitals.recentOpeners.push(w);
          while (vitals.recentOpeners.length > 5) vitals.recentOpeners.shift();
        }
        // let his own text move the mental state. This path is waking only now -
        // dream murmurs never reach here (they are handled in dreamStep) so a
        // fragmentary murmur can never be read as a waking spiral.
        await applyIntrospection(lastFull);
      }
      // roll the "did this burst carry a wing noise" window for the no-drumbeat rule
      recentNoise = [recentNoise[1], noiseThisBurst];
      // adaptive pacing: near-continuous trickle awake, slow drift asleep. No
      // artificial gap between waking generations that produced prose.
      //
      // TEMPO (duty cycle): after a waking burst, sit idle in proportion to the
      // viewer-driven speed - lower speed, more silence between bursts. This is
      // the machine being throttled, NOT Cy choosing to stop, so no `silence`
      // event is emitted; the vitals/host/power timers keep ticking on their own
      // so the page stays alive and never looks broken. idleSilently breaks early
      // for an inbound postcard/notice so an interrupt is never swallowed.
      if (produced) {
        await sleep(150); // the small breather between bursts, as before
        const idleMs = tempoIdleMs(burstMs, client.tempo.speed);
        if (idleMs > 0) await idleSilently(idleMs);
      } else {
        await sleep(700);
      }
    }
  }

  // ---- shutdown ----
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    running = false;
    console.log('\n[cy] shutting down - flushing...');
    if (currentAbort) currentAbort.abort();
    clearInterval(tickTimer);
    clearInterval(hostTimer);
    try {
      powerMeter.integrate();
      await powerMeter.save();
    } catch {
      /* ignore */
    }
    try {
      await saveVitals(vitalsPath, vitals);
    } catch {
      /* ignore */
    }
    await client.stop();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  client.start();
  console.log(`[cy] runner up. dryRun=${config.dryRun} model=${config.model} threads=${config.threads}`);
  console.log(`[cy] state dir: ${STATE_DIR}`);
  // Observability: the character cost of each prompt zone. Zone A is fixed and
  // cached by ollama (paid once); Zone B grows append-only; Zone C is rebuilt
  // every burst (a representative sample from the current state is measured).
  const sampleCtx = {
    bans: bansDirective(vitals.recentOpeners),
    regime: regimeDirective(londonParts().mins),
    grudge: grudgeDirective(vitals.relations),
    form: pickForm(vitals, { relations: vitals.relations }),
    incidents: incidentsDirective(vitals.ledger, { relations: vitals.relations, mailWaitMs: 0, rnd: () => 0 }),
  };
  if (castCharged(vitals.relations)) sampleCtx.cast = castForPrompt(vitals.relations);
  const sampleC = buildDirectives(vitals, 'journal', sampleCtx);
  console.log(
    `[cy] prompt zones (chars): A(fixed,cached)=${ZONE_A.length} | ` +
      `B(context,append-only)=${contextBuf.length}/${CONTEXT_HARD} | C(volatile,sample)=${sampleC.length}`,
  );
  await genLoop();
}

// ---- context persistence ----

async function loadContext(path) {
  try {
    const raw = await readFile(path, 'utf8');
    // stored as jsonl of {ts,s}; rebuild the text stream, scrubbing any legacy
    // scaffold so a polluted saved context does not re-seed the echo loop.
    const text = raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l).s || '';
        } catch {
          return '';
        }
      })
      .join('');
    return stripScaffold(sanitize(text));
  } catch {
    return '';
  }
}

async function saveContext(path, text) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(dirname(path), { recursive: true });
  // one line so reload is trivial; the rolling window is already trimmed
  await writeFile(path, JSON.stringify({ ts: tsNow(), s: text }) + '\n');
}

main().catch((err) => {
  console.error('[cy] fatal:', err);
  process.exit(1);
});
