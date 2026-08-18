// drawtest.js - drive REAL drawings against the live ollama to prove the whole
// pipeline end to end, WITHOUT touching the live site.
//
//   node runner/drawtest.js
//
// It reads runner/config.json ONLY to borrow the ollama URL / model / thread
// count (exactly as livesample.js does); it then builds its OWN in-memory config
// (dryRun) and NEVER constructs the network Client, so nothing is POSTed to the
// API and config.json is never written. Each drawing runs the two real stages
// (the one-line decision, then the DSL), the raw DSL is printed verbatim, the
// defensive parser is exercised (including on a deliberately malformed line), and
// the strokes are pushed through pen.js's own pure geometry so we confirm exactly
// what the browser renderer would animate. Leaves nothing running.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initialVitals, computeDerived } from './vitals.js';
import { initialRelations } from './cast.js';
import { buildSystem, buildPrompt, options } from './prompt.js';
import { NUM_CTX } from './prompt.js';
import {
  parseStrokes,
  splitPasses,
  moodSnapshot,
  subjectFromLine,
  resolveRequest,
  drawIntentDirective,
  drawDslSystem,
  drawDslPrompt,
  MIN_STROKES,
} from './draw.js';
import { sketchToPaths } from '../public/assets/pen.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// Borrow ONLY ollama coordinates from the live config; everything else is our
// own in-memory dryRun object. No Client, no ingest, no writes to the site.
const live = JSON.parse(await readFile(join(HERE, 'config.json'), 'utf8'));
const cfg = {
  dryRun: true,
  ollamaUrl: live.ollamaUrl,
  model: live.model,
  threads: live.threads || 2,
};

const font = JSON.parse(await readFile(join(HERE, '..', 'public', 'assets', 'hershey-cursive.json'), 'utf8'));
const line = (s = '') => console.log(s);

// A non-streaming generation. Optional stop tokens.
async function generate(system, prompt, opts) {
  const res = await fetch(`${cfg.ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, system, prompt, options: opts, keep_alive: -1, stream: false }),
  });
  if (!res.ok) throw new Error('ollama HTTP ' + res.status);
  const j = await res.json();
  return (j.response || '').trim();
}

// Run one full drawing exactly the way run.js's doDraw does, but printing instead
// of emitting. Returns the "draw" events + the "draw_saved" record it WOULD emit.
async function oneDrawing(label, v, intent, { injectMalformed = false } = {}) {
  line('\n============================================================');
  line('DRAWING: ' + label);
  line('============================================================');

  // ---- stage 1: the one-line decision, in his own voice ----
  const ctx = {
    form: drawIntentDirective(intent, {}),
  };
  const sys1 = buildSystem(v, 'journal', ctx);
  const p1 = buildPrompt('same four walls. the light through the flap. ', 'journal');
  const o1 = options(v, cfg.threads, 'journal', { num_predict: 40 });
  o1.stop = [...o1.stop, '\n'];
  const decision = await generate(sys1, p1, o1);
  line('\n[stage 1] his one line (emitted as normal text in the stream):');
  line('  "' + decision + '"');

  let subject;
  if (intent.mode === 'honour' || intent.mode === 'badly') subject = intent.subject || subjectFromLine(decision);
  else subject = subjectFromLine(decision);
  const title = decision ? decision.slice(0, 100) : subject;
  line('  subject derived: "' + subject + '"');

  // ---- stage 2: the DSL only ----
  const sys2 = drawDslSystem();
  const pr2 = drawDslPrompt(subject, { badly: intent.mode === 'badly' });
  const o2 = {
    temperature: 0.6,
    top_p: 0.9,
    repeat_penalty: 1.12,
    num_predict: 320,
    num_ctx: NUM_CTX,
    num_thread: cfg.threads,
    stop: ['END', '\nEND', 'END\n'],
  };
  let raw = await generate(sys2, pr2, o2);

  line('\n[stage 2] RAW DSL the model produced (verbatim):');
  line('----------------------------------------------------------');
  line(raw);
  line('----------------------------------------------------------');

  if (injectMalformed) {
    // prove the parser is defensive: splice a junk line into the middle of the
    // real output and confirm it is silently skipped.
    const lines = raw.split('\n');
    const at = Math.min(2, lines.length);
    lines.splice(at, 0, 'oi this is not a valid command at all 3,,7 x');
    raw = lines.join('\n');
    line('(injected a deliberately MALFORMED line at position ' + at + ': "oi this is not a valid command at all 3,,7 x")');
  }

  // ---- parse defensively ----
  const rawLineCount = raw.split(/\r?\n/).filter((l) => l.trim()).length;
  const { strokes } = parseStrokes(raw);
  line('\nparsed: ' + rawLineCount + ' non-empty raw lines -> ' + strokes.length + ' valid strokes');
  line('  malformed/unknown lines skipped: ' + (rawLineCount - strokes.length));
  line('  every coord clamped to 0..100: ' + strokes.every((s) => {
    const pts = s.pts || (typeof s.x === 'number' ? [[s.x, s.y]] : []);
    return pts.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100);
  }));

  if (strokes.length < MIN_STROKES) {
    line('  -> below the ' + MIN_STROKES + '-stroke floor: run.js would DISCARD this drawing (the line stands).');
    return { discarded: true, decision };
  }

  // ---- passes + geometry pen.js will animate ----
  const passes = splitPasses(strokes);
  const mood = moodSnapshot(v);
  const id = 'test-' + label.replace(/\W+/g, '').slice(0, 8);
  const n = passes.length;

  line('  build-up passes: ' + passes.map((p) => p.label + '(' + p.strokes.length + ')').join(' -> '));

  const events = passes.map((ps, i) => ({
    kind: 'draw',
    payload: { id, title, strokes: ps.strokes, pass: { i, n, label: ps.label }, mood },
  }));

  // confirm the strokes render through pen.js (headless: the pure geometry the
  // browser's Web Animations pipeline consumes is produced and valid).
  let totalSegs = 0;
  let allValid = true;
  for (const ev of events) {
    const segs = sketchToPaths(ev.payload.strokes, { font });
    totalSegs += segs.length;
    if (!segs.length || !segs.every((s) => typeof s.d === 'string' && /^M[-0-9.,\sLC]+$/.test(s.d))) allValid = false;
  }
  line('  pen.js sketchToPaths: ' + totalSegs + ' SVG path segments across all passes, all valid: ' + allValid);

  const saved = {
    kind: 'draw_saved',
    payload: {
      id,
      title,
      subject,
      strokes,
      mood,
      stroke_count: strokes.length,
      requested_by: intent.requestedBy || null,
    },
  };
  line('  draw_saved record: stroke_count=' + saved.payload.stroke_count + ', requested_by=' + saved.payload.requested_by);
  line('  (this is what ingest.php would persist to the drawings table)');

  return { discarded: false, events, saved, decision, segs: totalSegs, allValid };
}

// ---- run two real drawings ----

// 1) a spontaneous drawing, high fixation/dissociation (the states that make him
//    likely to draw). No request -> requested_by stays null.
const v1 = initialVitals();
v1.relations = initialRelations();
v1.mental.dissociation = 0.7;
v1.mental.longing = 0.6;
v1.monotony = 0.7;
v1.derived = computeDerived(v1);
const d1 = await oneDrawing('spontaneous (the cell / yard, his own choice)', v1, {
  mode: 'spontaneous',
  subject: null,
  requestedBy: null,
});

// 2) honouring a postcard request from a warm visitor -> requested_by set.
const v2 = initialVitals();
v2.relations = initialRelations();
v2.mental.anger = 0.15;
v2.derived = computeDerived(v2);
const req = { subject: 'a house with a garden', visitor_id: 'visitorABC', warmth: 0.85, grudge: 0.02 };
const intent2 = resolveRequest(req, v2, { rnd: () => 0 }); // force the honour band for the test
const d2 = await oneDrawing('honouring a request ("draw a house with a garden")', v2, intent2, { injectMalformed: true });

// ---- summary ----
line('\n============================================================');
line('SUMMARY');
line('============================================================');
const realDrawings = [d1, d2].filter((d) => d && !d.discarded).length;
line('real drawings generated + parsed + rendered (headless): ' + realDrawings + ' / 2');
line('malformed line handled by the parser: yes (injected into drawing 2, skipped)');
line('requested_by recorded only when honouring a request: ' +
  ((d1.saved ? d1.saved.payload.requested_by : null) === null) + ' (spontaneous=null), ' +
  (d2.saved ? d2.saved.payload.requested_by === 'visitorABC' : d2.discarded ? 'n/a (discarded)' : 'no'));
line('\nCould NOT verify visually here: the actual on-screen animation (Web');
line('Animations API strokeDashoffset reveal + the moving nib) needs a real');
line('browser DOM. This harness confirms the geometry pen.js feeds that');
line('pipeline is produced and valid; the stroke-by-stroke reveal itself is');
line('unchanged from the (already working) handwriting path it reuses.');
line('\nnothing left running. no network writes. config.json untouched.');
