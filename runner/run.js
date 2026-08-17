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
import { buildSystem, buildPrompt, options, letterPredict, amplifiedDirective } from './prompt.js';
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
} from './cast.js';
import { PowerMeter, costInjection } from './power.js';
import { createWarden, sanitize, stripScaffold, isRepeat } from './warden.js';
import { Client, tsNow } from './client.js';

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

// asleep between lights_out (22:30) and lights_on (06:30)
const isAsleep = (mins) => mins >= 22 * 60 + 30 || mins < 6 * 60 + 30;

const SCHEDULE = [
  { name: 'lights_on', mins: 6 * 60 + 30 },
  { name: 'meal', mins: 7 * 60 + 30 },
  { name: 'meal', mins: 12 * 60 },
  { name: 'meal', mins: 17 * 60 + 30 },
  { name: 'lights_out', mins: 22 * 60 + 30 },
];

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

  const warden = createWarden(config, blockedLogPath);
  const client = new Client(config, STATE_DIR);
  const emit = (ev) => client.enqueue(ev);

  // ---- electricity meter ----
  const powerMeter = new PowerMeter(config, join(STATE_DIR, 'power.json'));
  await powerMeter.load();
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
  };

  // rolling ~800 tokens (~3200 chars) of the model's own CLEANED output, fed
  // back in. Only scaffold-free prose ever lands here (see onChunk), so the
  // model never re-reads its own instruction frames and echoes them.
  const CONTEXT_MAX_CHARS = 3200;
  let contextBuf = await loadContext(contextPath);
  const contextText = () => contextBuf.slice(-CONTEXT_MAX_CHARS);
  async function appendContext(chunk) {
    contextBuf = (contextBuf + chunk).slice(-CONTEXT_MAX_CHARS * 2);
    await saveContext(contextPath, contextBuf.slice(-CONTEXT_MAX_CHARS));
  }
  // Shrink the effective context tail (on a near-repeat, to jolt the model off
  // the passage it keeps copying).
  function trimContext(frac) {
    const eff = Math.min(contextBuf.length, CONTEXT_MAX_CHARS);
    const keep = Math.max(0, eff - Math.floor(eff * frac));
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

  // ---- shared loop state ----
  let running = true;
  let currentMode = 'journal';
  let currentAbort = null; // AbortController for the in-flight generation
  let tokenCount = 0; // tokens this vitals-tick window (broca)
  const pendingPostcards = [];
  const pendingWarden = [];
  // ambient cues armed by the scheduler, consumed once by the next generation
  let officerCue = null; // { key, ev, until }
  let overheardCue = null; // { item, misheard, until }
  let prevMins = null;
  let prevDate = londonParts().date;
  let prevCpu = cpuSnapshot();

  // ---- one emitted chunk: screen, then text-event or in-world lost-thought ----
  async function onChunk(rawChunk, mode) {
    const chunk = stripScaffold(sanitize(rawChunk));
    if (!chunk.trim()) return; // was nothing but control tokens / scaffold
    const res = warden.screenOut(chunk);
    if (!res.ok) {
      emit({ kind: 'abort', payload: { cause: 'warden', reason: res.reason } });
      await warden.logBlock(res.reason, chunk, tsNow());
      return;
    }
    emit({ kind: 'text', payload: { s: chunk, mode } });
    await appendContext(chunk);
  }

  // ---- stream one generation from ollama ----
  // When `contextTail` is given (journal/sleep continuation), the opening of the
  // generation is held back until ~PRIME_CHARS have arrived and checked against
  // the context tail: if it is a verbatim replay, the whole generation is
  // discarded (nothing emitted) and { repeat:true } is returned for the caller
  // to retry. Postcard/warden replies pass no contextTail and stream straight
  // through. Either way every chunk is scaffold-stripped before it is emitted.
  async function streamGenerate({ system, prompt, opts, mode, contextTail }) {
    const ac = new AbortController();
    currentAbort = ac;
    const buffer = warden.newBuffer();
    const PRIME_CHARS = 100;
    let full = '';
    let head = '';
    let primed = contextTail === undefined; // only continuation mode primes
    let repeat = false;
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
    return { full: cleanedFull(), aborted: false };
  }

  // Assemble the contextual prompt injections for a waking generation: the cast
  // standing, any hot grudge, an amplified trivial event, and - on a cadence or a
  // whole-pound crossing - the running electricity cost.
  function buildCtx() {
    genCount++;
    const ctx = {
      cast: castForPrompt(vitals.relations),
      grudge: grudgeDirective(vitals.relations),
    };
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

    const system = buildSystem(vitals, 'letter', ctx);
    const prompt = buildPrompt(contextText(), 'postcard', pc);
    const opts = options(vitals, config.threads, 'letter', { num_predict: letterPredict(pc.body) });
    await logPrompt('postcard', system);
    const { full } = await streamGenerate({ system, prompt, opts, mode: 'letter' });

    // the public, streamed record of Cy's reply (kept as postcard_out)
    const reply = (full || '').trim();
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

    const system = buildSystem(vitals, 'journal', buildCtx());
    const prompt = buildPrompt(contextText(), 'warden', notice);
    const opts = options(vitals, config.threads, 'journal', { num_predict: letterPredict(notice.text) });
    await logPrompt('warden', system);
    await streamGenerate({ system, prompt, opts, mode: 'warden' });

    emit({ kind: 'mode', payload: { from: 'warden', to: 'journal' } });
    currentMode = 'journal';
  }

  // ---- inbox: postcards interrupt; news just colours the state ----
  client.onInbox = (data) => {
    let interrupt = false;
    for (const pc of data.postcards || []) {
      // screen any text; an image-only postcard (no body) is always allowed
      if (pc.body && !warden.screenIn(pc.body).ok) continue; // silent reject
      pendingPostcards.push(pc);
      interrupt = true;
    }
    for (const n of data.news || []) {
      fireEvent('news_arrives', { headline: n.headline || null });
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
    overheardCue = { item, misheard, until: Date.now() + 3 * 60 * 1000 };
    emit({
      kind: 'event',
      payload: { name: 'overheard', source: item.source, misheard },
    });
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
    prevMins = mins;

    const asleep = isAsleep(mins);
    // random ambient events, low probability per 5s tick
    if (asleep && Math.random() < 0.02) fireEvent('noise_night');
    if (Math.random() < 0.0006) fireEvent('injury');
    if (!asleep && Math.random() < 0.0008) fireEvent('cell_search');

    // trivial daily irritations (awake) - tiny normally, huge under high amp
    if (!asleep && Math.random() < 0.004) {
      const trivial = ['no_eggs', 'cold_tea', 'delayed_unlock'];
      fireEvent(trivial[Math.floor(Math.random() * trivial.length)]);
    }
    // social frictions between inmates (awake) - build warmth/suspicion/grudge
    if (!asleep && Math.random() < 0.006) fireSocial();
    // officers acting through the machinery of the place (awake)
    if (!asleep && Math.random() < 0.004) fireOfficer();
    // half-heard remarks down the wing (awake) - may be misheard under paranoia
    if (!asleep && Math.random() < 0.005) fireOverheard();

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
    emit({
      kind: 'host',
      payload: {
        cpu: Number((cpu * 100).toFixed(1)),
        memPct: Number(((used / total) * 100).toFixed(1)),
        memMB: Math.round(used / 1024 / 1024),
        gpu: null,
      },
    });
  }, 10000);

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
      const mode = asleep ? 'sleep' : 'journal';
      currentMode = mode;
      // sleep mode gets no cast/cost injections - he is half under. Build the
      // system + ctx ONCE (buildCtx has fire-once side effects); only the
      // sampling and the context tail vary across repeat-retries.
      const ctx = mode === 'sleep' ? null : buildCtx();
      const system = mode === 'sleep' ? buildSystem(vitals, 'sleep') : buildSystem(vitals, 'journal', ctx);
      const baseOpts = options(vitals, config.threads, mode);

      let discards = 0;
      let tempBump = 0;
      let penBump = 0;
      let produced = false;
      for (;;) {
        const tail = contextText();
        const prompt = buildPrompt(tail, mode);
        const opts = {
          ...baseOpts,
          temperature: Number(Math.min(1.6, baseOpts.temperature + tempBump).toFixed(3)),
          repeat_penalty: Number(Math.min(1.6, baseOpts.repeat_penalty + penBump).toFixed(3)),
        };
        await logPrompt(mode, system);
        const r = await streamGenerate({ system, prompt, opts, mode, contextTail: tail });
        if (r.error) break; // ollama already backed off; move on
        if (!r.repeat) {
          produced = !!(r.full && r.full.trim());
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
      // adaptive pacing: near-continuous trickle awake, slow drift asleep. No
      // artificial gap between waking generations that produced prose.
      await sleep(mode === 'sleep' ? 8000 : produced ? 150 : 700);
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
  console.log(`[cy] runner up. dryRun=${config.dryRun} model=${config.model}`);
  console.log(`[cy] state dir: ${STATE_DIR}`);
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
