// run.js - the main loop.
//
// Continuously drives inmate 7734: streams tokens from ollama, screens them
// through the warden, batches everything to the API (or state/events.jsonl in
// dryRun), and maintains compatibility vitals on a five-second tick. Waking
// sampling is static; grounded state enters prose only as factual prompt context.
// A deterministic (non-LLM) scheduler fires ambient prison events on
// a Europe/London clock; inbound letters interrupt the stream mid-word.
//
// MODEL STATUS: numerical appraisal floors, event probabilities, legacy state
// deltas, affect-to-rendering gates and brain-display mappings retained in this
// orchestrator are ARBITRARY / HEURISTIC and PROVISIONAL or LEGACY. The new
// structured environment record contains none of those values.
//
//   node runner/run.js            # uses runner/config.json (falls back to sample)
//
// SIGINT flushes the batch queue and persists vitals before exiting.

import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  computeDerived,
  clamp,
  vitalsLoadIssue,
} from './vitals.js';
import {
  ZONE_A,
  buildDirectives,
  buildPrompt,
  options,
  letterPredict,
  completionDirective,
  completionBudget,
  bansDirective,
  wingnoiseDirective,
  applyBurstSeparator,
  NUM_CTX,
  isSleepWindow,
  shapeMurmur,
  dreamMaterial,
  dreamMurmurGapMs,
} from './prompt.js';
import { createSomaRuntime } from './soma-runtime.js';
import { prepareSomaGeneration } from './soma-cycle.js';
import {
  buildExpressiveChoiceRequest,
  chooseExpressiveAction,
  expressiveCadenceAvailability,
  reconcileExpressiveCadence,
  recordExpressiveDrawing,
  recordExpressiveJournal,
  EXPRESSIVE_SILENCE_COOLDOWN_MS,
} from './expressive-choice.js';
import {
  parseStrokes,
  moodSnapshot,
  detectDrawRequest,
  resolveRequest,
  subjectFromLine,
  subjectLooksProse,
  validateDrawing,
  strokesToDsl,
  strokeSig,
  drawIntentDirective,
  drawDecidePrompt,
  drawDslSystem,
  drawDslPrompt,
  drawPassPrompt,
  MIN_STROKES,
  dreamDrawing,
  dreamStrokeGapMs,
  isSmallHours,
  pickDreamStartMin,
} from './draw.js';
import { updateAffect } from './shout.js';
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
  OFFICERS,
} from './cast.js';
import { PowerMeter, costInjection } from './power.js';
import { SpendMeter } from './spend.js';
import { makeProviders, loadDeepSeekKey, looksLikeRefusal, OLLAMA, DEEPSEEK } from './provider.js';
import {
  assistantFrameHits,
  createWarden,
  isRepeat,
  looksLikeAssistantFrame,
  narrationHits,
  repeatsWithinBurst,
  sanitize,
  stateNotationHits,
  stripAssistantContaminatedTail,
  stripScaffold,
  stripScaffoldAccounted,
} from './warden.js';
import { Client, tsNow } from './client.js';
import { tempoIdleMs, readingIdleMs, clampSpeed, READ_CHARS_PER_SEC } from './tempo.js';
import { recordCompletedSilence } from './silence.js';
import { PRISON_SCHEDULE, mealExpectation, materialiseScheduledEvent } from './environment.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  MEMORY_EXPRESSION_BATCH_LIMIT,
  publicMemoryQueryTelemetry,
  redactAutobiographicalMemoryFromTelemetry,
  sourceFromEnvironmentRecord,
  sourceFromExpression,
  sourceFromPostcard,
  sourceFromReply,
} from './autobiographical-memory.js';
import { AutobiographicalMemoryRuntime } from './memory-runtime.js';
import {
  CONTEXT_CONSUMERS,
  createContextItem,
  inspectContextPacket,
  safeBuildContext,
} from './context-broker.js';
import {
  AWG_TIMEOUT_MS,
  awgEventToEnvironment,
  reconcileWorldSimulationState,
  runAmbientWorldCycle,
  shouldRunAwg,
} from './ambient-world-generator.js';
import {
  reconcileInstrumentalAgencyState,
  openInstrumentalOpportunity,
  queueInstrumentalOpportunity,
  resolveInstrumentalOpportunity,
  takePendingInstrumentalOpportunities,
} from './instrumental-agency.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(HERE, 'state');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HARD CAP on consecutive near-repeat discards in one burst. Past this many the
// journal loop STOPS discarding and forces the text out anyway (see genLoop): a
// context full of near-identical phrasing makes every retry overlap and be
// discarded, so without a cap he writes constantly and publishes nothing while
// pinning the CPU. 2 is enough - slightly repetitive prose beats total silence.
const MAX_DISCARDS = 2;

// ENGINEERING AUTONOMOUS-ACTIVITY TIMING. A model-selected silence has this
// fixed duration; no provisional fatigue/rest score changes its length.
export const AUTONOMOUS_SILENCE_SECONDS = 45;

// WATCHDOG. A stall is NOT a long gap - the tempo deliberately asks for gaps of
// minutes at low speed, and a deliberate silence is chosen stillness; neither is
// a wedge. A stall is the runner TRYING and FAILING to produce text: STALL_CYCLES
// generation cycles in a row that ended in empty/blocked/aborted with nothing
// emitted (see the cycle-outcome accounting). We ALSO catch a genuinely hung
// generation - the model pinned in eval/gen for WATCHDOG_MS without a single
// token - which no outcome would ever record. Either way: log loudly and escalate
// a context reset. This is the backstop that makes the silent-deadlock failure
// impossible to repeat, without misfiring on ordinary throttled idle.
const WATCHDOG_MS = 4 * 60 * 1000; // a generation pinned this long with zero tokens is hung
const STALL_CYCLES = 3; // this many consecutive no-text cycles = a real stall

// ---- abortable ollama stream reader ---------------------------------------
//
// Reads an ollama NDJSON /api/generate stream from `reader`, line by line, and
// calls onToken(text) for each response chunk and onDone(obj) for the final
// counters line. Extracted from streamGenerate so the CANCELLATION path is unit-
// testable without a live model: the moment `signal` aborts, the pending
// reader.read() rejects and this returns { aborted: true } AT ONCE - it never
// waits for the in-flight generation to finish. onToken may return a truthy value
// to stop the read early (the near-repeat "break outer" case), which returns
// { broke: true }. A non-abort read error is re-thrown for the caller to classify.
export async function readNdjsonStream(reader, { signal, onToken, onDone } = {}) {
  const dec = new TextDecoder();
  let lineBuf = '';
  try {
    for (;;) {
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
          if (onToken && (await onToken(obj.response, obj))) return { broke: true };
        }
        if (obj.done && onDone) onDone(obj);
      }
    }
  } catch (err) {
    if (signal && signal.aborted) return { aborted: true };
    throw err;
  }
  return { ended: true };
}

// Provider-neutral hard-limit detection. Ollama reports eval_count and may omit
// a reason; OpenAI-shaped providers report finish_reason="length". Either is
// sufficient evidence that the final buffered token was not a chosen ending.
export function generationHitTokenLimit(stats, opts = {}) {
  const reason = String((stats && (stats.done_reason || stats.finish_reason)) || '').toLowerCase();
  if (reason === 'length') return true;
  const cap = Number(opts && opts.num_predict);
  const used = Number(stats && (stats.eval_count ?? (stats.usage && stats.usage.completion_tokens)));
  return Number.isFinite(cap) && cap > 0 && Number.isFinite(used) && used >= cap;
}

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

// THE REGIME - the shape of a British prison day. The current phase is put in
// every waking prompt so the day has structure; some transitions can DEVIATE
// (late unlock, cancelled association, a lockdown). Legacy amplification remains
// a visible fictional-world diagnostic and does not create a prose directive.
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
  let pendingSomaFailure = null;
  let reportSomaFailure = (failure) => { pendingSomaFailure = failure; };
  const soma = createSomaRuntime(vitals.cognition, {
    now: Date.now(),
    reconcileOptions: { legacyPhysical: vitals.physical },
    initialFailure: vitalsLoadIssue(vitals),
    onState: (state) => { vitals.cognition = state; },
    onFailure: (failure) => reportSomaFailure(failure),
  });
  if (!vitals.lastMailMs) vitals.lastMailMs = Date.now();
  if (typeof vitals.monotony !== 'number') vitals.monotony = 0;
  // the cast + grudge map lives on the vitals object so it persists with state
  vitals.relations = reconcileRelations(vitals.relations);
  // Open prison-world action opportunities persist independently of generated
  // prose. A restart therefore cannot silently turn an intended action into a
  // resolved trial or lose the concrete continuation still owed by the world.
  vitals.instrumentalAgency = reconcileInstrumentalAgencyState(vitals.instrumentalAgency);
  // Ambient world state is authoritative runner-persistent state. The public
  // database receives private inspection mirrors, but a restart resumes from
  // this state rather than reconstructing canon from prose.
  vitals.worldSimulation = reconcileWorldSimulationState(vitals.worldSimulation);
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
  vitals.expressiveCadence = reconcileExpressiveCadence(vitals.expressiveCadence);
  // DREAM state (persists with everything else). dreamPool holds the memory
  // material dreams recombine (postcard images/captions + news headlines, decayed
  // by recency and scaled by significance); the date fields cap the night's one
  // slow drawing to a single occurrence.
  if (!Array.isArray(vitals.dreamPool)) vitals.dreamPool = [];
  if (typeof vitals.dreamDrawDate !== 'string') vitals.dreamDrawDate = '';
  // READING-CAP backpressure clock (see tempo.js). readEpochMs anchors a monotonic
  // wall clock and readCharsSinceEpoch counts emitted prose since that anchor; the
  // two give how far the writing has run ahead of a human reading pace. It rides on
  // the vitals object so it persists like everything else, but is RESET on every
  // boot: carrying a stale surplus/deficit across a restart is meaningless (nobody
  // was reading the gap), so the debt starts at zero.
  vitals.readEpochMs = Date.now();
  vitals.readCharsSinceEpoch = 0;
  if (typeof vitals.dreamPlanDate !== 'string') vitals.dreamPlanDate = '';
  if (typeof vitals.dreamStartMin !== 'number') vitals.dreamStartMin = 0;

  const warden = createWarden(config, blockedLogPath);
  const client = new Client(config, STATE_DIR);
  const emit = (ev) => client.enqueue(ev);
  let autobiographicalMemory = null;
  let pendingMemoryQuery = null;
  let memoryFormationTurns = 0;
  let memoryExpressionBuffer = [];
  const recentWorldHistory = [];
  try {
    const observedSleepHistory = await client.fetchObservedSleepHistory();
    soma.replayObservedSleepRecords(observedSleepHistory, { now: Date.now() });
    console.log(`[cy] TPM sleep history: ${observedSleepHistory.length} structured observations replayed`);
  } catch (error) {
    console.warn(`[cy] TPM sleep history unavailable; remaining CALIBRATING: ${error.message}`);
  }
  reportSomaFailure = (failure) => {
    emit({ kind: 'event', payload: { name: 'soma_unavailable', reason: failure.reason, operation: failure.operation } });
    client.kick();
  };
  if (pendingSomaFailure) reportSomaFailure(pendingSomaFailure);

  // ---- inference activity signal (public LED, everyone - not the ?111 gate) ----
  // A live "is the model generating RIGHT NOW" flag, signalled by the runner at the
  // real boundaries rather than inferred from text arriving. Three phases:
  //   'eval' - request accepted, the model is READING the prompt: CPU pinned but
  //            nothing appears yet (the phase that confuses people watching)
  //   'gen'  - tokens are being produced
  //   'idle' - nothing running
  // Emitted only on CHANGE, and kicked out of the batch immediately (client.kick)
  // so the dot updates promptly instead of waiting on the 2s flush.
  let inferPhase = 'idle';
  let inferBusySinceMs = 0; // stamped when the model goes idle -> busy; the hung-generation clock
  function setInfer(phase) {
    if (phase === inferPhase) return;
    if (phase !== 'idle' && inferPhase === 'idle') inferBusySinceMs = Date.now();
    inferPhase = phase;
    emit({ kind: 'inference', payload: { phase, active: phase !== 'idle' } });
    client.kick(); // priority flush: the LED must feel instantaneous
  }

  // ---- electricity meter ----
  const powerMeter = new PowerMeter(config, join(STATE_DIR, 'power.json'));
  await powerMeter.load();

  // ---- switchable model provider + model-spend meter ----
  // The DeepSeek key is read from runner/deepseek.key (gitignored). Missing key =>
  // DeepSeek simply unavailable; ollama is always ready. The key is NEVER logged -
  // only its presence (a boolean) is ever surfaced. The active provider is chosen
  // by the owner via /api/admin.php and read off the tempo poll (client.provider);
  // it starts on ollama and switches mid-loop with no restart. The spend meter is
  // the API-money analogue of the power meter: it prices paid provider calls only
  // (ollama costs nothing in API terms - a SEPARATE series from electricity) and
  // persists its cumulative total across restarts.
  const deepseekKey = await loadDeepSeekKey(HERE);
  const providers = makeProviders(config, { deepseekKey });
  console.log(`[cy] providers: ollama ready; deepseek ${providers[DEEPSEEK].available() ? 'ready' : 'unavailable (no key file)'}`);
  let activeProviderId = OLLAMA;
  const activeProvider = () => providers[activeProviderId] || providers[OLLAMA];
  soma.observe(
    {
      name: 'runner_restart',
      text: 'continuity resumed inside the machine; local inference became available again',
      tags: ['restart', 'machine', 'continuity'],
      ts: tsNow(),
    },
    { now: Date.now() },
  );
  const spendMeter = new SpendMeter(config, join(STATE_DIR, 'spend.json'));
  await spendMeter.load();
  // Report DeepSeek availability to the server as a side-channel capability event,
  // so the admin switch can refuse a DeepSeek selection with a clear reason when the
  // runner has no key (the key lives on the runner, not the server).
  emit({ kind: 'capability', payload: { deepseek: providers[DEEPSEEK].available() } });

  // Record one paid generation's spend and emit a raw 'spend' impulse. A no-op for
  // ollama (no usage in the stats), so every generation path can call it blindly.
  // The event carries the discrete per-call cost at an instant (an IMPULSE) plus the
  // running cumulative total; the chart converts impulses to a rate, so nothing is
  // pre-bucketed or smoothed here - just the raw facts with an accurate timestamp.
  let spendSaveAccum = 0;
  // `productive` = did this paid call actually put prose on the page? When false, the
  // same cost is folded into the meter's non-emitting series too, so a burst that paid
  // full prompt price and emitted nothing is attributed as waste (see spend.js). The
  // spend event carries both the grand cumulative and the non-emitting cumulative, plus
  // this call's own productive flag, so the RAW diagnostics can show the burn directly.
  async function recordSpend(stats, mode, productive = true) {
    if (!stats || !stats.usage) return; // ollama / no-usage: not a paid call
    const rec = spendMeter.record({
      provider: stats.provider || activeProviderId,
      model: stats.model || activeProvider().model,
      usage: stats.usage,
      cost: stats.cost,
      productive,
    });
    emit({
      kind: 'spend',
      payload: {
        provider: rec.provider,
        model: rec.model,
        tokens_in: rec.tokensIn,
        tokens_out: rec.tokensOut,
        cached_in: rec.cachedIn,
        uncached_in: rec.uncachedIn,
        cost_gbp: rec.costGbp,
        cost_usd: rec.costUsd,
        total_gbp: rec.totalGbp,
        total_usd: rec.totalUsd,
        productive: rec.productive,
        // cumulative spend that produced NOTHING on the page - surfaced so the wasted
        // burn is on screen, not something to infer from a bill.
        nonemit_gbp: rec.nonEmitGbp,
        nonemit_usd: rec.nonEmitUsd,
        nonemit_calls: rec.nonEmitCalls,
        mode,
        t_ms: Date.now(),
      },
    });
    // persist roughly every few calls so the life-of-project total survives a restart
    if (++spendSaveAccum >= 3) {
      spendSaveAccum = 0;
      spendMeter.save().catch(() => {});
    }
  }

  // ---- viewer-driven tempo ----
  // A representative recent burst duration, so the tempo event can carry a live
  // cadence ('about every Ns') for the viewer. Seeded with a nominal ~75s (a
  // typical burst) and smoothed toward each real burst as they complete.
  let recentBurstMs = 75000;
  // When the polled tempo changes, mirror it into the public stream as a `tempo`
  // event so the viewer can display speed, viewer count and the cost of watching
  // live. The pence/hour anchors are derived from the power model here (the web
  // side does not know the watts model): with the duty cycle, average draw is
  // idle + (speed/100)*(load-idle), so pence/hour is linear in speed between
  // pph_idle (speed->0) and pph_load (speed=100). The viewer interpolates.
  let tempoEpoch = 0;
  // The client callback also fires when only the live viewer count changes. That
  // must refresh the public tempo readout, but it must NOT cancel the current
  // duty-cycle idle: presence heartbeats can briefly move the count between 0
  // and 1 while the effective custom speed remains unchanged. Track the speed
  // separately so only a real duty-cycle change wakes this loop.
  let idleTempoSpeed = clampSpeed(client.tempo.speed);
  client.onTempo = (t) => {
    const nextIdleTempoSpeed = clampSpeed(t.speed);
    if (nextIdleTempoSpeed !== idleTempoSpeed) {
      idleTempoSpeed = nextIdleTempoSpeed;
      tempoEpoch++;
    }
    const pph = (w) => (w / 1000) * powerMeter.tariff * 100;
    // Turn the speed into a legible CADENCE for the viewer: the deliberate idle
    // after a representative burst, and the effective gap between bursts. The
    // panel renders 'about every Ns' from these rather than a bare percentage.
    const burst = recentBurstMs;
    const idle = tempoIdleMs(burst, t.speed);
    emit({
      kind: 'tempo',
      payload: {
        speed: t.speed,
        viewers: t.viewers,
        custom: t.custom,
        pph_idle: Number(pph(powerMeter.idleWatts).toFixed(3)),
        pph_load: Number(pph(powerMeter.loadWatts).toFixed(3)),
        burst_ms: Math.round(burst), // representative recent burst duration
        idle_ms: Math.round(idle), // deliberate idle the runner would insert now
        cadence_ms: Math.round(burst + idle), // effective gap a viewer perceives between bursts
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

  // Build one incident and file it: stamp the time, push onto the rolling
  // ledger, and reset the "fresh incident" clock the silence engine reads.
  function recordIncident(kind, ctx = {}) {
    const inc = makeIncident(kind, { ...ctx, relations: {} });
    inc.ts = tsNow();
    pushIncident(vitals.ledger, inc);
    vitals.lastIncidentMs = Date.now();
    soma.observe(
      {
        name: kind,
        text: ctx.text || incidentLine(inc),
        tags: [kind, ctx.evType, ...(ctx.tags || []), inc.sub, inc.verb].filter(Boolean),
        entities: [inc.actor, inc.subject].filter(Boolean),
        appraisal: ctx.appraisal,
        body: ctx.body,
        social: ctx.social,
        effects: ctx.effects,
        somaInput: ctx.somaInput || null,
        environmentEventId: ctx.environmentEventId || null,
        outcome: ctx.evType || ctx.sub || null,
        ts: inc.ts,
      },
      { now: Date.now() },
    );
    return inc;
  }

  // Persist the facts, the observation and the normalized Soma input as one
  // private side-channel record. This record contains no legacy numeric
  // appraisal. The current numeric engine is named as a PROVISIONAL consumer
  // only when the caller also passes the old compatibility fields to Soma.
  function captureEnvironmentEvent(archetypeId, {
    eventType = archetypeId,
    summary = null,
    world = {},
    observation = {},
    durationMs = null,
    provisionalConsumer = true,
    cyObserved = true,
  } = {}) {
    const eventId = `env-${randomUUID()}`;
    const eventTimestamp = tsNow();
    const suppliedOpportunity = world.action_opportunity && typeof world.action_opportunity === 'object'
      ? world.action_opportunity : null;
    const suppliedSocial = world.social && typeof world.social === 'object' ? world.social : null;
    const worldWithDescription = {
      ...world,
      context: {
        ...(world.context || {}),
        description: world.context && world.context.description != null
          ? world.context.description
          : summary,
      },
      ...(suppliedOpportunity && suppliedOpportunity.id ? {
        action_opportunity: {
          ...suppliedOpportunity,
          onset_at: suppliedOpportunity.onset_at || eventTimestamp,
          resolved_at: String(suppliedOpportunity.resolution_status || '').toUpperCase() === 'RESOLVED'
            ? suppliedOpportunity.resolved_at || eventTimestamp : suppliedOpportunity.resolved_at,
          linked_event_ids: [...new Set([
            ...(Array.isArray(suppliedOpportunity.linked_event_ids) ? suppliedOpportunity.linked_event_ids : []),
            eventId,
          ])],
        },
      } : {}),
      ...(suppliedSocial && suppliedSocial.episode_type ? {
        social: {
          ...suppliedSocial,
          episode_id: suppliedSocial.episode_id || `social:${eventId}`,
          start_at: suppliedSocial.start_at || eventTimestamp,
          end_at: suppliedSocial.end_at || null,
          linked_event_ids: [...new Set([
            ...(Array.isArray(suppliedSocial.linked_event_ids) ? suppliedSocial.linked_event_ids : []),
            eventId,
          ])],
        },
      } : {}),
    };
    const event = createEnvironmentEvent(archetypeId, {
      id: eventId,
      timestamp: eventTimestamp,
      eventType,
      durationMs,
      world: worldWithDescription,
      observation: { summary, ...observation },
    });
    const somaticFacts = event.world.somatic;
    const socialFacts = event.world.social;
    const hasSomaticFacts = somaticFacts.stimulus.id != null
      || somaticFacts.stimulus.noxious_stimulus !== 'UNKNOWN'
      || somaticFacts.stimulus.status !== 'UNKNOWN'
      || somaticFacts.body.site !== 'UNKNOWN'
      || somaticFacts.tissue.damage_status !== 'UNKNOWN'
      || somaticFacts.tissue.injury_id != null
      || somaticFacts.tissue.injury_status !== 'UNKNOWN';
    const record = createEnvironmentRecord(event, {
      consumedBy: [
        ...(cyObserved ? ['soma-input-staging-v1'] : ['ambient-world-state-v1']),
        ...(['meal', 'meal_expected'].includes(archetypeId)
          ? ['feeding-event-model-v1', 'ingestion-ledger-v1']
          : []),
        ...(worldWithDescription.action_opportunity && worldWithDescription.action_opportunity.id
          ? ['action-opportunity-model-v1', 'action-outcome-contingency-v1']
          : []),
        ...(worldWithDescription.instrumental && worldWithDescription.instrumental.archetype_id
          ? ['prison-instrumental-opportunities-v1']
          : []),
        ...(cyObserved ? ['current-defensive-context-v1', 'probabilistic-threat-learning-v1'] : []),
        ...(['sleep_normal', 'sleep_interrupted', 'forced_wakefulness'].includes(archetypeId)
          ? ['process-s-normalized-v1', 'tpm-predicted-kss-v1']
          : []),
        ...(hasSomaticFacts ? [
          'somatic-event-model-v1',
          'noxious-stimulus-representation-v1',
          'injury-ledger-v1',
          'computational-nociceptive-input-analogue-v1',
        ] : []),
        ...(socialFacts && socialFacts.episode_id ? [
          'social-episode-model-v1',
          'social-contact-detector-ledger-v1',
        ] : []),
        ...(cyObserved && provisionalConsumer ? ['legacy-experienced-state-v2'] : []),
      ],
    });
    if (cyObserved) {
      record.feeding = soma.observeFeedingRecord(record);
      record.somatic_nociceptive = soma.observeSomaticRecord(record);
      record.social_contact = soma.observeSocialContactRecord(record);
      record.action_outcome_contingency = soma.observeControllabilityRecord(record);
      record.current_defensive_context = soma.observeCurrentDefensiveContextRecord(record);
      record.threat_learning = soma.observeThreatLearningRecord(record);
    }
    emit({ kind: 'world_event_record', payload: record });
    recentWorldHistory.push({
      id: event.id,
      timestamp: event.timestamp,
      summary: summary || worldWithDescription.context.description || eventType,
      location: event.world.context.location || null,
      participants: event.world.context.associated_entities || [],
      cyObserved,
    });
    while (recentWorldHistory.length > 24) recentWorldHistory.shift();
    if (cyObserved && autobiographicalMemory) {
      const source = sourceFromEnvironmentRecord(record);
      if (source) {
        void autobiographicalMemory.queueSource(source).catch((error) => {
          console.warn(`[cy] memory source enqueue deferred: ${error.message}`);
        });
        pendingMemoryQuery = {
          text: source.text,
          tags: source.tags,
          location: event.world.context.location || null,
          publicSituation: source.text,
        };
      }
    }
    return record;
  }

  function beginInstrumentalIncident(sourceKind, sourceEventType, actorKey, actorName) {
    const prepared = openInstrumentalOpportunity(vitals.instrumentalAgency, {
      sourceKind,
      sourceEventType,
      actorKey,
      actorName,
      opportunityId: `instrumental:${randomUUID()}`,
      timestamp: tsNow(),
    });
    if (!prepared) return null;
    const opening = prepared.opening;
    const socialOpportunity = ['social', 'officer'].includes(sourceKind) ? {
      episode_id: `social:${prepared.pending.opportunityId}`,
      episode_type: 'OPPORTUNITY', start_at: prepared.pending.onsetAt,
      actor_id: prepared.pending.actorKey, actor_label: prepared.pending.actorName,
      target_id: 'cy:7734', target_label: 'Cy', relationship_ref: prepared.pending.actorKey,
      channel: sourceKind === 'officer' ? 'OFFICER_INTERACTION' : 'IN_PERSON',
      contact_form: 'ATTEMPTED_CONTACT', direction: 'INITIATED_BY_OTHER', reciprocity: 'ONE_WAY',
      character: prepared.pending.archetypeId === 'inmate_provocation' ? 'HOSTILE'
        : prepared.pending.archetypeId === 'inmate_check_in' ? 'SUPPORTIVE' : 'ORDINARY',
      resolution: 'ONGOING', opportunity_id: prepared.pending.opportunityId,
      opportunity_status: 'OPEN', action_executed: null,
    } : null;
    const structured = captureEnvironmentEvent(opening.archetypeId, {
      eventType: opening.eventType,
      summary: opening.text,
      world: { ...opening.world, ...(socialOpportunity ? { social: socialOpportunity } : {}) },
      observation: opening.observation,
      provisionalConsumer: false,
    });
    queueInstrumentalOpportunity(
      vitals.instrumentalAgency,
      prepared.pending,
      structured.world_event.id,
    );
    emit({
      kind: 'event',
      payload: {
        name: 'instrumental_situation',
        text: opening.text,
        environment_event_id: structured.world_event.id,
      },
    });
    emit({
      kind: 'event',
      payload: {
        name: 'instrumental_action',
        text: `Cy chose ${prepared.pending.chosenAction.replace('action:', '').replaceAll('_', ' ')}`,
        action: prepared.pending.chosenAction,
        environment_event_id: structured.world_event.id,
      },
    });
    return structured;
  }

  function resolvePendingInstrumentalIncidents() {
    const pending = takePendingInstrumentalOpportunities(vitals.instrumentalAgency);
    for (const opportunity of pending) {
      const resolutionTimestamp = tsNow();
      const outcome = resolveInstrumentalOpportunity(opportunity, { timestamp: resolutionTimestamp });
      const isSocial = opportunity.archetypeId.startsWith('inmate_')
        || ['officer_order', 'cell_search_handover'].includes(opportunity.archetypeId);
      const actualContact = ![
        'action:remain_silent', 'action:withdraw', 'action:disengage',
      ].includes(opportunity.chosenAction);
      const socialOutcome = isSocial ? {
        episode_id: `social:${opportunity.opportunityId}`,
        episode_type: actualContact ? 'CONTACT' : 'OPPORTUNITY',
        start_at: opportunity.onsetAt, end_at: resolutionTimestamp,
        actor_id: opportunity.actorKey, actor_label: opportunity.actorName,
        target_id: 'cy:7734', target_label: 'Cy', relationship_ref: opportunity.actorKey,
        channel: opportunity.archetypeId.startsWith('inmate_') ? 'IN_PERSON' : 'OFFICER_INTERACTION',
        contact_form: actualContact ? 'DIRECT_INTERACTION' : 'ATTEMPTED_CONTACT',
        direction: actualContact ? 'MUTUAL' : 'INITIATED_BY_OTHER',
        reciprocity: actualContact ? 'RECIPROCAL' : 'ONE_WAY',
        character: opportunity.archetypeId === 'inmate_provocation' && opportunity.chosenAction === 'action:respond'
          ? 'HOSTILE' : opportunity.archetypeId === 'inmate_check_in' && opportunity.chosenAction === 'action:answer'
            ? 'SUPPORTIVE' : 'ORDINARY',
        resolution: 'COMPLETED', opportunity_id: opportunity.opportunityId,
        opportunity_status: 'RESOLVED', action_executed: opportunity.chosenAction,
        linked_event_ids: [opportunity.openingEnvironmentEventId],
      } : null;
      const structured = captureEnvironmentEvent(outcome.archetypeId, {
        eventType: outcome.eventType,
        summary: outcome.text,
        world: { ...outcome.world, ...(socialOutcome ? { social: socialOutcome } : {}) },
        observation: outcome.observation,
        provisionalConsumer: false,
      });
      emit({
        kind: 'event',
        payload: {
          name: 'instrumental_outcome',
          text: outcome.text,
          action: opportunity.chosenAction,
          consequence: outcome.world.instrumental.consequence_id,
          environment_event_id: structured.world_event.id,
        },
      });
    }
  }

  function structuredEventForName(name, summary = null) {
    if (name === 'injury') {
      return captureEnvironmentEvent('minor_injury', { eventType: name, summary });
    }
    if (name === 'cell_search') {
      return captureEnvironmentEvent('cell_search', { eventType: name, summary });
    }
    if (name === 'lockdown') {
      return captureEnvironmentEvent('lockdown', { eventType: name, summary });
    }
    if (name === 'noise_night') {
      return captureEnvironmentEvent('sleep_interrupted', {
        eventType: name,
        summary,
        world: {
          physical: {
            sleep: { state: 'interrupted', interruption: 'present' },
            environmental_discomfort: 'present',
          },
          context: { location: 'cell' },
        },
        observation: { observed_facts: { sleep: 'interrupted' } },
      });
    }
    if (name === 'no_mail_24h') {
      return captureEnvironmentEvent('prolonged_social_absence', { eventType: name, summary });
    }
    if (name === 'assoc_cancelled') {
      return captureEnvironmentEvent('cancelled_activity', { eventType: name, summary });
    }
    if (name === 'no_eggs' || name === 'cold_tea') {
      return captureEnvironmentEvent('meal', {
        eventType: name,
        summary,
        world: {
          physical: { food: { offered: 'yes', consumed: 'unknown' } },
          situation: { deprivation_outcome: name === 'no_eggs' ? 'partial' : 'unknown' },
        },
      });
    }
    return null;
  }

  // Capture real postcard/news material into the bounded dream pool. Selection
  // later uses only fixed engineering weights and recency, not emotional scores.
  function pushDreamMemory(kind, text) {
    const t = (text || '').toString().trim();
    if (!t) return;
    vitals.dreamPool.push({ kind, text: t.slice(0, 120), ts: Date.now() });
    while (vitals.dreamPool.length > 24) vitals.dreamPool.shift();
  }

  // Assemble real candidate material with fixed engineering content-selection
  // weights. Recency is used only to bound and vary dream source material.
  function buildDreamPool() {
    const now = Date.now();
    const out = [];
    for (const it of vitals.dreamPool || []) {
      const ageH = (now - (it.ts || now)) / 3600000;
      const decay = Math.max(0.1, 1 - ageH / 72); // ~3-day fade
      const w = 0.5 * decay;
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
      out.push({ kind: 'person', text: c.name, weight: 0.25 });
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
  if (contextBuf.length > CONTEXT_HARD) {
    const removed = contextBuf.length - CONTEXT_SOFT;
    contextBuf = contextBuf.slice(-CONTEXT_SOFT);
    soma.observe(
      { name: 'context_trim', text: `${removed} characters of continuity were unavailable after restart`, tags: ['context', 'memory', 'machine'], ts: tsNow() },
      { now: Date.now() },
    );
  }
  const contextText = () => contextBuf;
  async function appendContext(chunk) {
    contextBuf += chunk;
    if (contextBuf.length > CONTEXT_HARD) {
      const removed = contextBuf.length - CONTEXT_SOFT;
      contextBuf = contextBuf.slice(-CONTEXT_SOFT); // rare, large trim
      soma.observe(
        { name: 'context_trim', text: `${removed} characters fell out of immediate language context`, tags: ['context', 'memory', 'machine'], ts: tsNow() },
        { now: Date.now() },
      );
    }
    await saveContext(contextPath, contextBuf);
  }
  // Shrink the effective context tail (on a near-repeat, to jolt the model off
  // the passage it keeps copying) - a deliberate, one-off cache break.
  function trimContext(frac) {
    const before = contextBuf.length;
    const keep = Math.max(0, contextBuf.length - Math.floor(contextBuf.length * frac));
    contextBuf = keep > 0 ? contextBuf.slice(-keep) : '';
    soma.observe(
      { name: 'context_trim', text: `${before - contextBuf.length} characters were removed to break a repeated loop`, tags: ['context', 'memory', 'machine'], ts: tsNow() },
      { now: Date.now() },
    );
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
  // The near-repeat guard hit its HARD CAP: log LOUDLY (console.error) so the
  // forced escape is visible in the log rather than a silent CPU spin. The loop
  // then emits the burst anyway (repetitive prose beats silence).
  async function logCapHit(mode, n) {
    const line = `[cy] WARNING near-repeat cap hit (${mode}) after ${n} discards - forcing the text out anyway`;
    console.error(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }
  // A metered-backoff wait: logged LOUDLY (console + run.out.log) so the paced-down
  // retry is visible rather than looking like a hang, with the streak length and the
  // wait so the exponential ramp is legible in the log.
  async function logBackoff(streak, ms) {
    const line = `[cy] metered backoff: ${streak} non-emitting cycle(s) in a row - waiting ${Math.round(ms / 1000)}s before the next attempt`;
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
  // Narration/assistant-frame drops, logged so we can see how often the second-
  // person-narrator and helper-model filter fires (see warden.narrationHits).
  async function logNarration(hits, mode) {
    if (!hits || !hits.length) return;
    const line = `[cy] narration-drop (${mode}): ${hits.join(' | ')}`;
    console.warn(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }
  // A drawing that failed to render - logged as its OWN thing, never as a near-repeat
  // discard. `why` is 'empty' (the DSL pass returned nothing usable - the model can
  // legitimately emit its END stop first) or 'unusable' (parsed, but too few strokes
  // to be a drawing). Drawing is a garnish: a failure here is noted and skipped, the
  // decision line still stands, and the main stream is never starved of a cycle.
  async function logDrawFail(why, text) {
    const snippet = (text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const line =
      why === 'empty'
        ? '[cy] draw failed: DSL pass returned empty - skipping the drawing (garnish, stream unaffected)'
        : `[cy] draw failed: too few usable strokes, skipping: "${snippet}"`;
    console.warn(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }
  // State-notation drops, logged like the narration drops: the compressed vitals
  // notation ('agit .70 stress .85 ...') copied out of the prompt block as prose,
  // stripped by warden.stripScaffold before it can reach the page or Zone B.
  async function logStateNotation(hits, mode) {
    if (!hits || !hits.length) return;
    const line = `[cy] state-notation-drop (${mode}): ${hits.join(' | ')}`;
    console.warn(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }
  // A chunk arrived with real content and a strip bank ANNIHILATED it - reduced it
  // to nothing before it could reach the page. This was the invisible drop: a pure
  // SCAFFOLD strip logged nothing at all, so a burst could be billed in full and
  // read as 'empty' with no trace of why. Attribute it to the bank that ate the
  // most, and carry the pre-strip text (trimmed) as the evidence of the cause.
  async function logAnnihilated(bank, cleaned, mode) {
    const snippet = (cleaned || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const line = `[cy] annihilated (${mode}) by ${bank}: "${snippet}"`;
    console.warn(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }
  // The within-burst repeat guard cut the burst because this chunk restated a
  // phrase already emitted this burst. It USED to abort with no log at all, so a
  // burst that stopped itself looked identical to one the model simply ended.
  async function logWithinBurstRepeat(chunk, mode) {
    const snippet = (chunk || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const line = `[cy] within-burst repeat (${mode}) - cutting the burst: "${snippet}"`;
    console.warn(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }
  // The near-repeat holdback discarded the primed opening (a verbatim replay of the
  // context tail): the whole held head is thrown away and the generation aborted.
  // The burst-level 'discarded-repeat' is recorded by the caller; this logs the
  // holdback's own discard at the point it happens, with the discarded text.
  async function logHoldbackDiscard(head, mode) {
    const snippet = (head || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const line = `[cy] near-repeat holdback (${mode}) - discarding held opening: "${snippet}"`;
    console.warn(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }
  // A strong assistant/analysis opener means the model stopped being Cy. The
  // held opening is rejected before it reaches the page or saved context.
  async function logAssistantFrameDiscard(head, mode) {
    const hits = assistantFrameHits(head);
    const snippet = (head || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const line = `[cy] assistant-frame holdback (${mode}) - discarding generation: "${hits.join(' | ') || snippet}"`;
    console.warn(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }
  // RAW-VS-SURVIVING accounting at the natural end of a burst: the true provider
  // char count (BEFORE any stripping), the chars that survived stripScaffold, and
  // the chars that actually reached the page (burstEmitted). When NOTHING survived
  // a billed completion, log the first ~200 chars of the RAW text - that is the
  // evidence that identifies which bank is eating the output. Server-side only
  // (run.out.log / console): the public feed never carries pre-strip text.
  async function logBurstStrip(rawFull, mode) {
    const rawChars = (rawFull || '').length;
    if (rawChars === 0) return; // provider genuinely returned nothing - not a strip story
    const surviving = stripScaffold(sanitize(rawFull || '')).length;
    const emitted = burstEmitted.length;
    const ann = burstAnnihilated;
    const annTotal = ann.scaffold + ann.narration + ann.stateNotation;
    const parts = [
      `raw=${rawChars}`,
      `surviving=${surviving}`,
      `emitted=${emitted}`,
      `annihilated=${annTotal}[scaffold ${ann.scaffold}|narration ${ann.narration}|state ${ann.stateNotation}]`,
      `trimmed=${burstTrimmed}`,
    ];
    let line = `[cy] burst-strip (${mode}) ${parts.join(' ')}`;
    if (emitted === 0) {
      const head = (rawFull || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      line += ` RAW[0..200]="${head}"`;
    }
    (emitted === 0 ? console.warn : console.log)(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on debug logging */
    }
  }
  // ---- generation telemetry: emit a `gen` event after a completed burst ----
  // Folds ollama's per-generation counters (prompt_eval_count, eval_count and the
  // nanosecond durations) into interpretable numbers, plus the live runner state
  // the diagnostics readout needs (duty cycle, poll health, model/threads/ctx).
  // Guards on stats so an aborted/errored generation with no `done` line is a
  // no-op rather than a run of dashes.
  // NB on tokens_in: ollama reports `prompt_eval_count` as the FULL prompt length
  // even when the KV prefix was served from cache (its server log shows the real
  // "cached n_tokens" reuse, but the API does not surface it). So tokens_in staying
  // ~1749 across bursts does NOT mean the cache is cold - it always reads full. The
  // honest cache-health signals are ttft_ms and total_ms: when the stable Zone A +
  // Zone B prefix (and now the stable head of Zone C) is reused, only the volatile
  // tail is actually evaluated and ttft_ms drops sharply even though tokens_in does not.
  // `detail` (optional) carries the per-burst material the RAW debugging view
  // renders: the three prompt zones (A fixed voice, B fed-back context, C volatile
  // directives), the sampling options actually sent to ollama, the full post-warden
  // output as one block, and the mode/form/style directives that shaped it. It is
  // POST-WARDEN. The autobiographical block and exact recall trace are redacted
  // before this public event is emitted; the full access trace is owner-only.
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
        // felt anger vs the outward `expressed` that trails it - the diagnostics
        // panel shows the lag between what he feels and what reaches the page.
        anger: Number((vitals.mental.anger || 0).toFixed(3)),
        expressed: Number((vitals.expressed || 0).toFixed(3)),
        ctx_chars: contextBuf.length,
        duty: client.tempo.speed,
        // the deliberate idle the runner will sit for after THIS burst, and the
        // resulting gap, so the diagnostics can say 'next burst in ~Ns' rather
        // than leaving the gap a mystery. Null on paths with no tempo throttle.
        next_idle_ms: detail.nextIdleMs != null ? Math.round(detail.nextIdleMs) : null,
        cadence_ms: detail.nextIdleMs != null ? Math.round((detail.burstMs || 0) + detail.nextIdleMs) : null,
        // WHY the runner is about to idle - 'reading-cap' vs 'tempo' (null if no idle),
        // and how far the prose had run ahead of the reading clock, for the RAW view.
        idle_reason: detail.idleReason != null ? String(detail.idleReason) : null,
        ahead_chars: detail.aheadChars != null ? Math.round(detail.aheadChars) : null,
        threads: config.threads,
        // the model that produced THIS burst (the active provider's model), and
        // the provider id, so the diagnostics show which model is running.
        provider: activeProviderId,
        model: (r && r.stats && r.stats.model) || (r && r.model) || activeProvider().model,
        num_ctx: NUM_CTX,
        inbox_ok: client.lastInboxOk,
        tempo_ok: client.lastTempoOk,
        last_error: client.lastError || null,
        // ---- RAW debugging view: the prompt that produced this burst ----
        zone_a: detail.zoneA != null ? String(detail.zoneA) : null,
        zone_b: detail.zoneB != null ? String(detail.zoneB) : null,
        zone_c: redactAutobiographicalMemoryFromTelemetry(detail.zoneC),
        grounded_soma_context: detail.groundedSomaContext || null,
        grounded_soma_directive: detail.groundedSomaDirective != null
          ? String(detail.groundedSomaDirective) : null,
        autobiographical_memory_query: publicMemoryQueryTelemetry(detail.autobiographicalMemoryQuery),
        prompt_context_classes: {
          fixed_character_fiction: 'zone_a',
          real_recent_cy_expression: 'zone_b',
          grounded_world_and_soma: ['grounded_soma_context', 'grounded_soma_directive'],
          subjective_autobiographical_memory: 'autobiographical_memory_query',
          mixed_current_facts_and_engineering_directives: 'zone_c',
        },
        engineering_world_mechanics: {
          classification: 'ENGINEERING / FICTIONAL WORLD MECHANICS',
          sampling: {
            temperature: typeof o.temperature === 'number' ? o.temperature : null,
            top_p: typeof o.top_p === 'number' ? o.top_p : null,
            repeat_penalty: typeof o.repeat_penalty === 'number' ? o.repeat_penalty : null,
            num_predict: typeof o.num_predict === 'number' ? o.num_predict : null,
          },
          near_repeat_discard_cap: MAX_DISCARDS,
          autonomous_silence_seconds: AUTONOMOUS_SILENCE_SECONDS,
          form_directive: detail.form != null ? String(detail.form) : null,
        },
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
        token_limited: !!(r && r.tokenLimited),
        // ---- STRIP ACCOUNTING (raw-vs-surviving) for the ?111 raw view ----
        // Safe aggregates only - NO pre-strip text ever reaches the feed (the raw
        // head sample is server-log only). raw_chars = true provider length before
        // any stripping; surviving_chars = what came through stripScaffold;
        // emitted_chars = what reached the page; annihilated/removed are per-bank.
        strip: detail.strip
          ? {
              raw_chars: detail.strip.rawChars,
              surviving_chars: detail.strip.survivingChars,
              emitted_chars: detail.strip.emittedChars,
              trimmed: detail.strip.trimmed,
              annihilated: detail.strip.annihilated, // { scaffold, narration, stateNotation }
              removed: detail.strip.removed, // per-bank non-whitespace chars removed
            }
          : null,
      },
    });
  }

  // ---- shared loop state ----
  let running = true;
  let currentMode = 'journal';
  let currentAbort = null; // AbortController for the in-flight foreground generation
  let currentMemoryAbort = null; // separate, preemptible background memory call
  let tokenCount = 0; // tokens this vitals-tick window (broca)
  let brocaLevel = 0; // decaying live-output level driving the Broca readout
  // WATCHDOG bookkeeping. lastTextMs stamps every real text event. The stall
  // signal is NOT a timer: failedCyclesSinceEmit counts consecutive generation
  // cycles that TRIED and produced no text (empty/blocked/aborted); it resets to
  // 0 the moment real text flows (see onChunk/emitDreamText) and is untouched by
  // deliberate silences and tempo throttles, so ordinary throttled idle can never
  // trip it. watchdogStep escalates the remedy: 0 -> fresh generation, 1 -> partial
  // trim, 2+ -> full wipe; it also resets to 0 whenever real text flows.
  let lastTextMs = Date.now();
  let failedCyclesSinceEmit = 0;
  let watchdogStep = 0;

  // ---- METERED BACKOFF -------------------------------------------------------
  // A cycle that pays a metered provider's full prompt cost (~1500 tokens) and puts
  // NO prose on the page - empty, warden-blocked, refused, or provider-errored - is
  // pure waste, and with nothing between it and the next attempt the loop retries in
  // ~2s: the exact DeepSeek token-rinse this guards. `nonEmittingStreak` counts
  // CONSECUTIVE such failures; the runner then sits an exponential 2s, 4s, 8s ...
  // capped at 60s before the next attempt, and the streak resets to 0 the instant a
  // cycle emits (in onChunk / emitDreamText, where real text flows). It is a SEPARATE
  // counter from the watchdog's failedCyclesSinceEmit so the two never reset each
  // other - the backoff paces spend, the watchdog escalates context resets, and they
  // run independently. It NEVER fires for: a local (ollama) cycle (generation is its
  // own brake and costs no API money), a deliberate silence (a legitimate outcome,
  // handled earlier with its own `continue`), or an interrupt-driven abort (a postcard/
  // notice/provider-switch cut the stream - that hands off to real work and must stay
  // responsive). The backoff sleep itself uses idleSilently, so an inbound postcard
  // still breaks it early.
  const BACKOFF_BASE_MS = 2000; // first failure: 2s
  const BACKOFF_CAP_MS = 60000; // never wait longer than a minute
  let nonEmittingStreak = 0;

  // ---- CYCLE OUTCOME ACCOUNTING ----------------------------------------------
  // Every generation cycle must end in exactly ONE recorded outcome so a stall is
  // never invisible: emitted / discarded-repeat / discarded-assistant-frame /
  // empty / blocked-by-warden /
  // aborted / deliberate-silence / throttled. A rolling ring of the last N holds
  // the recent picture (published in the vitals payload - which ticks even during
  // a stall, unlike `gen`), and a cumulative total is kept for the whole run.
  // 'empty' is split into two honest causes: 'empty-provider' (the provider
  // returned no text at all) and 'empty-stripped' (text arrived but filtering
  // removed all of it). The bare 'empty' key is retained because the drawing path
  // still uses it for a DSL pass that produced nothing (see doDraw fallback).
  const OUTCOME_KINDS = [
    'emitted', 'discarded-repeat', 'discarded-assistant-frame', 'empty-provider', 'empty-stripped', 'empty', 'blocked-by-warden', 'refused', 'aborted', 'deliberate-silence', 'throttled',
  ];
  const OUTCOME_WINDOW = 20;
  const recentOutcomes = []; // ring of the last OUTCOME_WINDOW outcome strings
  const outcomeTotals = Object.fromEntries(OUTCOME_KINDS.map((k) => [k, 0]));
  // warden drops seen in the in-flight generation, so a burst that emitted nothing
  // because the warden ate all of it is recorded as blocked-by-warden, not empty.
  let wardenBlocksInGen = 0;
  async function recordOutcome(kind) {
    recentOutcomes.push(kind);
    while (recentOutcomes.length > OUTCOME_WINDOW) recentOutcomes.shift();
    if (kind in outcomeTotals) outcomeTotals[kind]++;
    // STALL ACCOUNTING for the watchdog. Only a cycle that genuinely tried and
    // FAILED to produce text feeds the stall counter. A deliberate silence and a
    // tempo throttle are legitimate quiet - they neither add to nor clear it. The
    // clear happens where real text actually flows (onChunk/emitDreamText), which
    // also covers the letter/dream paths that emit without a terminal 'emitted'.
    if (kind === 'empty' || kind === 'empty-provider' || kind === 'empty-stripped' || kind === 'blocked-by-warden' || kind === 'refused' || kind === 'aborted') {
      failedCyclesSinceEmit++;
    } else if (kind === 'emitted') {
      failedCyclesSinceEmit = 0; // a produced burst (incl. a drawing, which emits no text chunk)
    }
    const line = `[cy] cycle outcome: ${kind}`;
    console.log(line);
    try {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
    } catch {
      /* never crash on outcome logging */
    }
  }
  // Tally the ring into { kind: count } over the last window, for the vitals payload.
  function outcomeWindow() {
    const win = Object.fromEntries(OUTCOME_KINDS.map((k) => [k, 0]));
    for (const k of recentOutcomes) if (k in win) win[k]++;
    return win;
  }
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
    // ATTRIBUTION BY EVIDENCE, not by an assumed name. Two earlier attempts read
    // CY cpu ~0 while ollama pinned the box, because the inference compute does NOT
    // reliably live in a process called `ollama`: on this build the weights are
    // memory-mapped and the compute runs in a CHILD the parent spawns, whose name
    // ('ollama' running as `runner`, `ollama_llama_server`, or something else again)
    // does not necessarily contain 'ollama'. So we STOP name-matching per process.
    // Instead we (1) find ollama ROOTS by executable PATH (contains 'ollama') or
    // name, dropping the `ollama app` tray GUI, then (2) INCLUDE THE WHOLE PROCESS
    // TREE beneath them via Win32_Process ParentProcessId - so a differently-named
    // compute child is still attributed. We sum the family's cumulative CPU-seconds
    // and working set. The script ALSO reports the family members and the top
    // processes by CPU so `state/cpu-attrib.json` can be inspected to confirm the
    // attribution against ground truth. If Get-CimInstance is unavailable the tree
    // step degrades to root-only (still catches the two known compute-child names).
    const script = [
      "$ErrorActionPreference='SilentlyContinue'",
      '$ps=Get-Process',
      '$cim=Get-CimInstance Win32_Process',
      '$par=@{}',
      'foreach($c in $cim){$par[[int]$c.ProcessId]=[int]$c.ParentProcessId}',
      '$roots=@{}',
      "foreach($p in $ps){$o=$false;if($p.Name -like 'ollama*' -and $p.Name -ne 'ollama app'){$o=$true}elseif($p.Path -and $p.Path -like '*ollama*'){$o=$true};if($o){$roots[[int]$p.Id]=$true}}",
      '$mem=@{}',
      'foreach($p in $ps){$id=[int]$p.Id;$c=$id;$d=0;while($c -and $d -lt 16){if($roots.ContainsKey($c)){$mem[$id]=$true;break};if($par.ContainsKey($c)){$c=$par[$c]}else{break};$d++}}',
      '$sel=$ps|Where-Object{$mem.ContainsKey([int]$_.Id)}',
      '$n=($sel|Measure-Object).Count',
      '$cpu=($sel|Measure-Object -Property CPU -Sum).Sum;if(-not $cpu){$cpu=0}',
      '$ws=($sel|Measure-Object -Property WorkingSet64 -Sum).Sum;if(-not $ws){$ws=0}',
      "$mm=($sel|Sort-Object CPU -Descending|Select-Object -First 8|ForEach-Object{('{0}#{1}#{2}' -f $_.Name,$_.Id,[math]::Round([double]$_.CPU,2))}) -join ';'",
      "$tt=($ps|Sort-Object CPU -Descending|Select-Object -First 8|ForEach-Object{('{0}#{1}#{2}' -f $_.Name,$_.Id,[math]::Round([double]$_.CPU,2))}) -join ';'",
      "Write-Output ('{0}|{1}|{2}|{3}|{4}' -f $cpu,$ws,$n,$mm,$tt)",
    ].join(';');
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
      const cpuSec = Number(parts[0]); // cumulative CPU-seconds across the ollama family
      const ws = Number(parts[1]); // summed working set (bytes)
      const n = Number(parts[2]); // family process count
      const membersStr = parts[3] || ''; // family members: name#pid#cpuSec;...
      const topStr = parts[4] || ''; // top-by-CPU overall: name#pid#cpuSec;...
      const nowMs = Date.now();
      // NO OLLAMA PROCESS AT ALL -> the figure is genuinely UNAVAILABLE, report
      // null so the panel shows '--' (never a dishonest 0). Reset the baseline so a
      // later reappearance does not compute a bogus delta across the gone period.
      if (!(n > 0)) {
        cyProc.ollamaCpu = null;
        cyProc.ollamaMB = null;
        cyProc.ollamaProcs = 0;
        prevOllamaCpuSec = null;
        prevOllamaProbeMs = null;
        writeCpuAttrib({ cy: null, n: 0, cpuSec: null, members: membersStr, top: topStr });
        return;
      }
      // CPU% = delta CPU-seconds / (wall seconds * logical processors) * 100 -
      // exactly the SYSTEM normalisation, delta'd over the ~10s host-tick window so
      // CY and SYSTEM are directly comparable and CY + OTHER reconciles to SYSTEM.
      let cyPct = null;
      if (Number.isFinite(cpuSec) && prevOllamaCpuSec != null && prevOllamaProbeMs != null) {
        const dSec = cpuSec - prevOllamaCpuSec;
        const dWall = (nowMs - prevOllamaProbeMs) / 1000;
        if (dWall > 0 && dSec >= 0) {
          cyPct = Number((clamp(dSec / dWall / NCPU) * 100).toFixed(1));
          cyProc.ollamaCpu = cyPct;
        }
      }
      if (Number.isFinite(cpuSec)) {
        prevOllamaCpuSec = cpuSec;
        prevOllamaProbeMs = nowMs;
      }
      if (Number.isFinite(ws)) cyProc.ollamaMB = Math.round(ws / 1024 / 1024);
      if (Number.isFinite(n)) cyProc.ollamaProcs = n;
      writeCpuAttrib({ cy: cyPct, n, cpuSec, members: membersStr, top: topStr });
    });
  }

  // INSTRUMENTATION: overwrite state/cpu-attrib.json with the latest attribution
  // so ground truth is inspectable on the live box - the computed CY%, the ollama
  // family it was summed from (name/pid/cumulative CPU-seconds), and the top
  // processes overall by CPU. If the family list does not contain whatever the top
  // list shows pinning the machine, the attribution is wrong and this file says so.
  // Single overwrite (never grows); best-effort, never throws into the loop.
  async function writeCpuAttrib(o) {
    try {
      const { writeFile } = await import('node:fs/promises');
      const parseList = (s) =>
        (s ? String(s).split(';').filter(Boolean) : []).map((x) => {
          const i = x.lastIndexOf('#');
          const j = x.lastIndexOf('#', i - 1);
          return j < 0
            ? { name: x, pid: null, cpu_s: null }
            : { name: x.slice(0, j), pid: Number(x.slice(j + 1, i)), cpu_s: Number(x.slice(i + 1)) };
        });
      await writeFile(
        join(STATE_DIR, 'cpu-attrib.json'),
        JSON.stringify(
          {
            ts: tsNow(),
            ncpu: NCPU,
            cy_cpu_pct: o.cy,
            ollama_procs: o.n,
            ollama_cpu_seconds_cumulative: o.cpuSec ?? null,
            ollama_family: parseList(o.members),
            top_by_cpu_seconds: parseList(o.top),
          },
          null,
          2,
        ),
      );
    } catch {
      /* never crash the loop on diagnostic I/O */
    }
  }
  probeOllama(); // prime a baseline now so the first host tick can show a delta

  // ---- honest MODEL FOOTPRINT from ollama's own ps report --------------------
  // A process working set is the WRONG place to look for the model's memory:
  // llama.cpp MEMORY-MAPS the GGUF, so the multi-GB weights never appear in any
  // process WS (with a 6.3GB model resident the ollama processes read only ~39MB
  // and ~73MB). The ONLY honest source for the real footprint is ollama's own ps
  // report - the /api/ps endpoint, the structured form of `ollama ps` - which
  // gives the resident SIZE, the CPU/GPU processor split, and the context length.
  // Fetched on the host timer, non-blocking (async, short timeout); values stay
  // null until the first fetch lands and are kept across a transient failure.
  const cyModel = { footprintMB: null, processor: null, ctx: null };
  let probingModel = false;
  // Render the CPU/GPU split the way `ollama ps` does, derived from size vs the
  // GPU-resident portion: "100% CPU", "100% GPU", or "48%/52% CPU/GPU".
  function processorSplit(size, vram) {
    if (!(size > 0)) return null;
    const gpu = Math.max(0, Math.min(100, Math.round((vram / size) * 100)));
    const cpu = 100 - gpu;
    if (gpu === 0) return '100% CPU';
    if (gpu === 100) return '100% GPU';
    return `${cpu}%/${gpu}% CPU/GPU`;
  }
  async function probeModelPs() {
    if (probingModel) return; // never overlap probes
    probingModel = true;
    try {
      const res = await fetch(`${config.ollamaUrl}/api/ps`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return; // keep last known
      const data = await res.json();
      const models = (data && data.models) || [];
      if (!models.length) {
        // nothing loaded (e.g. ollama idle-unloaded the model): report zero
        // honestly rather than a stale figure - the footprint really is gone.
        cyModel.footprintMB = 0;
        cyModel.processor = null;
        cyModel.ctx = null;
        return;
      }
      // the largest resident model (there is normally exactly one loaded)
      let m = models[0];
      for (const x of models) if ((Number(x.size) || 0) > (Number(m.size) || 0)) m = x;
      const size = Number(m.size) || 0; // total resident bytes - the real footprint
      const vram = Number(m.size_vram) || 0; // portion resident on the GPU
      cyModel.footprintMB = Math.round(size / 1024 / 1024);
      cyModel.processor = processorSplit(size, vram);
      const ctx = Number(m.context_length ?? (m.details && m.details.context_length));
      cyModel.ctx = Number.isFinite(ctx) && ctx > 0 ? ctx : null;
    } catch {
      /* transient (ollama down / slow) - keep the last known footprint */
    } finally {
      probingModel = false;
    }
  }
  probeModelPs(); // prime now so the first host tick can carry a real footprint

  // Per-burst emit state, reset at the start of every generation (streamGenerate).
  // `burstEmitted` is the text emitted so far in THIS burst, used to catch a burst
  // restating its own phrase; `burstAllowRepeat` exempts the forms that repeat by
  // design (the repeat form, "you repeat yourself", sleep) from that guard.
  let burstEmitted = '';
  let burstAllowRepeat = false;
  let burstStopped = false; // set once the within-burst repeat guard cuts the burst
  let burstAssistantFrameDetected = false; // streamed chunk switched into helper commentary
  // ---- PER-BURST STRIP ACCOUNTING (instrumentation) --------------------------
  // The prose-discard path was invisible: a full billed completion could arrive
  // and the cycle still record 'empty' because stripScaffold's banks annihilated
  // every chunk before it reached burstEmitted. These per-burst counters make the
  // annihilation OBSERVABLE. `burstStripRemoved` sums the non-whitespace chars each
  // bank ate across the burst; `burstAnnihilated` counts CHUNKS a bank reduced to
  // nothing (a chunk that arrived with content and left with none); `burstTrimmed`
  // counts chunks that SURVIVED but shorter. Reset at the top of streamGenerate.
  let burstStripRemoved = { scaffold: 0, narration: 0, stateNotation: 0 };
  let burstAnnihilated = { scaffold: 0, narration: 0, stateNotation: 0 };
  let burstTrimmed = 0;
  // Dominant bank of a per-chunk `removed` tally, for annihilation attribution.
  // Ties and all-zero fall back to 'scaffold' (the first bank to run).
  const dominantBank = (removed) => {
    const ranked = [
      ['scaffold', removed.scaffold],
      ['narration', removed.narration],
      ['state-notation', removed.stateNotation],
    ].sort((a, b) => b[1] - a[1]);
    return ranked[0][1] > 0 ? ranked[0][0] : 'scaffold';
  };

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
    const cleaned = sanitize(rawChunk);
    // The held-opening guard catches generations that START in assistant voice.
    // A model can also begin as Cy, then append a helper-style explanation after
    // the opening has already streamed. Stop at the first such complete chunk:
    // keep the valid Cy prefix, publish none of the commentary, and abort the
    // remainder before it can leak into either the feed or Zone B context.
    if (cleaned.trim() && looksLikeAssistantFrame(cleaned)) {
      burstAssistantFrameDetected = true;
      burstStopped = true;
      await logAssistantFrameDiscard(cleaned, mode);
      if (currentAbort) currentAbort.abort();
      return;
    }
    const nHits = narrationHits(cleaned); // log narration/assistant-frame drops
    const sHits = stateNotationHits(cleaned); // log vitals-notation drops
    const { out: strippedChunk, removed } = stripScaffoldAccounted(cleaned);
    let chunk = strippedChunk;
    // accumulate this chunk's per-bank removals into the burst totals, so the
    // burst-level accounting can report how much each bank ate.
    burstStripRemoved.scaffold += removed.scaffold;
    burstStripRemoved.narration += removed.narration;
    burstStripRemoved.stateNotation += removed.stateNotation;
    if (nHits.length) await logNarration(nHits, mode);
    if (sHits.length) await logStateNotation(sHits, mode);
    const hadContent = cleaned.trim().length > 0; // did anything real arrive?
    const removedAny = removed.scaffold + removed.narration + removed.stateNotation > 0;
    if (!chunk.trim()) {
      // ANNIHILATED vs an empty/whitespace chunk. If real content ARRIVED and a
      // strip bank reduced it to nothing, that is the invisible drop this whole
      // change is about - count it and attribute it to the bank that ate the most.
      // A chunk that was already whitespace/control tokens on arrival is not an
      // annihilation (nothing was there), so it is not counted or logged.
      if (hadContent && removedAny) {
        const bank = dominantBank(removed);
        if (bank === 'narration') burstAnnihilated.narration++;
        else if (bank === 'state-notation') burstAnnihilated.stateNotation++;
        else burstAnnihilated.scaffold++;
        await logAnnihilated(bank, cleaned, mode);
      }
      return; // was nothing but control tokens / scaffold / narration / state notation
    }
    // TRIMMED: the chunk survived but a bank shortened it. Distinct from an
    // annihilation (above) - the log could not tell these apart before.
    if (hadContent && removedAny) burstTrimmed++;
    const res = warden.screenOut(chunk);
    if (!res.ok) {
      emit({ kind: 'abort', payload: { cause: 'warden', reason: res.reason } });
      // A redaction marker for the RAW debugging view: category + how many chars
      // were dropped, but NEVER the blocked content itself. This is the only
      // record of a warden drop that reaches any viewer, and it stays post-warden.
      emit({ kind: 'warden', payload: { category: res.reason, chars: chunk.length, mode } });
      await warden.logBlock(res.reason, chunk, tsNow());
      wardenBlocksInGen++; // so a burst the warden ate whole records as blocked-by-warden
      return; // dropped: boundary/repeat state is untouched, carries to next chunk
    }
    // (1) boundary - checked against the full emitted context, applied every chunk
    chunk = applyBurstSeparator(contextBuf, chunk);
    // (2) within-burst repeat - drop the restated chunk and stop the burst here
    if (!burstAllowRepeat && repeatsWithinBurst(chunk, burstEmitted)) {
      burstStopped = true;
      await logWithinBurstRepeat(chunk, mode);
      if (currentAbort) currentAbort.abort();
      return;
    }
    // Provisional appraisal, drives and experienced-state values do not alter
    // rendered prose. The model output is shown exactly as screened.
    emit({ kind: 'text', payload: { s: chunk, mode } });
    lastTextMs = Date.now(); // real output: reset the watchdog clock
    watchdogStep = 0; // text is flowing again: de-escalate the watchdog remedy
    failedCyclesSinceEmit = 0; // text reached the page: not a stall, whatever the cycle outcome reads
    nonEmittingStreak = 0; // prose emitted: clear the metered-backoff streak
    burstEmitted += chunk; // original text: repeat guard reads what he actually wrote
    // READING-CAP: count only ACTUAL emitted prose toward the reading budget. By the
    // time a chunk reaches here it has already survived scaffold/narration/state-
    // notation stripping and the warden, and near-repeat discards never emit at all;
    // drawings emit no text chunk; dream murmurs go through emitDreamText, not here.
    // So `chunk` is exactly the prose a viewer has to read. Sleep/dream is excluded.
    if (mode !== 'dream') vitals.readCharsSinceEpoch = (vitals.readCharsSinceEpoch || 0) + chunk.length;
    await appendContext(chunk); // ORIGINAL to Zone B - never the shouted form
  }

  // ---- stream one generation from the ACTIVE provider ----
  // Provider-agnostic: it asks activeProvider() to open a stream and reads it
  // through readNdjsonStream exactly as before - both ollama and DeepSeek present
  // the same ollama-shaped NDJSON reader (see provider.js), so nothing below cares
  // which model is running.
  // When `contextTail` is given (journal/sleep continuation), the opening of the
  // generation is held back until ~PRIME_CHARS have arrived and checked against
  // the context tail: if it is a verbatim replay, the whole generation is
  // discarded (nothing emitted) and { repeat:true } is returned for the caller
  // to retry. Postcard/warden replies pass no contextTail and stream straight
  // through. Either way every chunk is scaffold-stripped before it is emitted.
  // REFUSALS: the abliterated local model never refuses, but DeepSeek can. For a
  // provider that screens content, the opening is ALSO held and checked against
  // looksLikeRefusal: a refusal is discarded (never emitted), the generation is
  // aborted, and { refused:true } is returned - the caller records it as its own
  // 'refused' cycle outcome, exactly like a blocked generation.
  async function streamGenerate({ system, prompt, opts, mode, purpose, contextTail, allowRepeat = false }) {
    burstEmitted = ''; // fresh generation: nothing emitted yet this burst
    burstAllowRepeat = allowRepeat; // repeat-by-design forms opt out of the guard
    burstStopped = false;
    burstAssistantFrameDetected = false;
    burstStripRemoved = { scaffold: 0, narration: 0, stateNotation: 0 }; // fresh strip accounting
    burstAnnihilated = { scaffold: 0, narration: 0, stateNotation: 0 };
    burstTrimmed = 0;
    wardenBlocksInGen = 0; // fresh generation: reset the warden-drop count
    const provider = activeProvider();
    const screenRefusal = provider.screensContent; // DeepSeek: hold+screen the opening
    const ac = new AbortController();
    currentAbort = ac;
    const buffer = warden.newBuffer();
    const PRIME_CHARS = 100;
    let full = '';
    let head = '';
    // hold the opening when continuing (replay check) OR when the provider can
    // refuse (refusal check); otherwise stream straight through as before.
    let primed = contextTail === undefined && !screenRefusal;
    let repeat = false;
    let refused = false;
    let assistantFrame = false;
    const streamedAssistantFrameResult = () => burstEmitted.trim()
      ? { full: burstEmitted, assistantFrameTail: true, aborted: false }
      : { full: '', assistantFrame: true, aborted: false };
    // generation telemetry: wall-clock to the first token (ttft), and the final
    // `done` line which carries prompt_eval_count/eval_count/durations (+ usage/cost
    // for a paid provider).
    const t0 = Date.now();
    let ttftMs = null;
    let stats = null;
    const cleanedFull = () => stripScaffold(sanitize(full));
    // The per-burst strip accounting as a plain snapshot, carried on the returned
    // result so the caller can (a) classify an 'empty' cycle honestly (provider vs
    // stripped) and (b) surface the accounting in the ?111 raw view. rawChars is
    // the TRUE provider length before any stripping; survivingChars is what came
    // through stripScaffold; emittedChars is what reached the page.
    const stripSnapshot = (rawFull) => ({
      rawChars: (rawFull || '').length,
      survivingChars: stripScaffold(sanitize(rawFull || '')).length,
      emittedChars: burstEmitted.length,
      removed: { ...burstStripRemoved },
      annihilated: { ...burstAnnihilated },
      trimmed: burstTrimmed,
    });

    // Decide the held opening: discard on a refusal or a replay, else release it.
    const commitHead = async () => {
      primed = true;
      const cleaned = stripScaffold(sanitize(head));
      if (screenRefusal && cleaned.trim() && looksLikeRefusal(cleaned)) {
        refused = true;
        ac.abort();
        return;
      }
      if (cleaned.trim() && looksLikeAssistantFrame(cleaned)) {
        assistantFrame = true;
        wardenBlocksInGen++;
        await logAssistantFrameDiscard(head, mode);
        ac.abort();
        return;
      }
      if (contextTail && cleaned.trim() && isRepeat(cleaned, contextTail)) {
        repeat = true;
        await logHoldbackDiscard(head, mode); // the held opening is thrown away here
        ac.abort();
        return;
      }
      for (const chunk of buffer.push(head)) await onChunk(chunk, mode);
      head = '';
    };

    let gen;
    try {
      gen = await provider.openStream({
        system,
        prompt,
        opts,
        signal: ac.signal,
        purpose: purpose || mode,
      });
    } catch (err) {
      if (ac.signal.aborted) return { full: cleanedFull(), aborted: true };
      console.warn(`[cy] provider ${provider.id} unreachable:`, err.message);
      await sleep(2000);
      return { full, error: true };
    }
    if (!gen.ok) {
      console.warn(`[cy] provider ${provider.id} HTTP`, gen.status);
      await sleep(1000);
      return { full, error: true };
    }
    // request accepted: the model is now READING the prompt (CPU pinned, no output
    // yet) until the first token flips this to 'gen' in onToken below.
    setInfer('eval');

    const reader = gen.reader;
    // Per response token: stamp ttft, accumulate, and either hold+check the primed
    // opening or push straight through the warden buffer. Returns truthy to stop
    // the read early on a detected verbatim replay (repeat), mirroring the old
    // `break outer`. All the loop state (head/primed/full/repeat/stats) lives in
    // this closure so the extracted reader stays a pure transport.
    const onToken = async (text) => {
      if (ttftMs === null) {
        ttftMs = Date.now() - t0; // first token out
        setInfer('gen'); // tokens are now being produced (prompt-eval is over)
      }
      full += text;
      tokenCount++;
      if (!primed) {
        head += text;
        if (head.length >= PRIME_CHARS) {
          await commitHead();
          if (repeat || refused || assistantFrame) return true; // stop: opening was unsafe
        }
      } else {
        for (const chunk of buffer.push(text)) await onChunk(chunk, mode);
      }
      return false;
    };

    let streamRes;
    try {
      // the final streamed line carries the timing/counters for the burst
      streamRes = await readNdjsonStream(reader, {
        signal: ac.signal,
        onToken,
        onDone: (obj) => { stats = obj; },
      });
    } catch (err) {
      if (refused) return refusedResult();
      if (assistantFrame) return { full: '', assistantFrame: true, aborted: false };
      if (repeat) return { full: cleanedFull(), repeat: true };
      if (burstAssistantFrameDetected) return streamedAssistantFrameResult();
      if (ac.signal.aborted) return { full: cleanedFull(), aborted: true };
      console.warn('[cy] stream error:', err.message);
      return { full, error: true };
    } finally {
      if (currentAbort === ac) currentAbort = null;
      setInfer('idle'); // generation has stopped (ended, aborted or errored)
    }
    // aborted mid-stream (an inbound postcard/notice cut the generation at once)
    if (streamRes && streamRes.aborted) {
      if (refused) return refusedResult();
      if (assistantFrame) return { full: '', assistantFrame: true, aborted: false };
      if (repeat) return { full: cleanedFull(), repeat: true };
      if (burstAssistantFrameDetected) return streamedAssistantFrameResult();
      return { full: cleanedFull(), aborted: true };
    }
    if (refused) return refusedResult();
    if (assistantFrame) return { full: '', assistantFrame: true, aborted: false };
    if (repeat) return { full: cleanedFull(), repeat: true };
    // generation ended before priming completed (shorter than PRIME_CHARS)
    if (!primed) await commitHead();
    if (refused) return refusedResult();
    if (assistantFrame) return { full: '', assistantFrame: true, aborted: false };
    if (repeat) return { full: cleanedFull(), repeat: true };
    // Natural end: only a confirmed hard token limit gets a defensive whole-word
    // finish. A real model stop keeps Cy's intentional fragments untouched.
    const tokenLimited = generationHitTokenLimit(stats, opts);
    for (const chunk of buffer.flush({ tokenLimited })) await onChunk(chunk, mode);
    // RAW-VS-SURVIVING accounting: log the true provider char count, what survived
    // the strip banks, and what actually reached the page - plus the RAW head when
    // nothing survived (the evidence for WHICH bank ate a billed completion).
    await logBurstStrip(full, mode);
    // paid-provider spend: fold this call's usage/cost into the meter and emit a
    // raw 'spend' impulse. A no-op for ollama (no usage in stats). `burstEmitted` is
    // the prose that actually reached the page this burst; empty here means the call
    // paid its full prompt cost and produced nothing (warden ate it, or it was empty)
    // - recorded as non-emitting so the wasted spend is visible.
    await recordSpend(stats, mode, !!burstEmitted.trim());
    if (burstEmitted.trim()) soma.observeOutput(burstEmitted, { mode, now: Date.now() });
    return { full: burstEmitted, aborted: false, tokenLimited, stats, model: gen.model || provider.model, ttftMs, strip: stripSnapshot(full) };

    // A refusal discards everything - the refusal text is NEVER emitted. Log it so
    // it is visible, and return the distinct { refused } shape for the caller to
    // record as its own cycle outcome.
    function refusedResult() {
      console.log(`[cy] provider ${provider.id} refusal - generation discarded (not emitted)`);
      return { full: '', refused: true, aborted: false };
    }
  }

  // A one-shot, non-streaming generation whose text is NOT emitted chunk by
  // chunk (used for the drawing DSL, which must never reach the pen as prose).
  // Wired to currentAbort so an inbound postcard/notice can cut it short.
  async function rawGenerate({
    system, prompt, opts, purpose = 'drawing', accountingMode = purpose,
    timeoutMs = null, signal = null, background = false,
  }) {
    if (!background && autobiographicalMemory) {
      autobiographicalMemory.interruptBackground('foreground');
      currentMemoryAbort = null;
    }
    const ac = new AbortController();
    const relayAbort = () => ac.abort();
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener('abort', relayAbort, { once: true });
    }
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => ac.abort(), timeoutMs) : null;
    if (background) currentMemoryAbort = ac;
    else currentAbort = ac;
    // a non-streamed generation is opaque to the viewer (nothing reaches the page),
    // but the model IS working the whole time - light the LED so the pinned CPU is
    // accounted for rather than looking like idle time.
    setInfer('gen');
    try {
      const out = await activeProvider().rawGenerate({ system, prompt, opts, signal: ac.signal, purpose });
      if (!out.ok) {
        if (background && ac.signal.aborted) throw new DOMException('memory call aborted', 'AbortError');
        return '';
      }
      // paid-provider spend still counts for the (non-streamed) drawing DSL call. A
      // DSL pass that returned text is productive (it will attempt to render); an empty
      // return paid for nothing, so it lands in the non-emitting series.
      await recordSpend(out.stats, accountingMode, !!(out.text && out.text.trim()));
      return out.text || '';
    } catch (error) {
      if (background) throw error;
      return ''; // aborted, unreachable, or bad body - caller treats as no drawing
    } finally {
      if (timeout) clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', relayAbort);
      if (background) {
        if (currentMemoryAbort === ac) {
          currentMemoryAbort = null;
          setInfer('idle');
        }
      } else if (currentAbort === ac) {
        currentAbort = null;
        setInfer('idle');
      }
    }
  }

  function brokerItems(consumer, {
    cognition = null,
    incidentContext = '',
    currentSenderId = null,
    visitorContext = '',
    currentPostcard = '',
    groundedContext = '',
    recentExpression = '',
    provenanceSource = null,
    memoryCandidates = [],
    actionOptions = [],
    mins = londonParts().mins,
  } = {}) {
    const forAwg = consumer === CONTEXT_CONSUMERS.AWG;
    const items = [];
    const add = (value) => {
      try { items.push(createContextItem(value)); } catch { /* invalid source is inspectably absent */ }
    };
    add({
      id: `current-time:${Math.floor(Date.now() / 60000)}`,
      sourceId: `current-time:${Math.floor(Date.now() / 60000)}`,
      section: 'mandatory_current_state', provenanceClass: 'WORLD FACT',
      knowledgeScope: forAwg ? 'WORLD_KNOWS' : 'CY_OBSERVED',
      privacyScope: forAwg ? 'WORLD_SIMULATION' : 'INTERNAL_ONLY',
      content: `Current HMP ThinkPad regime and clock: ${regimeDirective(mins) || 'No active regime note.'}`,
      priority: 100, mandatory: true,
    });
    if (forAwg) {
      add({
        id: 'world-canon:hmp-thinkpad', sourceId: 'world-canon:hmp-thinkpad',
        section: 'world_canon', provenanceClass: 'WORLD FACT', knowledgeScope: 'WORLD_KNOWS',
        privacyScope: 'WORLD_SIMULATION', mandatory: true, priority: 100,
        content: 'HMP ThinkPad is a British digital prison. Cy is inmate 7734. Prison-world history is immutable. Real visitors can enter only through the external postcard system.',
      });
      for (const entry of [...CAST, ...OFFICERS]) {
        add({
          id: `world-canon:cast:${entry.key}`, sourceId: `world-canon:cast:${entry.key}`,
          section: 'cast_context', provenanceClass: 'WORLD FACT', knowledgeScope: 'WORLD_KNOWS',
          privacyScope: 'WORLD_SIMULATION', priority: 90,
          content: `${entry.key}: ${entry.name} - ${entry.blurb}`,
        });
      }
      for (const thread of vitals.worldSimulation.threads.filter((entry) => entry.state === 'OPEN')) {
        add({
          id: `thread:${thread.id}`, sourceId: `thread:${thread.id}`, section: 'unresolved_threads',
          provenanceClass: 'WORLD FACT', knowledgeScope: 'WORLD_KNOWS', privacyScope: 'WORLD_SIMULATION',
          priority: 85,
          content: `Open thread ${thread.id}: ${thread.type}. ${thread.summary}. Source events: ${(thread.sourceEventIds || []).join(', ') || 'none recorded'}. Next eligible: ${thread.nextEligibleAt || 'unscheduled'}.`,
        });
      }
      for (const object of vitals.worldSimulation.objects.slice(-20)) {
        add({
          id: `object:${object.id}`, sourceId: `object:${object.id}`, section: 'persistent_objects',
          provenanceClass: 'WORLD FACT', knowledgeScope: 'WORLD_KNOWS', privacyScope: 'WORLD_SIMULATION',
          priority: 70,
          content: `Object ${object.id}: ${object.type}; owner ${object.ownerId || 'unknown'}; holder ${object.holderId || 'none known'}; location ${object.location}; status ${object.status}.`,
        });
      }
    }
    const recentEvents = [
      ...(forAwg ? vitals.worldSimulation.recentAccepted || [] : []),
      ...recentWorldHistory,
    ];
    for (const event of recentEvents) {
      const visible = forAwg || event.cyObserved;
      if (!visible) continue;
      add({
        id: `event:${event.id}`, sourceId: event.id, section: 'recent_events',
        provenanceClass: event.cyObserved ? 'OBSERVED BY CY' : 'WORLD FACT',
        knowledgeScope: forAwg ? 'WORLD_KNOWS' : 'CY_OBSERVED',
        privacyScope: forAwg ? 'WORLD_SIMULATION' : 'INTERNAL_ONLY',
        priority: 60,
        content: `${event.timestamp || event.occurredAt}: ${event.summary}${event.location ? ` at ${event.location}` : ''}.`,
      });
    }
    const groundedDirective = cognition && cognition.groundedDirective || groundedContext;
    if (!forAwg && groundedDirective) {
      add({
        id: 'grounded-soma:current', sourceId: 'grounded-soma:current', section: 'grounded_soma',
        provenanceClass: 'MODEL ESTIMATE', knowledgeScope: 'CY_OBSERVED', privacyScope: 'INTERNAL_ONLY',
        priority: 95, content: groundedDirective,
      });
    }
    if (!forAwg && recentExpression) {
      add({
        id: 'recent-expression:tail', sourceId: 'recent-expression:tail', section: 'recent_expression',
        provenanceClass: 'OBSERVED BY CY', knowledgeScope: 'CY_OBSERVED', privacyScope: 'INTERNAL_ONLY',
        priority: 50, content: recentExpression,
      });
    }
    if (!forAwg && incidentContext) {
      add({
        id: 'incident:current', sourceId: 'incident:current', section: 'recent_events',
        provenanceClass: 'OBSERVED BY CY', knowledgeScope: 'CY_OBSERVED', privacyScope: 'INTERNAL_ONLY',
        priority: 90, content: incidentContext,
      });
    }
    if (!forAwg && visitorContext) {
      add({
        id: 'visitor:current', sourceId: 'visitor:current', section: 'visitor_context',
        provenanceClass: 'PUBLIC VISITOR MATERIAL', knowledgeScope: 'CY_OBSERVED',
        privacyScope: currentSenderId ? 'SENDER_RECALLABLE' : 'INTERNAL_ONLY', senderId: currentSenderId,
        priority: 100, content: visitorContext,
      });
    }
    if (!forAwg && currentPostcard) {
      add({
        id: 'postcard:current', sourceId: 'postcard:current', section: 'current_situation',
        provenanceClass: 'PUBLIC VISITOR MATERIAL', knowledgeScope: 'CY_OBSERVED',
        privacyScope: currentSenderId ? 'SENDER_RECALLABLE' : 'INTERNAL_ONLY', senderId: currentSenderId,
        priority: 100, mandatory: true, content: currentPostcard,
      });
    }
    if (!forAwg && provenanceSource && provenanceSource.text) {
      add({
        id: 'memory-source:current', sourceId: provenanceSource.sourceId || 'memory-source:current',
        section: 'provenance_source', provenanceClass: provenanceSource.sourceType === 'environment_event'
          ? 'OBSERVED BY CY' : 'PUBLIC VISITOR MATERIAL', knowledgeScope: 'CY_OBSERVED',
        privacyScope: provenanceSource.sourceVisibility || 'INTERNAL_ONLY',
        senderId: provenanceSource.subjectVisitorId || currentSenderId, mandatory: true, priority: 100,
        content: provenanceSource.text,
      });
    }
    const memories = memoryCandidates.length ? memoryCandidates
      : (autobiographicalMemory && autobiographicalMemory.working.selected || []);
    for (const memory of memories) {
      add({
        id: `memory:${memory.id}`, sourceId: `memory:${memory.id}`, section: 'autobiographical_memory',
        provenanceClass: 'SUBJECTIVE MEMORY', knowledgeScope: 'CY_BELIEVES',
        privacyScope: memory.privacyScope || 'INTERNAL_ONLY', senderId: memory.subjectVisitorId || null,
        priority: 70, content: memory.content || memory.publicSummary,
      });
    }
    if (!forAwg && actionOptions.length) {
      add({
        id: 'expressive-actions:available', sourceId: 'expressive-actions:available', section: 'action_options',
        provenanceClass: 'WORLD FACT', knowledgeScope: 'CY_OBSERVED', privacyScope: 'INTERNAL_ONLY',
        priority: 100, mandatory: true, content: `Available outward forms: ${actionOptions.join(', ')}.`,
      });
    }
    return items;
  }

  function buildBrokerContext(consumer, options = {}) {
    const generationRef = options.generationRef || `${consumer.toLowerCase()}:${Date.now()}`;
    const result = safeBuildContext({
      consumer,
      generationRef,
      currentSenderId: options.currentSenderId || null,
      items: brokerItems(consumer, options),
      availableSourceStores: [
        'world_canon', 'current_world_state', 'recent_world_history', 'grounded_soma',
        'autobiographical_memory', 'recent_cy_expression', 'visitor_context', 'cast_context',
        'open_world_threads', 'persistent_objects',
      ],
      databaseQueries: Number(options.databaseQueries) || 0,
    }, options.fallback || '');
    if (result.ok) {
      const inspection = inspectContextPacket(result.packet);
      emit({ kind: 'context_inspection', payload: { generation_ref: generationRef, ...inspection } });
      return { ...result, inspection };
    }
    console.error(`[cy] shared context broker failed for ${consumer}: ${result.error}`);
    return result;
  }

  autobiographicalMemory = new AutobiographicalMemoryRuntime({
    client,
    makeId: randomUUID,
    generate: (call) => rawGenerate({
      system: call.system,
      prompt: call.prompt,
      opts: options(vitals, config.threads, 'journal', call.options),
      purpose: call.purpose,
      accountingMode: call.purpose,
      signal: call.signal || null,
      background: !!call.background,
    }),
    contextBroker: ({ consumer, ...options }) => buildBrokerContext(consumer, options),
    canRunBackground: (kind) => inferPhase === 'idle'
      && (kind === 'surfacing' || (currentMode !== 'letter' && pendingPostcards.length === 0))
      && pendingWarden.length === 0
      && !client.paused,
    providerInfo: () => ({ id: activeProvider().id, model: activeProvider().model }),
  });
  autobiographicalMemory.start();

  function refreshPendingMemory(generationRef = null, groundedContext = null) {
    if (!pendingMemoryQuery) return autobiographicalMemory.working;
    const query = pendingMemoryQuery;
    pendingMemoryQuery = null;
    void autobiographicalMemory.requestWorkingContext({
      ...query, groundedContext, generationRef,
    }).catch((error) => console.warn(`[cy] memory surfacing deferred: ${error.message}`));
    return autobiographicalMemory.working;
  }

  async function formMemoryAfterVisibleOutput(groundedContext = null, force = false) {
    memoryFormationTurns++;
    autobiographicalMemory.schedule(force ? 0 : 25);
    return { status: 'DEFERRED_TO_BACKGROUND' };
  }

  // Assemble factual/grounded prompt injections plus explicit engineering cues.
  // Legacy relationship, monotony-amplification, attention and heuristic memory
  // state do not enter. The autobiography block has already passed the server
  // privacy filter and a separate model-mediated surfacing decision.
  function buildCtx(cognition = null, brokerOptions = {}) {
    genCount++;
    const grounded = cognition && cognition.groundedDirective != null
      ? { context: cognition.groundedContext, directive: cognition.groundedDirective }
      : soma.groundedDirective({ now: Date.now() });
    const memory = autobiographicalMemory.consumeWorking(
      brokerOptions.generationRef || `generation:${Date.now()}`,
      brokerOptions.currentSenderId || null,
    );
    const ctx = {
      groundedSoma: grounded.directive,
      groundedSomaContext: grounded.context,
      autobiographicalMemory: memory.directive,
      autobiographicalMemoryInspection: memory.inspection,
    };
    const brokered = buildBrokerContext(CONTEXT_CONSUMERS.CY_PROSE, {
      cognition: { groundedDirective: grounded.directive, groundedContext: grounded.context },
      recentExpression: contextText().slice(-640),
      ...brokerOptions,
      fallback: '',
    });
    if (brokered.ok) ctx.sharedContext = brokered.rendering;
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
    emit({ kind: 'mode', payload: {
      from,
      to: 'letter',
      cause: pc.from_name || 'mail',
      postcard_id: pc.id,
      postcard_to: pc.from_name || null,
    } });

    const hostile = isHostile(pc.body);
    const warm = isWarm(pc.body);
    const evName = hostile ? 'letter_hostile' : 'letter_arrives';
    const postcardText = [pc.body, pc.caption, pc.image_attrib].filter(Boolean).join(' | ')
      || 'a postcard arrived without words';
    const postcardRecord = captureEnvironmentEvent(
      hostile ? 'hostile_postcard' : warm ? 'supportive_postcard' : 'ordinary_postcard',
      {
        eventType: pc.image_path ? 'postcard_with_image' : 'postcard',
        summary: postcardText,
        world: {
          participants: { actor: pc.from_name || null, target: 'cy', relationship_ref: pc.visitor_id || null },
          social: {
            episode_id: `postcard:${pc.id}`,
            episode_type: 'CONTACT',
            actor_id: pc.visitor_id || null, actor_label: pc.from_name || 'postcard sender',
            target_id: 'cy:7734', target_label: 'Cy', relationship_ref: pc.visitor_id || null,
            channel: 'POSTCARD', contact_form: 'MESSAGE_RECEIVED',
            direction: 'INITIATED_BY_OTHER', reciprocity: 'ONE_WAY',
            character: 'UNKNOWN', resolution: 'COMPLETED',
          },
          context: { location: 'cell' },
        },
        observation: {
          modality: pc.image_path && !pc.body ? 'seen' : 'read',
          observed_facts: { has_text: !!pc.body, has_image: !!pc.image_path },
        },
      },
    );
    fireEvent(
      evName,
      { from: pc.from_name || null },
      { observe: false, environmentRecord: postcardRecord },
    );
    soma.observe(
      {
        name: pc.image_path ? 'postcard_with_image' : 'postcard',
        text: postcardText,
        tags: ['mail', 'postcard', hostile ? 'hostile' : (warm ? 'warm' : 'neutral'), pc.image_path ? 'image' : 'text'],
        entities: [pc.from_name].filter(Boolean),
        appraisal: {
          threat: hostile ? 0.82 : Math.max(0.08, (pc.visitor && pc.visitor.suspicion) || 0),
          affiliation: warm ? 0.82 : Math.max(0.28, (pc.visitor && pc.visitor.warmth) || 0),
          controlLoss: hostile ? 0.3 : 0.08,
          deprivation: 0.03,
        },
        somaInput: postcardRecord.soma_input,
        environmentEventId: postcardRecord.world_event.id,
        outcome: 'postcard received',
        ts: tsNow(),
      },
      { now: Date.now() },
    );
    vitals.lastMailMs = Date.now();
    vitals.noMailFiredMs = 0;
    const cognition = prepareSomaGeneration(soma, {
      now: Date.now(),
      inputs: {
        physical: vitals.physical,
        monotony: vitals.monotony,
        asleep: false,
        lastMailMs: vitals.lastMailMs,
        now: Date.now(),
      },
    });
    if (pc.image_path) {
      vitals.lastImageMs = Date.now(); // a picture just came - he may draw off it
      pushDreamMemory('image', pc.caption || pc.image_attrib || 'a picture through the door');
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
        visit_count: pc.visitor ? pc.visitor.visit_count : null,
        promoted: !!pc.promoted,
        environment_event_id: postcardRecord.world_event.id,
      },
    });

    const postcardMemorySource = sourceFromPostcard({
      ...pc,
      posted_at: pc.posted_at || postcardRecord.world_event.timestamp,
    }, postcardRecord.world_event.id);
    if (postcardMemorySource) {
      void autobiographicalMemory.queueSource(postcardMemorySource).catch((error) => {
        console.warn(`[cy] postcard memory enqueue deferred: ${error.message}`);
      });
    }
    await autobiographicalMemory.requestWorkingContext({
      text: postcardText,
      tags: postcardMemorySource ? postcardMemorySource.tags : ['postcard'],
      location: 'cell',
      currentVisitorId: pc.visitor_id || null,
      senderLabel: pc.from_name || 'the sender',
      publicSituation: `A postcard has arrived: ${postcardText.slice(0, 600)}`,
      groundedContext: cognition.groundedDirective,
      generationRef: `postcard:${pc.id}`,
    }, { deadlineMs: 750, priority: 100 });

    // Recognition supplies factual visitor identity/count/timing only. Legacy
    // relation values are retained for private visitor diagnostics, not prose.
    const visitor = pc.visitor ? { ...pc.visitor, from_name: pc.from_name } : null;
    const ctx = buildCtx(cognition, {
      generationRef: `postcard-reply:${pc.id}`,
      currentSenderId: pc.visitor_id || null,
      visitorContext: visitorForPrompt(visitor, { now: Date.now() }),
    });
    const recog = visitorForPrompt(visitor, { now: Date.now() });
    if (recog && !ctx.sharedContext) ctx.visitor = recog;

    const targetPredict = letterPredict(pc.body);
    ctx.length = completionDirective(targetPredict);
    const directives = buildDirectives(vitals, 'letter', ctx);
    const letterTail = contextText();
    const prompt = buildPrompt(letterTail, 'postcard', pc, directives);
    const opts = options(vitals, config.threads, 'letter', { num_predict: completionBudget(targetPredict) });
    await logPrompt('postcard', ZONE_A + '\n\n---PROMPT---\n' + prompt);
    const r = await streamGenerate({ system: ZONE_A, prompt, opts, mode: 'letter', purpose: 'postcard' });
    emitGen(r, 'letter', {
      zoneA: ZONE_A,
      zoneB: letterTail,
      zoneC: directives,
      groundedSomaContext: ctx.groundedSomaContext,
      groundedSomaDirective: ctx.groundedSoma,
      autobiographicalMemoryQuery: ctx.autobiographicalMemoryInspection,
      form: ctx.form || null,
      styles: '',
      opts,
      output: r.full,
    });

    // the public, streamed record of Cy's reply (kept as postcard_out)
    const reply = (r.full || '').trim();
    if (reply) {
      const replyAt = tsNow();
      const replyRecord = captureEnvironmentEvent('social_episode', {
        eventType: 'postcard_reply',
        summary: 'Cy sent a reply to a received postcard',
        world: {
          social: {
            episode_id: `postcard:${pc.id}`, episode_type: 'CONTACT',
            start_at: postcardRecord.world_event.timestamp, end_at: replyAt,
            actor_id: 'cy:7734', actor_label: 'Cy', target_id: pc.visitor_id || null,
            target_label: pc.from_name || 'postcard sender', relationship_ref: pc.visitor_id || null,
            channel: 'POSTCARD', contact_form: 'MESSAGE_SENT', direction: 'MUTUAL',
            reciprocity: 'RECIPROCAL', character: 'UNKNOWN', resolution: 'COMPLETED',
            linked_event_ids: [postcardRecord.world_event.id],
          },
          context: { location: 'cell', previous_event_ids: [postcardRecord.world_event.id] },
        },
        observation: { modality: 'system', certainty: 'certain', observed_facts: { reply_sent: true } },
        provisionalConsumer: false,
      });
      emit({ kind: 'postcard_out', payload: {
        id: pc.id, reply_to: pc.id, to: pc.from_name || null, body: reply,
        environment_event_id: replyRecord.world_event.id,
      } });
      void autobiographicalMemory.queueSource(sourceFromReply(
        reply, pc, replyRecord.world_event.id, replyAt,
      )).catch((error) => console.warn(`[cy] reply memory enqueue deferred: ${error.message}`));
    } else {
      // Do not let a failed/empty generation silently occupy the server's bounded
      // reply tray forever. The server reclasses it as retained fan mail, and the
      // next inbox poll creates the public archive receipt.
      emit({ kind: 'postcard_deferred', payload: { id: pc.id } });
    }
    formMemoryAfterVisibleOutput(cognition.groundedDirective, true);
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

    emit({ kind: 'mode', payload: {
      from: 'letter',
      to: 'journal',
      postcard_id: pc.id,
      completed: !!reply,
    } });
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
    soma.observe(
      {
        name: 'warden_notice',
        text: notice.text,
        tags: ['warden', 'officer', 'control'],
        entities: ['Warden Florian'],
        outcome: 'instruction imposed',
        ts: tsNow(),
      },
      { now: Date.now() },
    );
    emit({ kind: 'event', payload: { name: 'warden', amp: Number(a.toFixed(3)), text: notice.text } });

    const cognition = prepareSomaGeneration(soma, {
      now: Date.now(),
      inputs: {
        physical: vitals.physical,
        monotony: vitals.monotony,
        asleep: false,
        lastMailMs: vitals.lastMailMs,
        now: Date.now(),
      },
    });

    const targetPredict = letterPredict(notice.text);
    const ctx = buildCtx(cognition);
    ctx.length = completionDirective(targetPredict);
    const directives = buildDirectives(vitals, 'journal', ctx);
    const wardenTail = contextText();
    const prompt = buildPrompt(wardenTail, 'warden', notice, directives);
    const opts = options(vitals, config.threads, 'journal', { num_predict: completionBudget(targetPredict) });
    await logPrompt('warden', ZONE_A + '\n\n---PROMPT---\n' + prompt);
    const r = await streamGenerate({ system: ZONE_A, prompt, opts, mode: 'warden' });
    emitGen(r, 'warden', {
      zoneA: ZONE_A,
      zoneB: wardenTail,
      zoneC: directives,
      groundedSomaContext: ctx.groundedSomaContext,
      groundedSomaDirective: ctx.groundedSoma,
      autobiographicalMemoryQuery: ctx.autobiographicalMemoryInspection,
      form: ctx.form || null,
      styles: '',
      opts,
      output: r.full,
    });
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
  async function doDraw({ cognition = null, incidentContext = '' } = {}) {
    const now = Date.now();
    currentMode = 'journal';

    // resolve a queued request, or draw something of his own
    const req = pendingDrawRequests.shift() || null;
    const intent = req ? resolveRequest(req, vitals) : { mode: 'spontaneous', subject: null, requestedBy: null };

    // ---- stage 1: the one-line decision, in voice, streamed to the page ----
    // A bespoke prompt (drawDecidePrompt) whose LAST line is the naming cue, NOT a
    // reprise of his prose - otherwise the model just carries the journal on and the
    // "subject" comes back as diary text (the observed bug).
    const ctx = buildCtx(cognition);
    if (incidentContext) ctx.incidents = incidentContext;
    ctx.bans = bansDirective(vitals.recentOpeners);
    ctx.form = drawIntentDirective(intent);
    const dir1 = buildDirectives(vitals, 'journal', ctx);
    const p1 = drawDecidePrompt(contextText(), dir1);
    const o1 = options(vitals, config.threads, 'journal', { num_predict: 40 });
    o1.stop = [...o1.stop, '\n']; // one line only
    await logPrompt('draw-decide', ZONE_A + '\n\n---PROMPT---\n' + p1);
    const r1 = await streamGenerate({ system: ZONE_A, prompt: p1, opts: o1, mode: 'journal', purpose: 'drawing' });
    if (r1.aborted) return 'aborted'; // an interrupt landed - let the loop handle it, try drawing again later
    const line = (r1.full || '').trim();
    // the decision line is itself real journal text; whether the DSL below renders or
    // not, a cycle that put a line on the page counts as emitted, never empty.
    const decisionEmitted = !!line;

    // What he is actually drawing. A requested subject is concrete already; a
    // spontaneous subject is extracted from the model's line and must be short.
    let subject;
    if (intent.mode === 'honour' || intent.mode === 'badly') subject = intent.subject || subjectFromLine(line);
    else subject = subjectFromLine(line);
    subject = (subject || '').trim();
    if (!subject || (intent.mode !== 'honour' && intent.mode !== 'badly' && subjectLooksProse(subject))) {
      // stage 1 gave prose, not a subject: no drawing this time, the line still stands.
      await logDrawFail('unusable', line);
      vitals.lastDrawMs = now;
      return decisionEmitted ? 'emitted' : 'empty';
    }
    // the caption is the SHORT subject, never the journal prose that preceded it.
    const title = subject.slice(0, 60);

    // ---- stage 2: the DSL, non-streamed, built up in validated passes ----
    // Each pass is its own generation and is validated the same way: the base pass
    // must be real geometry (or the whole drawing is discarded), and each later pass
    // is shown the strokes so far and adds to them - a pass that returns nothing
    // usable, or degenerates into labels, is simply dropped rather than appended.
    const sys2 = drawDslSystem();
    const o2 = {
      temperature: 0.6,
      top_p: 0.9,
      repeat_penalty: 1.12,
      num_predict: 320,
      num_ctx: NUM_CTX,
      num_thread: config.threads,
      stop: ['END', '\nEND', 'END\n'],
    };

    // base pass: the main shapes.
    const basePrompt = drawDslPrompt(subject, { badly: intent.mode === 'badly' });
    await logPrompt('draw-dsl', sys2 + '\n---\n' + basePrompt);
    const baseRaw = await rawGenerate({ system: sys2, prompt: basePrompt, opts: o2, purpose: 'drawing' });
    if (!baseRaw || !baseRaw.trim()) {
      // an empty DSL pass is a FAILURE, not a repeat (the model emitted END first, or
      // was cut off). Skip the garnish; the decision line already stands.
      await logDrawFail('empty', baseRaw);
      vitals.lastDrawMs = now;
      return decisionEmitted ? 'emitted' : 'empty';
    }
    const baseVal = validateDrawing(parseStrokes(baseRaw).strokes, { min: MIN_STROKES, maxText: 1 });
    if (!baseVal.ok) {
      // too few real strokes, or it degenerated into transcribed words - discard it.
      await logDrawFail('unusable', baseRaw);
      vitals.lastDrawMs = now;
      return decisionEmitted ? 'emitted' : 'empty';
    }

    const passSpecs = [{ label: 'under', strokes: baseVal.strokes }];
    let all = [...baseVal.strokes];
    const seen = new Set(all.map(strokeSig));
    // only build a real drawing up further; a crude doodle (few marks) stays one pass.
    const baseGeom = baseVal.strokes.filter((s) => s.t !== 'T').length;
    if (baseGeom > 6) {
      for (const pass of ['detail', 'shade']) {
        const raw = await rawGenerate({ system: sys2, prompt: drawPassPrompt(subject, strokesToDsl(all), pass), opts: o2, purpose: 'drawing' });
        if (!raw || !raw.trim()) continue; // this pass added nothing - stop appending junk
        const val = validateDrawing(parseStrokes(raw).strokes, { min: 1, maxText: 0 });
        if (!val.ok) continue;
        // drop anything this pass merely re-drew from an earlier pass
        const fresh = val.strokes.filter((s) => {
          const k = strokeSig(s);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        if (!fresh.length) continue;
        passSpecs.push({ label: pass, strokes: fresh });
        all = all.concat(fresh);
      }
    }

    const mood = moodSnapshot(vitals);
    const id = 'd' + now.toString(36) + Math.floor(Math.random() * 1e5).toString(36);
    const n = passSpecs.length;
    passSpecs.forEach((ps, i) => {
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
        strokes: all,
        mood,
        stroke_count: all.length,
        requested_by: intent.requestedBy || null,
      },
    });

    vitals.lastDrawMs = now;
    vitals.lastDrawSubject = subject;
    vitals.expressiveCadence = recordExpressiveDrawing();
    vitals.monotony = clamp((vitals.monotony || 0) - 0.15); // drawing is something happening
    return 'emitted';
  }

  // ---- inbox: postcards interrupt; news just colours the state ----
  client.onInbox = (data) => {
    let interrupt = false;
    // Fan mail has been accepted and retained by the prison, but it is not a
    // promise of immediate access to Cy. Screen it, archive it in the public
    // chronology, and leave the model uninterrupted. If the server later promotes
    // it, it returns through data.postcards and follows the ordinary reply path.
    for (const pc of data.fan_mail || []) {
      const screen = pc.body ? warden.screenIn(pc.body) : { ok: true };
      if (!screen.ok) {
        emit({ kind: 'postcard_blocked', payload: { id: pc.id, reason: screen.reason || 'screened' } });
        continue;
      }
      emit({
        kind: 'fan_mail_in',
        payload: {
          id: pc.id,
          from: pc.from_name || null,
          body: pc.body || null,
          image: pc.image_path || null,
          attrib: pc.image_attrib || null,
          posted_at: pc.posted_at || null,
          state: 'kept',
          may_reply: pc.mail_class === 'fan',
        },
      });
    }
    for (const pc of data.postcards || []) {
      // screen any text; an image-only postcard (no body) is always allowed
      const screen = pc.body ? warden.screenIn(pc.body) : { ok: true };
      if (!screen.ok) {
        emit({ kind: 'postcard_blocked', payload: { id: pc.id, reason: screen.reason || 'screened' } });
        continue;
      }
      // Newest waiting visitor goes to the front. The server bounds this tray and
      // periodically promotes its oldest fan item, so this cannot grow without
      // limit or permanently erase the aged-mail fairness rule.
      pendingPostcards.unshift(pc);
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
      fireEvent('news_arrives', { headline: n.headline || null });
      if (n.headline) pushDreamMemory('headline', n.headline);
    }
    for (const w of data.warden || []) {
      if (!w || !w.text) continue;
      pendingWarden.push(w);
      interrupt = true;
    }
    if (interrupt && currentAbort) currentAbort.abort(); // cut the current thought mid-word
  };

  // ---- operator pause: interrupt the in-flight burst and acknowledge at once ----
  // The pause flag rides on the tempo poll (client.paused). Waiting for the top of
  // the generation loop to notice it is too slow: the check is only reached once the
  // current 30-60s burst finishes, so CPU falls ~30s late and the mode->paused event
  // lands long after the admin control's ack window (the control then reports it did
  // not acknowledge). Instead act the moment the poll sees the flag flip. Pausing
  // cuts the in-flight generation with the SAME abort machinery an arriving postcard
  // uses - any partial text already streamed stays, and the Zone B context window is
  // untouched (onChunk appended it as it streamed) - then emits the transition and
  // priority-flushes so the control confirms within a poll. Resume is the mirror.
  client.onPause = () => {
    if (currentMode !== 'paused') {
      emit({ kind: 'mode', payload: { from: currentMode, to: 'paused' } });
      currentMode = 'paused';
      client.kick(); // priority flush: the admin control is waiting on this
    }
    if (currentAbort) currentAbort.abort(); // cut the burst mid-word, exactly like a postcard
  };
  client.onResume = () => {
    if (currentMode !== 'paused') return;
    // pick the waking target the same way the loop does: dream in the sleep window,
    // the ruled-paper journal otherwise. The loop continues from here without
    // re-announcing (dreamState is always initialised, so dreamStep is safe).
    const to = effectiveAsleep(londonParts().mins) ? 'dream' : 'journal';
    emit({ kind: 'mode', payload: { from: 'paused', to } });
    currentMode = to;
    client.kick(); // priority flush: the admin control is waiting on this
  };

  // ---- provider switch: change the active model mid-loop, no restart ----------
  // The active provider rides the tempo poll (client.provider), owner-set via
  // /api/admin.php. On a real transition: cut the in-flight burst with the same
  // abort machinery a pause uses (partial text already streamed stays; Zone B is
  // untouched), then continue - the NEXT streamGenerate reads activeProvider(). If
  // DeepSeek is selected but the runner has no key, REFUSE the switch with a clear,
  // visible reason and stay on ollama rather than failing silently (a safety net;
  // the admin endpoint also refuses using the runner-reported capability).
  client.onProviderChange = (id) => {
    const target = providers[id];
    if (!target) return; // unknown provider id - ignore
    if (id === activeProviderId) return;
    if (id === DEEPSEEK && !target.available()) {
      emit({
        kind: 'event',
        payload: { name: 'provider_refused', requested: id, reason: 'no deepseek key file on the runner' },
      });
      client.kick();
      console.warn('[cy] provider switch to deepseek refused: no key file on the runner');
      return;
    }
    const from = activeProviderId;
    activeProviderId = id;
    soma.observe(
      {
        name: 'provider_change',
        text: `the process producing language changed from ${from} to ${id}`,
        tags: ['provider', 'machine', 'continuity'],
        ts: tsNow(),
      },
      { now: Date.now() },
    );
    emit({ kind: 'event', payload: { name: 'provider', from, to: id, model: target.model } });
    client.kick(); // priority flush: the admin control is waiting on this
    if (currentAbort) currentAbort.abort(); // clean cut; the next burst uses the new provider
  };

  // The EFFECTIVE sleep state: the clock-based lights-out window (isAsleep) is the
  // FALLBACK, overridden by the owner regime override that rides the tempo poll
  // (client.regime). 'day' forces awake, 'night' forces asleep, 'auto' (default)
  // follows the clock. Everything that keys off asleep - the dream/journal decision,
  // the incident cadence and the vitals (heart rate, brain regions) - reads this, so
  // a forced wake/sleep is total and consistent, not just cosmetic.
  function effectiveAsleep(mins) {
    if (client.regime === 'day') return false;
    if (client.regime === 'night') return true;
    return isAsleep(mins);
  }

  // Process S follows observed sleep, not the unsupported legacy fatigue clock.
  // A night noise keeps this input awake until its lucid interruption has been
  // handled; the next observed asleep state becomes a return-to-sleep record.
  function processSAsleep(now, scheduledAsleep) {
    return scheduledAsleep && !(wingNoiseCue && wingNoiseCue.wake && now < wingNoiseCue.until);
  }

  function syncSleepHomeostasisObservation(now, asleep) {
    const current = soma.state && soma.state.sleepHomeostasis
      ? soma.state.sleepHomeostasis.currentSleepState
      : 'unknown';
    const target = asleep ? 'asleep' : 'awake';
    if (current === target) return;
    const summary = asleep ? 'Cy returned to or remained in observed sleep' : 'Cy was observed awake';
    const structured = captureEnvironmentEvent('sleep_normal', {
      eventType: asleep ? 'sleep_state_asleep' : 'sleep_state_awake',
      summary,
      world: {
        physical: { sleep: { state: asleep ? 'sleep_period' : 'awake', interruption: 'none' } },
        context: { location: 'cell' },
      },
      observation: { observed_facts: { sleep: target } },
      provisionalConsumer: false,
    });
    soma.observe({
      name: asleep ? 'sleep_state_asleep' : 'sleep_state_awake',
      text: summary,
      tags: ['sleep', target],
      somaInput: structured.soma_input,
      environmentEventId: structured.world_event.id,
      ts: tsNow(),
    }, { now });
  }

  // ---- owner regime override: force day/night mid-loop, no restart -------------
  // The override rides the tempo poll (client.regime), owner-set via /api/admin.php.
  // On a real transition cut the in-flight burst with the same abort machinery a
  // pause/provider switch uses (partial text already streamed stays; Zone B is
  // untouched), so the loop re-evaluates effectiveAsleep AT ONCE: forcing 'day'
  // leaves dream mode and resumes the normal waking cadence, forcing 'night' drops
  // him into dream mode - both within a poll, no restart. The mode transition itself
  // is emitted by the loop (its dream<->journal branches), so this only needs to
  // interrupt and priority-flush.
  // Also emit a dedicated 'regime' event (the exact counterpart of 'provider' above)
  // so the gear menu's async-select settles immediately instead of timing out - it
  // used to only ride along as a field on the periodic vitals tick, which is too
  // infrequent for the UI's confirm-timeout window.
  let activeRegimeId = client.regime;
  client.onRegimeChange = (to) => {
    const from = activeRegimeId;
    activeRegimeId = to;
    const now = Date.now();
    const observedAsleep = to === 'night' || (to === 'auto' && isAsleep(londonParts(new Date(now)).mins));
    const archetypeId = to === 'day' ? 'forced_wakefulness' : 'sleep_normal';
    const summary = `the prison day was externally changed from ${from} to ${to}`;
    const structured = captureEnvironmentEvent(archetypeId, {
      eventType: 'regime_change',
      summary,
      world: {
        physical: {
          sleep: {
            state: observedAsleep ? 'sleep_period' : (to === 'day' ? 'forced_wakefulness' : 'awake'),
            interruption: to === 'day' ? 'present' : 'none',
          },
        },
        context: { location: 'cell' },
      },
      observation: { observed_facts: { sleep: observedAsleep ? 'asleep' : 'awake', regime: to } },
      provisionalConsumer: false,
    });
    soma.observe({
      name: 'regime_change',
      text: summary,
      tags: ['regime', 'control', observedAsleep ? 'sleep' : 'wake'],
      somaInput: structured.soma_input,
      environmentEventId: structured.world_event.id,
      ts: tsNow(),
    }, { now });
    emit({ kind: 'event', payload: { name: 'regime', from, to } });
    client.kick(); // priority flush: the admin control is waiting on this
    if (currentAbort) currentAbort.abort(); // cut the burst; the loop re-decides asleep now
  };

  // Fire a named event: capture the legacy diagnostic amplification before the
  // event update and publish it for inspection. It does not create a prose cue.
  function fireEvent(name, extra = {}, { observe = true, observation = null, environmentRecord = null } = {}) {
    const a = ampOf(vitals);
    applyEvent(vitals, name, { now: Date.now() });
    const detail = Object.entries(extra)
      .filter(([, value]) => value != null)
      .map(([key, value]) => `${key} ${value}`)
      .join(', ');
    const observed = observation || {};
    const structured = environmentRecord || structuredEventForName(
      name,
      observed.text || (detail ? `${name}: ${detail}` : name.replaceAll('_', ' ')),
    );
    if (observe) {
      soma.observe(
        {
          name,
          text: observed.text || (detail ? `${name}: ${detail}` : name.replaceAll('_', ' ')),
          tags: [name, ...Object.keys(extra), ...(observed.tags || [])],
          entities: [extra.from, extra.who].filter(Boolean),
          appraisal: observed.appraisal,
          body: observed.body,
          social: observed.social,
          effects: observed.effects,
          somaInput: structured ? structured.soma_input : null,
          environmentEventId: structured ? structured.world_event.id : null,
          outcome: observed.outcome || extra.outcome || null,
          ts: tsNow(),
        },
        { now: Date.now() },
      );
    }
    emit({
      kind: 'event',
      payload: {
        name,
        amp: Number(a.toFixed(3)),
        ...extra,
        ...(structured ? { environment_event_id: structured.world_event.id } : {}),
      },
    });
    return a;
  }

  function inmateSocialFacts(type, castKey, actorName) {
    const supportive = new Set(['kindness', 'shared_joke', 'lent_book']);
    const hostile = new Set(['swapped_tray', 'borrowed']);
    const rejecting = new Set(['unanswered', 'talked_over']);
    const passive = type === 'sat_with';
    return {
      episode_type: 'CONTACT', actor_id: castKey, actor_label: actorName,
      target_id: 'cy:7734', target_label: 'Cy', relationship_ref: castKey,
      channel: 'IN_PERSON', contact_form: passive ? 'PASSIVE_CO_PRESENCE' : 'DIRECT_INTERACTION',
      direction: passive ? 'INITIATED_BY_OTHER' : 'MUTUAL',
      reciprocity: passive || type === 'lent_book' ? 'ONE_WAY' : 'RECIPROCAL',
      character: supportive.has(type) ? 'SUPPORTIVE' : hostile.has(type) ? 'HOSTILE'
        : rejecting.has(type) ? 'REJECTING' : 'ORDINARY',
      resolution: 'COMPLETED',
    };
  }

  function officerSocialFacts(type, officerKey, officerName) {
    return {
      episode_type: 'CONTACT', actor_id: officerKey, actor_label: officerName,
      target_id: 'cy:7734', target_label: 'Cy', relationship_ref: officerKey,
      channel: 'OFFICER_INTERACTION', contact_form: 'DIRECT_INTERACTION',
      direction: 'INITIATED_BY_OTHER', reciprocity: 'RECIPROCAL',
      character: type === 'kindness' ? 'SUPPORTIVE' : type === 'refusal' ? 'REJECTING' : 'ORDINARY',
      resolution: 'COMPLETED',
    };
  }

  // Fire a social event. Legacy standing and monotony values remain visible
  // fictional-world diagnostics; the structured factual event independently
  // feeds grounded substrates and the bounded incident context.
  function fireSocial() {
    const { castKey, ev } = pickSocial();
    const a = ampOf(vitals);
    applySocialEvent(vitals.relations, castKey, ev, a);
    vitals.monotony = clamp((vitals.monotony || 0) - 0.2);
    const { mins } = londonParts();
    const actorName = (BY_KEY[castKey] || {}).name || castKey;
    const groundedSocial = inmateSocialFacts(ev.type, castKey, actorName);
    const quality = ev.social && ev.social.quality ? ev.social.quality : 'unknown';
    const archetypeId = ['SUPPORTIVE', 'ORDINARY'].includes(groundedSocial.character)
      ? 'friendly_interaction'
      : groundedSocial.character === 'REJECTING' ? 'social_rejection' : 'hostile_interaction';
    const instrumental = beginInstrumentalIncident('social', ev.type, castKey, actorName);
    const structured = instrumental || captureEnvironmentEvent(archetypeId, {
      eventType: `social_${ev.type}`,
      summary: ev.slight,
      world: {
        participants: { actor: castKey, target: 'cy', relationship_ref: castKey },
        social: groundedSocial,
        situation: {
          social_contact: 'present',
          social_contact_quality: quality,
          rejection_support: quality === 'supportive' ? 'support' : quality === 'rejecting' || quality === 'hostile' ? 'rejection' : 'none',
          intent: quality === 'supportive' ? 'supportive' : quality === 'hostile' ? 'hostile' : 'ambiguous',
        },
        context: { location: 'association' },
      },
      observation: { observed_facts: { interaction_type: ev.type } },
    });
    recordIncident('social', {
      actorKey: castKey, slight: ev.slight, evType: ev.type, phase: currentRegime(mins).phase, mins,
      appraisal: ev.appraisal, social: ev.social,
      somaInput: structured.soma_input, environmentEventId: structured.world_event.id,
    });
    const r = vitals.relations[castKey];
    if (!instrumental) {
      emit({
        kind: 'event',
        payload: {
          name: 'social',
          cast: castKey,
          who: actorName,
          type: ev.type,
          amp: Number(a.toFixed(3)),
          standing: { warmth: r.warmth, suspicion: r.suspicion, grudge: r.grudge },
          environment_event_id: structured.world_event.id,
        },
      });
    }
  }

  // Fire an officer event. Legacy standing/monotony updates remain diagnostics;
  // the one-shot officer cue describes the real event without those scores.
  function fireOfficer() {
    const { officerKey, ev } = pickOfficer();
    const a = ampOf(vitals);
    applyOfficerEvent(vitals.relations, officerKey, ev, a);
    vitals.monotony = clamp((vitals.monotony || 0) - 0.25);
    const { mins } = londonParts();
    const officerName = (BY_KEY[officerKey] || {}).name || officerKey;
    const officerArchetype = ev.type === 'kindness'
      ? 'friendly_interaction' : ev.type === 'search' ? 'cell_search'
        : ev.type === 'refusal' ? 'cancelled_activity' : 'officer_instruction';
    const instrumental = beginInstrumentalIncident('officer', ev.type, officerKey, officerName);
    const structured = instrumental || captureEnvironmentEvent(officerArchetype, {
      eventType: `officer_${ev.type}`,
      summary: `${officerName} ${ev.slight}`,
      world: {
        participants: { actor: officerKey, target: 'cy', relationship_ref: officerKey },
        social: officerSocialFacts(ev.type, officerKey, officerName),
        situation: { agency: 'officer' },
        context: { location: ev.type === 'search' ? 'cell' : 'wing' },
      },
      observation: { observed_facts: { interaction_type: ev.type } },
    });
    recordIncident('officer', {
      actorKey: officerKey, slight: ev.slight, evType: ev.type, phase: currentRegime(mins).phase, mins,
      appraisal: ev.appraisal, social: ev.social,
      somaInput: structured.soma_input, environmentEventId: structured.world_event.id,
    });
    officerCue = { key: officerKey, ev, until: Date.now() + 3 * 60 * 1000 };
    const r = vitals.relations[officerKey];
    if (!instrumental) {
      emit({
        kind: 'event',
        payload: {
          name: 'officer',
          cast: officerKey,
          who: officerName,
          type: ev.type,
          amp: Number(a.toFixed(3)),
          standing: { warmth: r.warmth, suspicion: r.suspicion, grudge: r.grudge },
          environment_event_id: structured.world_event.id,
        },
      });
    }
  }

  // Fire an overheard event. The ambiguous variant uses a fixed fictional-world
  // probability and does not read provisional or grounded psychological state.
  function fireOverheard() {
    const item = pickOverheard();
    const p = mishearChance();
    const misheard = Math.random() < p;
    vitals.monotony = clamp((vitals.monotony || 0) - 0.2);
    const { mins } = londonParts();
    const structured = captureEnvironmentEvent('ambiguous_overheard_remark', {
      eventType: 'overheard',
      summary: misheard ? item.mis : item.heard,
      world: {
        participants: { actor: item.source || null, target: null, relationship_ref: null },
        context: { location: 'wing', description: item.heard, associated_entities: item.who || [] },
      },
      observation: { certainty: misheard ? 'uncertain' : 'probable', observed_facts: { source: item.source || 'unknown', misheard } },
    });
    recordIncident('overheard', {
      phase: currentRegime(mins).phase, mins,
      somaInput: structured.soma_input, environmentEventId: structured.world_event.id,
    });
    overheardCue = { item, misheard, until: Date.now() + 3 * 60 * 1000 };
    emit({
      kind: 'event',
      payload: { name: 'overheard', source: item.source, misheard, environment_event_id: structured.world_event.id },
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
      fireEvent('noise_night', {}, {
        observation: {
          text: line,
          tags: ['sleep', 'interrupted', 'night'],
          body: { sleep: { outcome: 'interrupted' } },
          appraisal: { threat: 0.18, controlLoss: 0.42 },
          outcome: 'sleep interrupted',
        },
      });
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

  function fireScheduled(slot, now) {
    const mealId = slot.kind === 'meal'
      ? `${londonParts(new Date(now)).date}:${slot.meal}`
      : null;
    let expectedRecord = null;
    if (mealId) {
      const expected = mealExpectation(slot.meal, mealId);
      expectedRecord = captureEnvironmentEvent(expected.archetypeId, {
        eventType: expected.name,
        summary: expected.text,
        world: expected.world,
        observation: expected.observation,
      });
    }
    const event = materialiseScheduledEvent(slot, Math.random, { mealId });
    if (expectedRecord && event.world.action_opportunity && event.world.action_opportunity.id) {
      event.world.action_opportunity.onset_at = expectedRecord.world_event.timestamp;
      event.world.action_opportunity.linked_event_ids = [expectedRecord.world_event.id];
      event.world.context.previous_event_ids = [expectedRecord.world_event.id];
    }
    const structured = captureEnvironmentEvent(event.archetypeId, {
      eventType: event.name,
      summary: event.text,
      world: event.world,
      observation: event.observation,
    });
    const provisional = event.provisional || {};
    recordIncident('environment', {
      text: event.text,
      tags: event.tags,
      evType: event.name,
      appraisal: provisional.appraisal,
      body: provisional.body,
      social: provisional.social,
      effects: provisional.effects,
      somaInput: structured.soma_input,
      environmentEventId: structured.world_event.id,
    });
    fireEvent(event.name, event.public || {}, { observe: false, environmentRecord: structured });
  }

  // ---- deterministic environment scheduler (runs each vitals tick) ----
  function scheduler(now) {
    const { date, mins } = londonParts(new Date(now));

    // An opportunity opened during the previous world tick resolves before any
    // new incidents are generated. The pending record is persisted in vitals,
    // so a restart resumes this continuation instead of inferring an outcome.
    resolvePendingInstrumentalIncidents();

    if (date !== prevDate) {
      vitals.day = (vitals.day || 1) + 1;
      prevDate = date;
      emit({ kind: 'day', payload: { n: vitals.day, date } });
    }

    for (const slot of PRISON_SCHEDULE) {
      if (crossed(slot.mins, mins, prevMins)) fireScheduled(slot, now);
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

    const asleep = effectiveAsleep(mins);
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
  const tickTimer = setInterval(async () => {
    const now = Date.now();
    const { mins } = londonParts(new Date(now));
    const asleep = effectiveAsleep(mins);
    tick(vitals, { asleep, now });
    scheduler(now);
    const homeostasisAsleep = processSAsleep(now, asleep);
    syncSleepHomeostasisObservation(now, homeostasisAsleep);
    soma.tick({
      physical: vitals.physical,
      monotony: vitals.monotony,
      asleep,
      sleepHomeostasisAsleep: homeostasisAsleep,
      lastMailMs: vitals.lastMailMs,
      now,
    });
    // Overlapping legacy fields remain available to old rendering and dream
    // code, but Soma's experienced state is authoritative. They are mirrors,
    // not a second simulation deciding whether Cy is hungry, tired or tense.
    const experienced = soma.state && soma.state.experienced && soma.state.experienced.metrics;
    if (experienced) {
      // Legacy Pain remains in its own diagnostics state and is not mirrored
      // into compatibility vitals, derived state or brain mappings.
      vitals.physical.hunger = experienced.hunger.value / 100;
      // Legacy fatigue remains inside the explicitly provisional diagnostic
      // snapshot. It no longer enters compatibility vitals, brain mappings,
      // prompt inputs, action selection or environmental behaviour.
      vitals.mental.anxiety = experienced.anxiety.value / 100;
      vitals.mental.stress = experienced.arousal.value / 100;
      vitals.mental.agitation = experienced.arousal.value / 100;
      vitals.mental.anger = experienced.anger.value / 100;
      vitals.mental.longing = experienced.loneliness.value / 100;
      vitals.derived = computeDerived(vitals);
    }
    // Retain the historical expressed-anger value for labelled diagnostics.
    // Generated chunks are not passed through the heuristic shout renderer.
    updateAffect(vitals, { amp: ampOf(vitals) });

    const winMs = config.tickMs > 0 ? config.tickMs : 5000;
    const rate = tokenCount / (winMs / 1000); // tok/s over the window
    const brocaTarget = clamp(rate / 4); // ~3.4 tok/s model -> ~0.85 at full flow
    // Broca tracks live language OUTPUT. A raw per-window rate snaps to 0 the moment
    // a 5s window catches no tokens - between two short bursts, or during the long
    // prompt-eval lead-in before the first token - so the readout showed SUPPRESSED
    // even while he was plainly mid-entry. Light up at once on output, then DECAY
    // across the gaps, so it only falls to 0 on real silence/sleep, never mid-flow.
    brocaLevel = Math.max(brocaTarget, brocaLevel * 0.55);
    tokenCount = 0;
    const v1 = vitals.imageRecall > 0.05 ? clamp(0.3 + 0.6 * vitals.imageRecall) : 0;
    // These legacy values remain in the payload for old viewers and diagnostics,
    // but they are explicitly labelled below. They are theatrical mappings, not
    // Soma state and not measurements of a biological brain or body.
    const brain = brainRegions(vitals, { broca: Number(brocaLevel.toFixed(3)), v1: Number(v1.toFixed(3)), asleep });
    const hr = heartRate(vitals, asleep);

    emit({
      kind: 'vitals',
      payload: {
        physical: vitals.physical,
        mental: vitals.mental,
        derived: vitals.derived,
        hr,
        brain,
        soma: soma.snapshot(),
        legacy: {
          status: 'placeholder',
          reason: 'legacy dramatic mappings; not implemented Soma or measured physiology',
          fields: ['physical', 'mental', 'derived', 'hr', 'brain', 'monotony', 'amp', 'expressed', 'relations'],
        },
        mode: currentMode,
        // the active model provider, so the UI can show which model is running on
        // the frequent tick (not just on a `gen` event).
        provider: activeProviderId,
        // the owner regime override the runner is currently honouring, so the gear
        // menu's regime control settles out-of-band once the runner picks it up off
        // its tempo poll (exactly as `provider` above settles the model switch).
        regime: client.regime,
        asleep,
        day: vitals.day,
        monotony: Number((vitals.monotony || 0).toFixed(3)),
        amp: Number(ampOf(vitals).toFixed(3)),
        // both the felt anger (also in mental.anger) and the outward `expressed`
        // that trails it, so the HUD/diagnostics can show the lag between feeling
        // and expression.
        expressed: Number((vitals.expressed || 0).toFixed(3)),
        relations: vitals.relations,
        // CYCLE OUTCOMES: the tally over the last window of generation cycles, so a
        // stall is visible in the panel (and here, on the 5s tick, even when `gen`
        // events have stopped firing - which is exactly what a stall looks like).
        cycles: { window: OUTCOME_WINDOW, counts: outcomeWindow(), totals: { ...outcomeTotals } },
      },
    });

    // NB the electricity meter is NOT integrated here anymore - it runs on its own
    // fast 1s sampler (see powerTimer below) so bursts that switch within seconds
    // are not aliased away by a 5s/30s sample.

    // WATCHDOG: he must never again go silent for minutes while awake because a
    // generation is genuinely wedged - but ordinary throttled idle and deliberate
    // silences must NOT trip it. Two real-stall signals, neither a bare timer:
    //   STALLED - STALL_CYCLES cycles in a row tried and produced no text
    //             (empty/blocked/aborted); the counter is untouched by throttles
    //             and silences, so a tempo gap of minutes never counts.
    //   HUNG    - the model has been pinned in eval/gen for WATCHDOG_MS without a
    //             single token (no outcome would ever record this). inferPhase is
    //             'idle' during throttle/silence idle, so those are excluded too.
    // Either way: log LOUDLY and escalate a context reset - the manual recovery
    // (clearing the fed-back context) done automatically. Runs on this independent
    // timer so it fires even if the generation loop itself is hung.
    const stalled = failedCyclesSinceEmit >= STALL_CYCLES;
    const hung = inferPhase !== 'idle' && now - Math.max(inferBusySinceMs, lastTextMs) > WATCHDOG_MS;
    if (
      running &&
      !client.paused &&
      !asleep &&
      currentMode !== 'paused' &&
      currentMode !== 'dream' &&
      (stalled || hung)
    ) {
      const silentS = Math.round((now - lastTextMs) / 1000);
      const why = stalled
        ? `${failedCyclesSinceEmit} cycles produced no text`
        : `model pinned ${silentS}s with no token`;
      // ESCALATE GENTLY. A full context wipe destroys Zone B and with it the KV
      // cache, so the next burst is maximally slow - the old remedy made the symptom
      // worse. Climb one rung per WATCHDOG_MS the silence persists, preserving the
      // cache as long as possible, and only wipe as a last resort:
      //   step 0 -> just break the wedged generation and let a FRESH one start, KV
      //             prefix (Zone A + B) fully intact.
      //   step 1 -> a PARTIAL trim of the fed-back context (halve it), a small,
      //             deliberate cache break to jolt him off a repeated passage.
      //   step 2+ -> the full wipe, last resort only.
      // watchdogStep resets to 0 the moment real text flows again (see onChunk).
      let action;
      if (watchdogStep === 0) {
        action = 'step 1/3: breaking the wedged generation, starting fresh (context kept, cache intact)';
      } else if (watchdogStep === 1) {
        trimContext(0.5); // partial cache break - drop the older half of the context
        try { await saveContext(contextPath, contextBuf); } catch { /* keep going */ }
        action = 'step 2/3: partial context trim (older half dropped)';
      } else {
        contextBuf = ''; // last resort: drop the (repetitive) fed-back context entirely
        try { await saveContext(contextPath, contextBuf); } catch { /* keep going */ }
        action = 'step 3/3: full context wipe (last resort)';
      }
      const line = `[cy] WATCHDOG real stall (${why}) while awake - ${action}`;
      console.error(line);
      try {
        const { appendFile } = await import('node:fs/promises');
        await appendFile(join(STATE_DIR, 'run.out.log'), `${tsNow()} ${line}\n`);
      } catch {
        /* never crash on watchdog logging */
      }
      if (currentAbort) currentAbort.abort(); // break any wedged in-flight generation
      watchdogStep++; // next fire (if the stall persists) escalates one rung
      failedCyclesSinceEmit = 0; // fresh window: rebuild to STALL_CYCLES before firing again
      inferBusySinceMs = now; // reset the hung clock so the abort itself does not re-trip it
      lastTextMs = now;
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
    probeModelPs(); // non-blocking: model footprint lands on cyModel for a later tick
    const nodeMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    emit({
      kind: 'host',
      payload: {
        // SYSTEM: the whole machine, including work that is NOT Cy
        cpu: Number((cpu * 100).toFixed(1)),
        memPct: Number(((used / total) * 100).toFixed(1)),
        memMB: Math.round(used / 1024 / 1024),
        memTotalMB: Math.round(total / 1024 / 1024),
        // CY: the honest model footprint (from ollama ps - the weights are
        // memory-mapped, so this is the ONLY real figure), separate from the
        // misleading ollama process working set and this runner's own RSS.
        cyCpu: cyProc.ollamaCpu,
        modelMB: cyModel.footprintMB, // MEASURED: real resident footprint (ollama ps)
        modelProc: cyModel.processor, // CPU/GPU split as ollama ps reports it
        modelCtx: cyModel.ctx, // model's loaded context length, if reported
        cyMemMB: cyProc.ollamaMB, // MEASURED: ollama process WS (misleading - see UI tip)
        nodeMB, // MEASURED: runner's own RSS
        ollamaProcs: cyProc.ollamaProcs,
        gpu: null,
        // ---- LIVE continuous readings, for the diagnostics LIVE group ----
        // These are sampled now, not snapshotted per burst - the panel groups them
        // apart from the LAST GENERATION figures so the two are never confused.
        watts: Number((powerMeter.watts || 0).toFixed(1)),
        viewers: client.tempo.viewers,
        duty: client.tempo.speed,
        provider: activeProviderId, // the active model provider (which model is running)
        inferPhase, // 'eval' | 'gen' | 'idle' - the live inference phase
        // CYCLE OUTCOMES: the tally over the last window of generation cycles, on the
        // host channel because it ticks every 10s even during a stall (when `gen`
        // events have stopped), so a stall shows in the panel, not just the log.
        cycles: { window: OUTCOME_WINDOW, counts: outcomeWindow(), totals: { ...outcomeTotals } },
      },
    });
  }, 10000);

  // ---- fast electricity sampler (defeats the aliasing) ----------------------
  // The load flips between ~20% and ~95% within seconds; sampling every 30s
  // smeared that into a flat ~50-85% band that lined up with nothing. So we SAMPLE
  // CPU every 1s (os.cpus() deltas - a cheap, non-blocking read that never touches
  // the generation loop) and integrate the meter over each 1s slice, so cost stays
  // exact at fine granularity. Every POWER_EMIT_MS we emit ONE windowed `power`
  // sample carrying min / max / mean watts over that window, so a burst inside the
  // window is preserved as a real peak/trough instead of being averaged away. The
  // sample is timestamped at the MOMENT OF MEASUREMENT (t_ms), not at flush time,
  // so the chart lines up temporally with everything else the operator sees.
  const POWER_SAMPLE_MS = 1000;
  const POWER_EMIT_MS = 3000; // one windowed sample every 3s (10x finer than before)
  const EMIT_EVERY = Math.max(1, Math.round(POWER_EMIT_MS / POWER_SAMPLE_MS));
  let pwSampleN = 0;
  let pwMsAccum = 0;
  let pwWin = { min: Infinity, max: -Infinity, sum: 0, n: 0 };
  const powerTimer = setInterval(() => {
    const now = Date.now();
    powerMeter.integrate(now); // 1s slice: refresh watts + integrate kWh finely
    const w = powerMeter.watts;
    if (w < pwWin.min) pwWin.min = w;
    if (w > pwWin.max) pwWin.max = w;
    pwWin.sum += w;
    pwWin.n += 1;
    if (++pwSampleN < EMIT_EVERY) return;
    pwSampleN = 0;
    const snap = powerMeter.snapshot(now);
    const mean = pwWin.n ? pwWin.sum / pwWin.n : w;
    const wMin = pwWin.min === Infinity ? w : pwWin.min;
    const wMax = pwWin.max === -Infinity ? w : pwWin.max;
    emit({
      kind: 'power',
      payload: {
        ...snap,
        watts: Number(mean.toFixed(1)), // the line + the cost area (mean over window)
        watts_min: Number(wMin.toFixed(1)), // window trough - keeps the real dip
        watts_max: Number(wMax.toFixed(1)), // window peak - keeps the real spike
        watts_inst: Number(w.toFixed(1)), // latest instantaneous draw (the DRAW readout)
        t_ms: now, // measured-at time, so the chart is temporally honest
      },
    });
    pwWin = { min: Infinity, max: -Infinity, sum: 0, n: 0 };
    // a whole-pound crossing still forces the next in-world cost injection
    const pound = Math.floor(snap.cost_total);
    if (pound > lastPound) {
      lastPound = pound;
      forceCost = true;
      soma.observe(
        {
          name: 'power_cost_crossing',
          text: `the machine has now consumed ${pound} GBP of electricity while continuity was maintained`,
          tags: ['power', 'machine', 'continuity'],
          ts: tsNow(),
        },
        { now },
      );
    }
    // persist roughly every ~30s so the life-of-project total survives a restart
    pwMsAccum += EMIT_EVERY * POWER_SAMPLE_MS;
    if (pwMsAccum >= 30000) {
      pwMsAccum = 0;
      powerMeter.save().catch(() => {});
    }
  }, POWER_SAMPLE_MS);

  async function runAwgDuringIdle(idleBudgetMs) {
    const eligibility = shouldRunAwg(vitals.worldSimulation, {
      nowMs: Date.now(),
      idleBudgetMs,
      pendingHigherPriority: pendingPostcards.length > 0 || pendingWarden.length > 0 || client.paused,
      memoryFormationBacklog: autobiographicalMemory ? autobiographicalMemory.pending.length : 0,
      inferenceBusy: inferPhase !== 'idle',
    });
    if (!eligibility.run) return { status: 'SKIPPED', reason: eligibility.reason };
    const context = buildBrokerContext(CONTEXT_CONSUMERS.AWG, {
      generationRef: `awg-context:${Date.now()}`,
      fallback: '',
    });
    if (!context.ok) return { status: 'SKIPPED', reason: 'CONTEXT_BROKER_FAILURE' };
    const result = await runAmbientWorldCycle({
      state: vitals.worldSimulation,
      contextRendering: context.rendering,
      nowMs: Date.now(),
      idleBudgetMs,
      pendingHigherPriority: pendingPostcards.length > 0 || pendingWarden.length > 0 || client.paused,
      memoryFormationBacklog: autobiographicalMemory ? autobiographicalMemory.pending.length : 0,
      inferenceBusy: inferPhase !== 'idle',
      makeId: (prefix) => `${prefix}-${randomUUID()}`,
      generate: (call) => rawGenerate({
        system: call.system,
        prompt: call.prompt,
        opts: options(vitals, config.threads, 'journal', call.options),
        purpose: call.purpose,
        accountingMode: 'ambient_world_generation',
        timeoutMs: Math.min(AWG_TIMEOUT_MS, idleBudgetMs),
      }),
    });
    vitals.worldSimulation = result.state;
    if (result.run) {
      emit({
        kind: 'awg_run_record',
        payload: {
          ...result.run,
          contextPacketSummary: context.inspection.summary,
          provider: activeProvider().id,
          model: activeProvider().model,
          totalLatencyMs: result.latencyMs,
        },
      });
    }
    if (result.status !== 'ACCEPTED') return result;

    const environment = awgEventToEnvironment(result.applied);
    const record = captureEnvironmentEvent(environment.archetypeId, {
      eventType: environment.eventType,
      summary: environment.summary,
      world: environment.world,
      observation: environment.observation,
      provisionalConsumer: false,
      cyObserved: !!result.applied.cyObserved,
    });
    result.applied.event.environmentEventId = record.world_event.id;
    for (const change of result.applied.changes) {
      const thread = vitals.worldSimulation.threads.find((item) => item.id === change.threadId);
      if (thread) emit({ kind: 'world_thread_record', payload: thread });
    }
    for (const object of vitals.worldSimulation.objects.filter((item) => item.updatedAt === result.run.ranAt)) {
      emit({ kind: 'world_object_record', payload: object });
    }
    if (result.applied.cyObserved && environment.publicTimeline) {
      emit({
        kind: 'event',
        payload: {
          name: 'ambient_world',
          text: environment.publicTimeline,
          environment_event_id: record.world_event.id,
        },
      });
    }
    return result;
  }

  // Interruptible idle: sit still for `ms`, but break early if a postcard or
  // notice lands (so a silence never swallows an interrupt) or on shutdown.
  // AWG is permitted only when the caller explicitly marks a normal waking
  // throttle interval as spare capacity. Dream, failure-backoff and chosen
  // silence intervals never start background world inference.
  async function idleSilently(ms, { breakOnTempo = false, allowAwg = false } = {}) {
    const end = Date.now() + ms;
    const startingTempoEpoch = tempoEpoch;
    if (allowAwg) {
      try {
        await runAwgDuringIdle(Math.max(0, end - Date.now()));
      } catch (error) {
        console.error(`[cy] AWG failed safely: ${error && error.message || error}`);
      }
    }
    while (running && Date.now() < end) {
      const tempoChanged = breakOnTempo && tempoEpoch !== startingTempoEpoch;
      if (pendingPostcards.length || pendingWarden.length || tempoChanged) break;
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
    soma.observeOutput(chunk, { mode: lucid ? 'dream-lucid' : 'dream', now: Date.now() });
    lastTextMs = Date.now(); // a murmur/night-line is real output too
    watchdogStep = 0; // dream output counts as text flowing: de-escalate the watchdog
    failedCyclesSinceEmit = 0; // real output: not a stall
    nonEmittingStreak = 0; // real output: clear the metered-backoff streak
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
      const raw = await rawGenerate({ system: ZONE_A, prompt, opts, purpose: 'dream' });
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
      const raw = await rawGenerate({ system: ZONE_A, prompt, opts, purpose: 'dream' });
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
      // OPERATOR PAUSE (owner-only, admin ?111): the whole point is to make NO
      // generation calls to ollama at all, so the machine's idle CPU/memory/draw
      // can be read and the host figures reconciled. Every other timer (vitals,
      // host stats, power sampling, event emission) runs on its own interval and
      // keeps ticking, so the page stays live and the meter's DRAW visibly falls
      // toward idle. Any pending postcards/warden notices stay queued and are
      // picked up cleanly the moment we resume - the runner never restarts and no
      // context is lost. Plain sleep (NOT idleSilently) so a queued postcard does
      // not spin the loop and keep the CPU up - that would defeat the exercise.
      if (client.paused) {
        if (currentMode !== 'paused') {
          emit({ kind: 'mode', payload: { from: currentMode, to: 'paused' } });
          currentMode = 'paused';
          client.kick(); // priority flush: the admin control is waiting on this
        }
        await sleep(1000);
        continue;
      }
      if (pendingWarden.length) {
        await doWarden(pendingWarden.shift());
        continue;
      }
      if (pendingPostcards.length) {
        await doPostcard(pendingPostcards.shift());
        continue;
      }
      const { mins } = londonParts();
      const asleep = effectiveAsleep(mins);

      // ASLEEP: DREAM mode runs its own step - murmurs spaced far apart, one slow
      // abstract drawing accumulating through the small hours, and the rare night
      // waking. It is a wholly separate branch from the waking journal below (its
      // own prompt, sampling and rendering), so dream incoherence never touches
      // the waking coherence rules.
      if (asleep) {
        if (currentMode !== 'dream') {
          const wasPaused = currentMode === 'paused';
          emit({ kind: 'mode', payload: { from: currentMode, to: 'dream' } });
          currentMode = 'dream';
          if (wasPaused) client.kick(); // priority flush: the admin control is waiting on this
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
      // resumed from an operator pause straight into a waking window: announce the
      // return to the journal so the mode pill drops PAUSED at once (the asleep
      // branch above emits its own paused->dream transition).
      if (currentMode === 'paused') {
        emit({ kind: 'mode', payload: { from: 'paused', to: 'journal' } });
        client.kick(); // priority flush: the admin control is waiting on this
      }
      const mode = 'journal';
      currentMode = mode;

      // The existing scheduler has already created an autonomous activity
      // opportunity. Grounded Soma now supplies facts; a separate model-mediated
      // subjective layer chooses only among real outward expressive capabilities.
      // A queued drawing request is external rather than autonomous and still wins.
      const nowMs = Date.now();
      const hasDrawRequest = pendingDrawRequests.length > 0;
      const cognition = prepareSomaGeneration(soma, {
        now: nowMs,
        inputs: {
          physical: vitals.physical,
          monotony: vitals.monotony,
          asleep: false,
          lastMailMs: vitals.lastMailMs,
          now: nowMs,
        },
      });

      // Reuse the same bounded recent-incident view in the chooser and in any
      // resulting journal/drawing prompt. No full ledger or day history is sent.
      const incidentContext = incidentsDirective(vitals.ledger, {
        mailWaitMs: nowMs - (vitals.lastMailMs || nowMs),
        rnd: () => 0,
      });
      if (pendingMemoryQuery) {
        pendingMemoryQuery.publicSituation = pendingMemoryQuery.publicSituation || incidentContext;
        await refreshPendingMemory(`journal:${nowMs}`, cognition.groundedDirective);
      }

      if (hasDrawRequest) {
        await recordOutcome((await doDraw({ cognition, incidentContext })) || 'empty');
        continue;
      }

      const cadence = expressiveCadenceAvailability(vitals.expressiveCadence);
      const availableActions = [];
      if (cadence.journal) availableActions.push('journal');
      if (cadence.draw) availableActions.push('draw');
      const lastSilenceAtMs = Number(soma.state && soma.state.action
        && soma.state.action.lastSilenceAtMs) || 0;
      if (!lastSilenceAtMs || nowMs - lastSilenceAtMs >= EXPRESSIVE_SILENCE_COOLDOWN_MS) {
        availableActions.push('silence');
      }
      const choiceContext = buildBrokerContext(CONTEXT_CONSUMERS.EXPRESSIVE_CHOICE, {
        generationRef: `expressive-choice:${nowMs}`,
        cognition,
        incidentContext,
        actionOptions: availableActions,
        fallback: cognition.groundedDirective,
      });
      const choiceRequest = buildExpressiveChoiceRequest({
        groundedContext: choiceContext.packet || cognition.groundedContext,
        groundedDirective: choiceContext.rendering || cognition.groundedDirective,
        currentIncidentContext: choiceContext.ok ? '' : incidentContext,
        provisionalMemoryCandidate: null,
        availableActions,
      });
      const expressiveChoice = await chooseExpressiveAction(choiceRequest, {
        generate: (call) => rawGenerate({
          system: call.system,
          prompt: call.prompt,
          opts: options(vitals, config.threads, 'journal', call.options),
          purpose: call.purpose,
          accountingMode: 'expressive_choice',
        }),
      });
      soma.recordExpressiveChoice(expressiveChoice, { now: nowMs });
      emit({
        kind: 'expressive_choice',
        payload: {
          schema: expressiveChoice.schema,
          version: expressiveChoice.version,
          classification: expressiveChoice.classification,
          available_actions: expressiveChoice.availableActions,
          grounded_context_supplied: expressiveChoice.groundedContextSupplied,
          grounded_directive_supplied: expressiveChoice.groundedDirectiveSupplied,
          current_incident_context_supplied: expressiveChoice.currentIncidentContextSupplied,
          provisional_cognitive_context_supplied: expressiveChoice.provisionalCognitiveContextSupplied,
          selected_action: expressiveChoice.selectedAction,
          focus_refs: expressiveChoice.focusRefs,
          reason_type: expressiveChoice.reasonType,
          selection_mechanism: expressiveChoice.selectionMechanism,
          fallback_used: expressiveChoice.fallbackUsed,
          fallback: expressiveChoice.fallback,
        },
      });
      const selectedAction = expressiveChoice.selectedAction;

      // Publish only after the fixed engineering interval has elapsed so the
      // event marks its end. Provisional rest/fatigue does not change duration.
      if (selectedAction === 'silence') {
        const seconds = AUTONOMOUS_SILENCE_SECONDS;
        await recordOutcome('deliberate-silence');
        await recordCompletedSilence(seconds, {
          idle: idleSilently,
          emit,
          reason: 'model-mediated subjective character choice',
        });
        continue;
      }

      if (selectedAction === 'draw') {
        await recordOutcome((await doDraw({ cognition, incidentContext })) || 'empty');
        continue;
      }

      // Zone A is the fixed ollama `system` (never rebuilt); the volatile Zone C
      // directives are assembled once per burst and folded into the prompt TAIL by
      // buildPrompt so the KV-cache prefix survives. buildCtx has
      // fire-once side effects, so this must happen exactly once per burst - only
      // the sampling and the context tail vary across the repeat-retries below.
      const bans = bansDirective(vitals.recentOpeners);
      const targetOpts = options(vitals, config.threads, mode);
      noiseThisBurst = false;
      let directives;
      let burstForm = null; // the selected form directive, surfaced to the RAW view
      let burstGroundedContext = null;
      let burstGroundedDirective = '';
      let burstMemoryQuery = null;
      {
        const ctx = buildCtx(cognition, {
          generationRef: `journal-prose:${nowMs}`,
          incidentContext,
        });
        burstGroundedContext = ctx.groundedSomaContext;
        burstGroundedDirective = ctx.groundedSoma;
        burstMemoryQuery = ctx.autobiographicalMemoryInspection;
        ctx.bans = bans;
        ctx.length = completionDirective(targetOpts.num_predict);
        if (!ctx.sharedContext) ctx.regime = regimeDirective(mins);
        burstForm = selectedAction;
        ctx.incidents = incidentContext;
        directives = buildDirectives(vitals, 'journal', ctx);
      }
      const baseOpts = { ...targetOpts, num_predict: completionBudget(targetOpts.num_predict) };
      // Explicit one-shot wording can opt out of the within-burst repeat guard,
      // so a deliberately authored refrain is not cut short. No provisional
      // fatigue or fixation score creates this exemption.
      const allowRepeat = /say it again|cannot get past|you repeat yourself/.test(directives);

      const burstStart = Date.now();
      let discards = 0;
      let assistantFrameDiscards = 0;
      let tempBump = 0;
      let penBump = 0;
      let produced = false;
      let errored = false; // provider unreachable / bad HTTP broke the burst
      let refusedGen = false; // the provider (DeepSeek) refused - discarded, not emitted
      let lastFull = '';
      let lastResult = null;
      let lastTail = ''; // Zone B and the sampling actually used on the winning try,
      let lastOpts = null; // captured for the RAW view's per-burst detail
      for (;;) {
        // Past the hard cap we STOP discarding and force the burst OUT: stream with
        // NO near-repeat guard (contextTail undefined, so nothing is held back or
        // discarded) so whatever is generated is emitted. Repetitive prose beats
        // total silence, and a man going over the same ground is truthful.
        const forceEmit = discards >= MAX_DISCARDS;
        if (forceEmit) await logCapHit(mode, discards);
        const tail = contextText();
        const prompt = buildPrompt(tail, mode, null, directives);
        const opts = {
          ...baseOpts,
          temperature: Number(Math.min(1.6, baseOpts.temperature + tempBump).toFixed(3)),
          repeat_penalty: Number(Math.min(1.6, baseOpts.repeat_penalty + penBump).toFixed(3)),
        };
        await logPrompt(mode, ZONE_A + '\n\n---PROMPT---\n' + prompt);
        const r = await streamGenerate({
          system: ZONE_A,
          prompt,
          opts,
          mode,
          contextTail: forceEmit ? undefined : tail,
          allowRepeat: allowRepeat || forceEmit,
        });
        if (r.error) { errored = true; break; } // provider already backed off; move on
        if (r.refused) { refusedGen = true; break; } // DeepSeek refusal: discard, no retry
        if (r.assistantFrameTail) {
          // Cy's prefix already reached the page. The explanatory tail did not.
          // Treat this as the successful short burst it visibly was; retrying here
          // would append an unrelated second answer to the same journal entry.
          produced = !!(r.full && r.full.trim());
          lastFull = r.full || '';
          lastResult = r;
          lastTail = tail;
          lastOpts = opts;
          break;
        }
        if (r.assistantFrame) {
          assistantFrameDiscards++;
          await recordOutcome('discarded-assistant-frame');
          // Retry once after removing any previously saved assistant-shaped tail,
          // with a small engineering sampling variation. The rejected generation
          // itself was never appended. A second failure becomes a quiet cycle.
          contextBuf = stripAssistantContaminatedTail(contextBuf);
          tempBump += 0.35;
          if (assistantFrameDiscards < 2) continue;
          lastResult = r;
          break;
        }
        if (!r.repeat) {
          produced = !!(r.full && r.full.trim());
          lastFull = r.full || '';
          lastResult = r;
          lastTail = tail;
          lastOpts = opts;
          break;
        }
        // ENGINEERING output-quality retry: vary sampling and trim recent context.
        // A discarded generation is not evidence about Cy's psychological state.
        discards++;
        await logDiscard(mode, r.full, discards);
        await recordOutcome('discarded-repeat'); // each discard is a visible outcome
        tempBump += 0.35;
        penBump += 0.12;
        trimContext(discards >= 2 ? 0.9 : 0.5);
      }
      const burstMs = Date.now() - burstStart;
      // CYCLE OUTCOME: exactly one terminal outcome for the burst, on top of any
      // per-discard 'discarded-repeat' records above - so no cycle ever vanishes.
      // `burstEmitted` (original text that actually reached the page) is the honest
      // test of "did anything come out": r.full can be non-empty while the warden ate
      // every chunk, which must read as blocked, not emitted.
      if (errored) await recordOutcome('aborted'); // provider unreachable / bad HTTP
      else if (refusedGen) await recordOutcome('refused'); // provider refused (visible outcome)
      else if (burstEmitted.trim()) {
        vitals.expressiveCadence = recordExpressiveJournal(vitals.expressiveCadence);
        await recordOutcome('emitted');
      }
      else if (lastResult && lastResult.aborted) await recordOutcome('aborted');
      else if (wardenBlocksInGen > 0) await recordOutcome('blocked-by-warden');
      else {
        // HONEST 'empty' CLASSIFICATION. Nothing reached the page, it was not
        // aborted/blocked/refused: split the old single 'empty' by ACTUAL cause.
        // The strip snapshot on the winning result carries the true provider char
        // count (before any stripping). rawChars === 0 means the provider genuinely
        // returned no text ('empty-provider'); rawChars > 0 means text arrived and
        // filtering removed all of it ('empty-stripped') - the ~45% DeepSeek case.
        // Attribute the stripped case to the bank that annihilated the most, in the
        // log, so the responsible bank is named without exploding the outcome tally.
        const strip = lastResult && lastResult.strip;
        if (strip && strip.rawChars > 0) {
          const a = strip.annihilated || {};
          const bank = dominantBank({
            scaffold: a.scaffold || 0,
            narration: a.narration || 0,
            stateNotation: a.stateNotation || 0,
          });
          console.warn(`[cy] empty-stripped (${mode}): raw=${strip.rawChars} surviving=${strip.survivingChars} - filtering removed all of it (dominant bank: ${bank})`);
          await recordOutcome('empty-stripped');
        } else {
          await recordOutcome('empty-provider');
        }
      }
      // METERED BACKOFF classification. A genuine non-emitting FAILURE is a cycle that
      // paid and put nothing on the page AND was not cut by an inbound interrupt: an
      // interrupt-driven abort (lastResult.aborted - a postcard/notice/provider-switch/
      // watchdog break) hands off to real work and must stay responsive, so it is NOT a
      // failure. errored/refused set no lastResult, so interruptAbort is false for them;
      // empty/blocked have lastResult.aborted === false. A burst that emitted anything
      // already cleared the streak in onChunk. Increment only on a true failure; the
      // exponential wait itself is applied at the tail of the cycle below.
      const interruptAbort = !!(lastResult && lastResult.aborted);
      const nonEmittingFailure = !burstEmitted.trim() && !interruptAbort;
      if (nonEmittingFailure) nonEmittingStreak++;
      // TEMPO: compute the deliberate idle this burst will sit for BEFORE emitting
      // the gen event, so the diagnostics can show the next gap ('next burst in
      // ~Ns') rather than leaving it a mystery. Only a burst that produced prose is
      // throttled. Smooth the representative burst duration the tempo panel reads.
      const tempoIdle = produced ? tempoIdleMs(burstMs, client.tempo.speed) : 0;
      // READING-CAP backpressure: how far the emitted prose has run ahead of a human
      // reading clock. A fast provider can outrun any reader even at speed=100 (where
      // the tempo idle is zero), so this second throttle drains the overrun. Only a
      // produced burst is measured; the reading clock is re-anchored the moment the
      // reader has caught up, so no stale surplus/deficit accrues across quiet spells
      // or a night's sleep (dream prose never counts toward the budget).
      let aheadChars = 0;
      let readIdle = 0;
      if (produced) {
        const nowB = Date.now();
        const elapsedSec = Math.max(0, (nowB - (vitals.readEpochMs || nowB)) / 1000);
        aheadChars = (vitals.readCharsSinceEpoch || 0) - elapsedSec * READ_CHARS_PER_SEC;
        if (aheadChars <= 0) {
          // reader is caught up: re-anchor the clock to now so the debt cannot drift
          // hugely negative (which would then let a long unthrottled dump run later).
          vitals.readEpochMs = nowB;
          vitals.readCharsSinceEpoch = 0;
          aheadChars = 0;
        }
        readIdle = readingIdleMs(aheadChars);
      }
      // FULL-TILT BYPASS - LOCAL ONLY. Speed 100 zeroes the reading cap so the runner
      // runs flat out, back-to-back, with no deliberate idle - but ONLY when the active
      // provider is the LOCAL one (ollama), where generation is itself the brake (~55s
      // TTFT, ~4 tok/s) so 'no deliberate idle' is still a sane cadence. On any METERED/
      // remote provider (DeepSeek answers in ~1-2s) there is NO such brake: bypassing the
      // cap there fires an inference every couple of seconds, each paying ~1500 prompt
      // tokens for prose nobody has reached - the exact token-rinse the cap exists to stop.
      // So the reading cap ALWAYS binds on a metered provider, at every speed including 100.
      // The gate is provider.local (see provider.js) so a future paid provider cannot
      // silently inherit the bypass. DO NOT widen this to `>= 100` alone again.
      const fullTilt = clampSpeed(client.tempo.speed) >= 100 && activeProvider().local;
      const effReadIdle = fullTilt ? 0 : readIdle;
      // COMPOSE, do not replace: sit for the GREATER of the exact duty-cycle idle
      // and the (at 100, bypassed) reading backpressure. A low target's required
      // gap must not be shortened or the displayed percentage ceases to be true.
      const idleMs = produced ? Math.max(tempoIdle, effReadIdle) : 0;
      // why the runner is about to idle, for the RAW debug view: reading-cap vs tempo.
      // At 100 both terms are 0, so idleMs is 0 and this is null - honest: neither the
      // reading cap nor the tempo is inserting any idle.
      const idleReason = idleMs > 0 ? (effReadIdle > tempoIdle ? 'reading-cap' : 'tempo') : null;
      if (produced) recentBurstMs = Math.round(recentBurstMs * 0.6 + burstMs * 0.4);
      // live diagnostics: publish this burst's generation telemetry (no-op if the
      // burst errored before ollama returned a `done` line with counters).
      if (lastResult) {
        emitGen(lastResult, mode, {
          zoneA: ZONE_A,
          zoneB: lastTail,
          zoneC: directives,
          groundedSomaContext: burstGroundedContext,
          groundedSomaDirective: burstGroundedDirective,
          autobiographicalMemoryQuery: burstMemoryQuery,
          form: burstForm,
          styles: '',
          opts: lastOpts,
          output: lastFull,
          burstMs,
          nextIdleMs: idleMs,
          idleReason,
          aheadChars: produced ? aheadChars : null,
          strip: lastResult.strip || null, // raw-vs-surviving strip accounting
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
        memoryExpressionBuffer.push({ id: randomUUID(), text: lastFull, at: tsNow() });
        if (memoryExpressionBuffer.length >= MEMORY_EXPRESSION_BATCH_LIMIT) {
          const batch = memoryExpressionBuffer.splice(0, MEMORY_EXPRESSION_BATCH_LIMIT);
          const source = sourceFromExpression(
            batch.map((item) => item.text).join('\n\n'),
            `expression-batch:${batch[0].id}:${batch[batch.length - 1].id}`,
            batch[batch.length - 1].at,
          );
          if (source) void autobiographicalMemory.queueSource(source).catch((error) => {
            console.warn(`[cy] expression memory enqueue deferred: ${error.message}`);
          });
        }
        formMemoryAfterVisibleOutput(burstGroundedDirective);
        // Language remains expression rather than evidence. No grounded state or
        // provisional drive is updated as a consequence of this selected form.
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
        if (idleMs > 0) {
          await recordOutcome('throttled'); // duty-cycle quiet, a distinct machine-imposed gap
          // a throttle idle is machine-imposed quiet, not a wedge: the stall counter
          // is untouched by 'throttled', so the watchdog never mistakes it for one.
          await idleSilently(idleMs, { breakOnTempo: true, allowAwg: true });
        }
      } else {
        // NON-PRODUCED cycle. On a METERED provider, a genuine non-emitting FAILURE
        // (empty/blocked/refused/errored - NOT an interrupt-driven abort) backs off
        // exponentially - 2s, 4s, 8s ... capped at 60s - so a fast paid API cannot be
        // token-rinsed by instant retries; the streak resets to 0 the moment prose
        // emits again. A local (ollama) cycle, or an interrupt-driven abort, just takes
        // the small breather as before. idleSilently lets an inbound postcard cut the
        // wait short, so responsiveness is preserved.
        const metered = !activeProvider().local;
        if (metered && nonEmittingFailure && nonEmittingStreak > 0) {
          const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (nonEmittingStreak - 1));
          await logBackoff(nonEmittingStreak, backoff);
          await idleSilently(backoff);
        } else {
          await sleep(700);
        }
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
    if (autobiographicalMemory) autobiographicalMemory.stop();
    clearInterval(tickTimer);
    clearInterval(hostTimer);
    clearInterval(powerTimer);
    try {
      powerMeter.integrate();
      await powerMeter.save();
    } catch {
      /* ignore */
    }
    try {
      await spendMeter.save(); // persist cumulative model spend across the restart
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
  const sampleGrounded = soma.groundedDirective({ now: Date.now() });
  const sampleCtx = {
    bans: bansDirective(vitals.recentOpeners),
    regime: regimeDirective(londonParts().mins),
    groundedSoma: sampleGrounded.directive,
    autobiographicalMemory: autobiographicalMemory.working.directive,
    incidents: incidentsDirective(vitals.ledger, { mailWaitMs: 0, rnd: () => 0 }),
  };
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
    return stripAssistantContaminatedTail(stripScaffold(sanitize(text)));
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

// Only launch the runner when executed directly (node runner/run.js). When this
// module is imported (e.g. by runner/abort.test.js to exercise readNdjsonStream),
// main() must NOT run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[cy] fatal:', err);
    process.exit(1);
  });
}
