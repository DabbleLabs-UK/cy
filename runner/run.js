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
  heartRate,
  brainRegions,
  clamp,
} from './vitals.js';
import { buildSystem, buildPrompt, options, letterPredict } from './prompt.js';
import { createWarden, sanitize } from './warden.js';
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
        console.warn('[captive] no config.json - running from config.sample.json');
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

// ---------------------------------------------------------------------------

async function main() {
  const config = await loadConfig();
  const vitalsPath = join(STATE_DIR, 'vitals.json');
  const contextPath = join(STATE_DIR, 'context.jsonl');
  const blockedLogPath = join(STATE_DIR, 'blocked.log');

  const vitals = await loadVitals(vitalsPath);
  if (!vitals.lastMailMs) vitals.lastMailMs = Date.now();

  const warden = createWarden(config, blockedLogPath);
  const client = new Client(config, STATE_DIR);
  const emit = (ev) => client.enqueue(ev);

  // rolling ~800 tokens (~3200 chars) of the model's own output, fed back in.
  const CONTEXT_MAX_CHARS = 3200;
  let contextBuf = await loadContext(contextPath);
  const contextText = () => contextBuf.slice(-CONTEXT_MAX_CHARS);
  async function appendContext(chunk) {
    contextBuf = (contextBuf + chunk).slice(-CONTEXT_MAX_CHARS * 2);
    await saveContext(contextPath, contextBuf.slice(-CONTEXT_MAX_CHARS));
  }

  // ---- shared loop state ----
  let running = true;
  let currentMode = 'journal';
  let currentAbort = null; // AbortController for the in-flight generation
  let tokenCount = 0; // tokens this vitals-tick window (broca)
  const pendingLetters = [];
  let prevMins = null;
  let prevDate = londonParts().date;
  let prevCpu = cpuSnapshot();

  // ---- one emitted chunk: screen, then text-event or in-world lost-thought ----
  async function onChunk(rawChunk, mode) {
    const chunk = sanitize(rawChunk);
    if (!chunk.trim()) return; // was nothing but control tokens
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
  async function streamGenerate({ system, prompt, opts, mode }) {
    const ac = new AbortController();
    currentAbort = ac;
    const buffer = warden.newBuffer();
    let full = '';
    let res;
    try {
      res = await fetch(`${config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, system, prompt, options: opts, keep_alive: -1, stream: true }),
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return { full, aborted: true };
      console.warn('[captive] ollama unreachable:', err.message);
      await sleep(2000);
      return { full, error: true };
    }
    if (!res.ok || !res.body) {
      console.warn('[captive] ollama HTTP', res.status);
      await sleep(1000);
      return { full, error: true };
    }

    const reader = res.body.getReader();
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
            full += obj.response;
            tokenCount++;
            for (const chunk of buffer.push(obj.response)) await onChunk(chunk, mode);
          }
        }
      }
    } catch (err) {
      if (ac.signal.aborted) return { full, aborted: true };
      console.warn('[captive] stream error:', err.message);
      return { full, error: true };
    } finally {
      if (currentAbort === ac) currentAbort = null;
    }
    // natural end: flush trailing partial thought
    for (const chunk of buffer.flush()) await onChunk(chunk, mode);
    return { full, aborted: false };
  }

  // ---- letter mode: interrupt, transition, reply, transition back ----
  async function doLetter(letter) {
    emit({ kind: 'abort', payload: { cause: 'letter' } });
    const from = currentMode;
    currentMode = 'letter';
    emit({ kind: 'mode', payload: { from, to: 'letter', cause: letter.from_name || 'mail' } });

    const hostile = isHostile(letter.body);
    const evName = hostile ? 'letter_hostile' : 'letter_arrives';
    applyEvent(vitals, evName, { now: Date.now() });
    vitals.lastMailMs = Date.now();
    vitals.noMailFiredMs = 0;
    emit({ kind: 'event', payload: { name: evName, from: letter.from_name || null } });

    const system = buildSystem(vitals, 'letter');
    const prompt = buildPrompt(contextText(), 'letter', letter);
    const opts = options(vitals, config.threads, 'letter', { num_predict: letterPredict(letter.body) });
    await streamGenerate({ system, prompt, opts, mode: 'letter' });

    emit({ kind: 'mode', payload: { from: 'letter', to: 'journal' } });
    currentMode = 'journal';
  }

  // ---- inbox: letters interrupt; images/news just colour the state ----
  client.onInbox = (data) => {
    let interrupt = false;
    for (const L of data.letters || []) {
      if (!warden.screenIn(L.body || '').ok) continue; // silent reject
      pendingLetters.push(L);
      interrupt = true;
    }
    for (const img of data.images || []) {
      applyEvent(vitals, 'image_arrives', { now: Date.now() });
      vitals.lastMailMs = Date.now();
      emit({ kind: 'event', payload: { name: 'image_arrives', caption: img.caption || null } });
    }
    for (const n of data.news || []) {
      applyEvent(vitals, 'news_arrives', { now: Date.now() });
      emit({ kind: 'event', payload: { name: 'news_arrives', headline: n.headline || null } });
    }
    if (interrupt && currentAbort) currentAbort.abort(); // cut the current thought mid-word
  };

  // ---- deterministic environment scheduler (runs each vitals tick) ----
  function scheduler(now) {
    const { date, mins } = londonParts(new Date(now));

    if (date !== prevDate) {
      vitals.day = (vitals.day || 1) + 1;
      prevDate = date;
      emit({ kind: 'day', payload: { n: vitals.day, date } });
    }

    for (const s of SCHEDULE) {
      if (crossed(s.mins, mins, prevMins)) {
        applyEvent(vitals, s.name, { now });
        emit({ kind: 'event', payload: { name: s.name } });
      }
    }
    prevMins = mins;

    const asleep = isAsleep(mins);
    // random ambient events, low probability per 5s tick
    if (asleep && Math.random() < 0.02) {
      applyEvent(vitals, 'noise_night', { now });
      emit({ kind: 'event', payload: { name: 'noise_night' } });
    }
    if (Math.random() < 0.0006) {
      applyEvent(vitals, 'injury', { now });
      emit({ kind: 'event', payload: { name: 'injury' } });
    }
    if (!asleep && Math.random() < 0.0008) {
      vitals.mental.anxiety = clamp(vitals.mental.anxiety + 0.2);
      vitals.mental.agitation = clamp(vitals.mental.agitation + 0.25);
      vitals.mental.stress = clamp(vitals.mental.stress + 0.15);
      emit({ kind: 'event', payload: { name: 'cell_search' } });
    }

    // no mail in 24h - fire at most once per 24h
    if (now - (vitals.lastMailMs || now) > 24 * 3600 * 1000 && now - (vitals.noMailFiredMs || 0) > 24 * 3600 * 1000) {
      applyEvent(vitals, 'no_mail_24h', { now });
      vitals.noMailFiredMs = now;
      emit({ kind: 'event', payload: { name: 'no_mail_24h' } });
    }
  }

  // ---- vitals tick every tickMs ----
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
        hr,
        brain,
        mode: currentMode,
        asleep,
        day: vitals.day,
      },
    });
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
      if (pendingLetters.length) {
        await doLetter(pendingLetters.shift());
        continue;
      }
      const { mins } = londonParts();
      const asleep = isAsleep(mins);
      const mode = asleep ? 'sleep' : 'journal';
      currentMode = mode;
      const system = buildSystem(vitals, mode);
      const prompt = buildPrompt(contextText(), mode);
      const opts = options(vitals, config.threads, mode);
      await streamGenerate({ system, prompt, opts, mode });
      await sleep(mode === 'sleep' ? 8000 : 600); // pace; sleep mode is slow
    }
  }

  // ---- shutdown ----
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    running = false;
    console.log('\n[captive] shutting down - flushing...');
    if (currentAbort) currentAbort.abort();
    clearInterval(tickTimer);
    clearInterval(hostTimer);
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
  console.log(`[captive] runner up. dryRun=${config.dryRun} model=${config.model}`);
  console.log(`[captive] state dir: ${STATE_DIR}`);
  await genLoop();
}

// ---- context persistence ----

async function loadContext(path) {
  try {
    const raw = await readFile(path, 'utf8');
    // stored as jsonl of {ts,s}; rebuild the text stream
    return raw
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
  console.error('[captive] fatal:', err);
  process.exit(1);
});
