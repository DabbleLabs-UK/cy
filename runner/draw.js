// draw.js - CY draws.
//
// Drawing is not a second renderer: it is the SAME pen engine (public/assets/
// pen.js) fed a coarse 0-100 stroke DSL instead of glyphs. This module owns the
// runner-side half of that: parsing the DSL the model emits (defensively - the
// model WILL emit rubbish lines), deciding WHEN he draws and WHAT, splitting a
// drawing into build-up passes, and the two-stage prompt text (he decides in one
// line of his own voice, then a second generation produces only the DSL).
//
// Nothing here talks to ollama or the network; run.js drives the generations and
// emits the events. Pure functions, so selftest.js can exercise the lot.

import { clamp } from './vitals.js';

// ---- the stroke DSL -------------------------------------------------------
//
//   P x,y x,y x,y ...   polyline (freehand)
//   L x,y x,y           straight line
//   D x,y               dot / stab
//   C x,y r             circle radius r
//   A x,y r a1 a2       arc, degrees a1..a2
//   H x,y x,y n         hatch/shading between two corners, n strokes
//   T x,y text          a scrawled label
//
// Coarse grid keeps token cost and coordinate errors down. Everything is clamped
// to the grid; the whole drawing is capped; any single polyline's points are
// capped; a drawing that parses to fewer than MIN_STROKES valid commands is
// worthless and discarded by the caller.

export const GRID = 100;
export const MAX_STROKES = 120;
export const MAX_POLY_PTS = 64;
export const MIN_STROKES = 3;

const clampGrid = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(GRID, v));
};

// "x,y" -> [x,y] clamped, or null if malformed.
function parsePair(tok) {
  const parts = String(tok).split(',');
  if (parts.length !== 2) return null;
  const x = clampGrid(parts[0]);
  const y = clampGrid(parts[1]);
  if (x === null || y === null) return null;
  return [x, y];
}

// Parse the raw DSL text into an array of normalised stroke objects. Bad lines
// are skipped silently; caps are enforced. Returns { strokes, count }.
export function parseStrokes(text, { maxStrokes = MAX_STROKES, maxPts = MAX_POLY_PTS } = {}) {
  const out = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    if (out.length >= maxStrokes) break;
    const line = rawLine.trim();
    if (!line) continue;
    const op = line[0].toUpperCase();
    const rest = line.slice(1).trim();
    const toks = rest.split(/\s+/).filter(Boolean);
    switch (op) {
      case 'P': {
        const pts = [];
        for (const t of toks) {
          const p = parsePair(t);
          if (p) pts.push(p);
          if (pts.length >= maxPts) break;
        }
        if (pts.length >= 2) out.push({ t: 'P', pts });
        break;
      }
      case 'L': {
        const a = parsePair(toks[0]);
        const b = parsePair(toks[1]);
        if (a && b) out.push({ t: 'L', pts: [a, b] });
        break;
      }
      case 'D': {
        const a = parsePair(toks[0]);
        if (a) out.push({ t: 'D', x: a[0], y: a[1] });
        break;
      }
      case 'C': {
        const a = parsePair(toks[0]);
        const r = Number(toks[1]);
        if (a && Number.isFinite(r)) out.push({ t: 'C', x: a[0], y: a[1], r: Math.max(0.5, Math.min(60, r)) });
        break;
      }
      case 'A': {
        const a = parsePair(toks[0]);
        const r = Number(toks[1]);
        const a1 = Number(toks[2]);
        const a2 = Number(toks[3]);
        if (a && Number.isFinite(r) && Number.isFinite(a1) && Number.isFinite(a2)) {
          out.push({ t: 'A', x: a[0], y: a[1], r: Math.max(0.5, Math.min(60, r)), a1, a2 });
        }
        break;
      }
      case 'H': {
        const a = parsePair(toks[0]);
        const b = parsePair(toks[1]);
        let n = parseInt(toks[2], 10);
        if (!Number.isFinite(n)) n = 4;
        n = Math.max(1, Math.min(24, n));
        if (a && b) out.push({ t: 'H', pts: [a, b], n });
        break;
      }
      case 'T': {
        const a = parsePair(toks[0]);
        if (a) {
          const sp = rest.indexOf(' ');
          const label = sp >= 0 ? rest.slice(sp + 1).trim().slice(0, 40) : '';
          if (label) out.push({ t: 'T', x: a[0], y: a[1], text: label });
        }
        break;
      }
      default:
        continue; // not a known command - drop the line
    }
  }
  return { strokes: out, count: out.length };
}

// Split a drawing into build-up passes so the viewer sees it BUILD rather than
// appear in one go: rough structure first (lines, circles, arcs, freehand), then
// detail (dots, labels), then shading (hatch). A doodle (few strokes) stays one
// pass. Returns [{ label, strokes }...], never empty.
export function splitPasses(strokes) {
  if (!Array.isArray(strokes) || strokes.length <= 6) {
    return [{ label: 'sketch', strokes: strokes || [] }];
  }
  const under = [];
  const detail = [];
  const shade = [];
  for (const s of strokes) {
    if (s.t === 'H') shade.push(s);
    else if (s.t === 'D' || s.t === 'T') detail.push(s);
    else under.push(s);
  }
  const passes = [];
  if (under.length) passes.push({ label: 'under', strokes: under });
  if (detail.length) passes.push({ label: 'detail', strokes: detail });
  if (shade.length) passes.push({ label: 'shade', strokes: shade });
  return passes.length ? passes : [{ label: 'sketch', strokes }];
}

// A shallow snapshot of the vitals that shape the marks + get stored with the
// drawing (the mood he drew it in).
export function moodSnapshot(v) {
  return {
    physical: { ...(v.physical || {}) },
    mental: { ...(v.mental || {}) },
    derived: { ...(v.derived || {}) },
  };
}

// ---- when he draws --------------------------------------------------------
//
// Occasional, not constant: roughly one drawing per 20-40 minutes of waking
// time, weighted by state - likelier when fixation, dissociation or longing are
// high, when a postcard image just arrived, or when he is waiting on something.
// Never while asleep. Checked once per waking burst opportunity; a hard gap
// floor stops it clustering, and the odds climb the longer it has been so it
// does not go silent for hours.
export const DRAW_MIN_GAP_MS = 18 * 60 * 1000;

export function drawDecision(v, opts = {}) {
  const {
    asleep = false,
    sinceDrawMs = Infinity,
    waiting = false,
    recentImage = false,
    hasRequestPending = false,
    rnd = Math.random,
  } = opts;
  if (asleep) return { draw: false };
  // a queued request short-circuits the long gap (someone asked), but still not
  // instantly - he gets to it in his own time.
  const floor = hasRequestPending ? DRAW_MIN_GAP_MS * 0.25 : DRAW_MIN_GAP_MS;
  if (sinceDrawMs < floor) return { draw: false };

  const m = v.mental || {};
  const d = v.derived || {};
  let p = 0.04 + 0.12 * (d.fixation || 0) + 0.12 * (m.dissociation || 0) + 0.1 * (m.longing || 0);
  if (waiting) p += 0.08;
  if (recentImage) p += 0.15;
  if (hasRequestPending) p += 0.4;
  // climb over the ~22 min past the floor so it never stalls for long
  const over = clamp((sinceDrawMs - floor) / (22 * 60 * 1000));
  p += 0.15 * over;
  p = clamp(p, 0, 0.9);
  return { draw: rnd() < p };
}

// ---- requests -------------------------------------------------------------
//
// A postcard can ask him to draw something. Simple pattern match, NO LLM
// classifier. Returns { isRequest, subject } or null.
const REQUEST_RX = /\b(draw|sketch|doodle|paint)\b|\bpic(ture)?\s+of\b/i;
const SUBJECT_RX =
  /\b(?:draw|sketch|doodle|paint|(?:a\s+)?picture\s+of|(?:a\s+)?pic\s+of|drawing\s+of)\s+(?:me\s+|us\s+|a\s+|an\s+|the\s+|some\s+|your\s+)?([^.!?\n]{2,60})/i;

export function detectDrawRequest(body) {
  const t = String(body || '');
  if (!REQUEST_RX.test(t)) return null;
  const m = t.match(SUBJECT_RX);
  let subject = m ? m[1].trim() : '';
  subject = subject
    .replace(/\bfor\s+(me|us)\b.*$/i, '')
    .replace(/\bplease\b.*$/i, '')
    .replace(/[?!.,].*$/, '')
    .trim();
  return { isRequest: true, subject: subject.slice(0, 60) };
}

// Whether/how he honours a request, weighted by his standing toward the sender
// and his current mood. He may honour it, honour it badly, or refuse and draw
// something of his own. Returns { mode, subject, requestedBy }.
export function resolveRequest(req, v, { rnd = Math.random } = {}) {
  const m = v.mental || {};
  const warmth = typeof req.warmth === 'number' ? req.warmth : 0.3;
  const grudge = typeof req.grudge === 'number' ? req.grudge : 0.05;
  const anger = m.anger || 0;
  const despair = m.despair || 0;

  let honour = Math.max(0, 0.45 + 0.5 * warmth - 0.6 * grudge - 0.3 * anger - 0.2 * despair);
  let refuse = Math.max(0, 0.15 + 0.6 * grudge + 0.35 * anger);
  let badly = Math.max(0, 0.25 + 0.3 * anger + 0.2 * despair - 0.3 * warmth);
  const total = honour + refuse + badly || 1;

  const subject = (req.subject && req.subject.trim()) || 'what they asked for';
  const r = rnd() * total;
  if (r < honour) return { mode: 'honour', subject, requestedBy: req.visitor_id || null };
  if (r < honour + refuse) return { mode: 'refuse', subject: null, requestedBy: null };
  return { mode: 'badly', subject, requestedBy: req.visitor_id || null };
}

// A short subject keyword pulled out of his one-line decision, for the fixation
// "keeps drawing the same thing" memory and the stored subject.
export function subjectFromLine(line) {
  let s = String(line || '').toLowerCase().trim();
  // prefer whatever follows a draw/sketch verb ANYWHERE in the line - the model
  // often buries the subject mid-thought ("...got pen on paper drawing the yard").
  // Match FIRST, so an earlier reason clause elsewhere in the line does not eat it.
  const m = s.match(
    /\b(?:draw(?:ing|in|n)?|sketch(?:ing|in)?|doodl(?:ing|e))\s+(?:a |an |the |me |us |this |that |my |some )?(.+)/,
  );
  if (m && m[1]) s = m[1];
  // then drop a trailing reason clause on the subject itself ("the yard cos i forget")
  s = s.split(/\b(?:cos|cus|coz|cause|because|innit|so i)\b/)[0];
  s = s.replace(/[^a-z0-9 ']/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, 60) || 'the same shape again';
}

// ---- prompts --------------------------------------------------------------

// STAGE 1: a FORM directive fed to the normal voice system, so his decision is
// written in his own hand as one short line and lands in the stream. He must NOT
// draw in words here - just say what and why, then stop.
export function drawIntentDirective(intent, { redrawSubject = null } = {}) {
  const one =
    'in ONE short line, in your voice (lowercase, shorthand, no full stop needed), say what you are ' +
    'drawing and why. JUST that one line, then stop. do NOT draw it in words, do NOT list strokes or ' +
    'coordinates, do NOT describe how it looks.';
  if (intent.mode === 'honour') {
    return `FORM: someone outside asked you to draw ${intent.subject}. you are going to do it. ${one}`;
  }
  if (intent.mode === 'badly') {
    return `FORM: someone outside asked you to draw ${intent.subject}. you will, but grudgingly - it will be rubbish and you do not much care. ${one}`;
  }
  if (intent.mode === 'refuse') {
    return `FORM: someone asked you to draw ${intent.subject || 'something'} and you are not doing that. instead you draw something of your own. ${one}`;
  }
  if (redrawSubject) {
    return `FORM: you pick the pen up again and draw ${redrawSubject} - the same thing you keep drawing, you cannot leave it alone. ${one}`;
  }
  return (
    'FORM: you pick up a biro and a scrap of paper to draw something crude and quick from in here - ' +
    'the yard, the door, a face, a tally, the plan of your cell, an arrow, a shape you keep doing. ' +
    one
  );
}

// STAGE 2: the DSL-only system. Says plainly he has no talent and little time,
// gives the command grammar, and shows deliberately crude few-shot examples. A
// hard stop token (END) plus the strict "commands only" instruction keep prose
// out.
export function drawDslSystem() {
  return [
    'You draw the way a man draws with a cheap biro on the back of a form: crude, simple, quick. No',
    'talent, no time, not trying to make art. A few lines. Stick figures, a door, a window, a face made',
    'of three marks, a tally, the plan of a cell, an arrow, a shape you keep redrawing. If in doubt, use',
    'FEWER lines and make it cruder.',
    '',
    'Output ONLY drawing commands, one per line, on a 0-100 grid (x left-to-right, y top-to-bottom).',
    'NO prose, NO explanation, NO numbering, NO blank commentary. The commands are:',
    '  P x,y x,y x,y ...   a freehand line through the points',
    '  L x,y x,y           a straight line',
    '  D x,y               a dot or a stab',
    '  C x,y r             a circle, radius r',
    '  A x,y r a1 a2       an arc from angle a1 to a2 (degrees)',
    '  H x,y x,y n         n scratchy shading strokes between two corners',
    '  T x,y text          a scrawled label',
    'When the drawing is done, output a line containing only: END',
    '',
    'Example - a stick figure:',
    'C 50,18 8',
    'L 50,26 50,58',
    'L 50,36 37,48',
    'L 50,36 63,48',
    'L 50,58 40,80',
    'L 50,58 60,80',
    'END',
    '',
    'Example - the cell door:',
    'L 28,12 28,88',
    'L 28,12 68,12',
    'L 68,12 68,88',
    'L 28,88 68,88',
    'D 61,50',
    'T 33,97 door',
    'END',
    '',
    'Example - a tally of the days:',
    'L 20,40 20,60',
    'L 30,40 30,60',
    'L 40,40 40,60',
    'L 50,40 50,60',
    'L 15,52 55,48',
    'END',
  ].join('\n');
}

// STAGE 2 prompt: name the thing, crude and quick. `badly` loosens it further.
export function drawDslPrompt(subject, { badly = false } = {}) {
  const how = badly ? ' rushed and careless, you do not care if it is any good.' : '';
  return `Draw this, crude and quick, commands only:${how}\n${subject}\n`;
}

// ---- the dream drawing ----------------------------------------------------
//
// Asleep, he draws ABSURDLY SLOWLY: one stroke every 1-2 minutes, so a single
// abstract shape emerges over an hour or more. Someone checking the page at 4am
// sees one more line than there was at 3am. At most ONE dream drawing per night,
// started at a random point in the small hours. The strokes are generated here
// (deterministic given `rnd`, no model call) as the SAME stroke DSL the pen
// consumes - abstract, not representational: concentric marks, a shape gone over
// and over, something enclosing something else.

// The small hours - the window a dream drawing may START in (01:00-05:00).
export const SMALL_HOURS_START = 1 * 60;
export const SMALL_HOURS_END = 5 * 60;
export function isSmallHours(mins) {
  return mins >= SMALL_HOURS_START && mins < SMALL_HOURS_END;
}
// A random minute-of-day to begin the night's one drawing, kept inside the small
// hours with room to spare before it ends.
export function pickDreamStartMin(rnd = Math.random) {
  const span = SMALL_HOURS_END - SMALL_HOURS_START - 20; // leave >=20 min of window
  return SMALL_HOURS_START + Math.floor(rnd() * Math.max(1, span));
}

// One stroke every 1-2 minutes. Returned per stroke so each mark is paced apart.
export function dreamStrokeGapMs(rnd = Math.random) {
  return Math.round((60 + rnd() * 60) * 1000); // 60_000 .. 120_000
}

// Build the night's abstract drawing as an ordered stroke list. Repeated motifs:
// a stack of concentric circles, the same arc gone over again and again, a box
// enclosing the lot, and a mark at the centre stabbed a few times. Coordinates
// stay on the 0-100 grid the pen expects.
export function dreamDrawing(rnd = Math.random) {
  const clampG = (n) => Math.max(4, Math.min(96, Math.round(n)));
  const cx = 42 + Math.round(rnd() * 12);
  const cy = 42 + Math.round(rnd() * 12);
  const strokes = [];
  // concentric marks: something enclosing something else, ring after ring
  const rings = 5 + Math.floor(rnd() * 4); // 5..8
  for (let i = 0; i < rings; i++) {
    const r = Math.min(40, 5 + i * (3 + rnd() * 3));
    strokes.push({ t: 'C', x: cx, y: cy, r });
  }
  // a shape gone over again and again: the same arc, redrawn with a small drift
  const reps = 3 + Math.floor(rnd() * 3); // 3..5
  for (let i = 0; i < reps; i++) {
    const r = 18 + rnd() * 10;
    strokes.push({ t: 'A', x: cx, y: cy, r, a1: 20 + i * 6, a2: 300 + i * 9 });
  }
  // the box around it all
  const h = 34;
  const corners = [
    [cx - h, cy - h],
    [cx + h, cy - h],
    [cx + h, cy + h],
    [cx - h, cy + h],
  ].map(([x, y]) => [clampG(x), clampG(y)]);
  for (let i = 0; i < 4; i++) {
    strokes.push({ t: 'L', pts: [corners[i], corners[(i + 1) % 4]] });
  }
  // the centre, gone over
  for (let i = 0; i < 3; i++) {
    strokes.push({ t: 'D', x: clampG(cx + (rnd() * 2 - 1)), y: clampG(cy + (rnd() * 2 - 1)) });
  }
  return strokes;
}
