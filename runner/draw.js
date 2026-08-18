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
// A drawing is a PICTURE, not a caption. At most this many scrawled labels (T)
// may survive - a crude doodle needs no words - and if MORE than this fraction of
// the commands are labels the whole thing has degenerated into transcription and
// is rejected (see validateDrawing). MAX_SUBJECT_WORDS caps the stage-1 subject so
// a line of journal prose can never masquerade as "the thing he is drawing".
export const MAX_TEXT_STROKES = 1;
export const MAX_TEXT_FRAC = 0.34;
export const MAX_SUBJECT_WORDS = 6;

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

// Serialise parsed strokes BACK to the DSL text, so a later build-up pass can be
// shown "the drawing so far" and add to it (and so a stroke has a stable signature
// for de-duplication). Round to the coarse grid the model works in. The inverse of
// parseStrokes for the command set; unknown shapes are skipped.
const r0 = (n) => Math.round(Number(n) || 0);
export function strokesToDsl(strokes) {
  const out = [];
  for (const s of strokes || []) {
    if (!s || typeof s !== 'object') continue;
    switch (s.t) {
      case 'P':
      case 'L':
        if (s.pts && s.pts.length >= 2) out.push(s.t + ' ' + s.pts.map(([x, y]) => `${r0(x)},${r0(y)}`).join(' '));
        break;
      case 'D':
        out.push(`D ${r0(s.x)},${r0(s.y)}`);
        break;
      case 'C':
        out.push(`C ${r0(s.x)},${r0(s.y)} ${r0(s.r)}`);
        break;
      case 'A':
        out.push(`A ${r0(s.x)},${r0(s.y)} ${r0(s.r)} ${r0(s.a1)} ${r0(s.a2)}`);
        break;
      case 'H':
        if (s.pts && s.pts.length >= 2) out.push(`H ${r0(s.pts[0][0])},${r0(s.pts[0][1])} ${r0(s.pts[1][0])},${r0(s.pts[1][1])} ${s.n || 4}`);
        break;
      case 'T':
        out.push(`T ${r0(s.x)},${r0(s.y)} ${s.text}`);
        break;
      default:
        break;
    }
  }
  return out.join('\n');
}

// The stable signature of a single stroke, for de-duping a build-up pass that
// re-emits geometry already on the page.
export function strokeSig(s) {
  return strokesToDsl([s]);
}

// Reject a parsed drawing that has degenerated into transcription: too many of the
// commands are scrawled labels (T), or there is not enough real geometry to be a
// picture at all. On success the surviving strokes are returned with any labels
// beyond `maxText` dropped, so a good drawing keeps at most one word. `min` is the
// floor of GEOMETRIC (non-label) strokes required - MIN_STROKES for the base pass,
// 1 for an additive detail/shade pass. Returns { ok, reason, strokes }.
export function validateDrawing(strokes, { min = MIN_STROKES, maxText = MAX_TEXT_STROKES } = {}) {
  const arr = Array.isArray(strokes) ? strokes : [];
  const text = arr.filter((s) => s && s.t === 'T');
  const geom = arr.filter((s) => s && s.t !== 'T');
  // more than a small fraction of labels -> he transcribed the caption, not a drawing
  if (arr.length && text.length / arr.length > MAX_TEXT_FRAC) {
    return { ok: false, reason: 'word-heavy', strokes: [] };
  }
  if (geom.length < min) {
    return { ok: false, reason: 'too-few', strokes: [] };
  }
  // keep the geometry in order, dropping labels past the cap (0 on a later pass)
  let kept = 0;
  const out = arr.filter((s) => (s && s.t === 'T' ? kept++ < maxText : true));
  return { ok: true, reason: 'ok', strokes: out };
}

// A stage-1 subject must be a handful of words naming a concrete thing ('the yard',
// 'bills face'), NOT a sentence of his journal prose. True when it reads as prose
// (too many words) or is empty - the caller then skips the drawing quietly.
export function subjectLooksProse(subject) {
  const t = String(subject || '').trim();
  if (!t) return true;
  return t.split(/\s+/).filter(Boolean).length > MAX_SUBJECT_WORDS;
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
    'in ONE short line, in your voice (lowercase, shorthand, no full stop needed), NAME the concrete ' +
    'thing you are drawing - a handful of words, like "the yard", "a door", "bills face", "the window", ' +
    '"plan of the cell". just the thing (a word of why is fine), then stop. do NOT write a sentence of ' +
    'prose, do NOT keep the journal going, do NOT draw it in words or list strokes or coordinates.';
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

// STAGE 1 prompt. Deliberately NOT the ordinary journal continuation prompt: that
// one reprises his own recent prose right before the cue, which makes an 8B carry
// the journal straight on instead of naming a subject (the bug where the "subject"
// came back as more diary text). Here the LAST thing the model reads is the naming
// cue, not his prose, so it breaks off and names the thing. Context is kept ahead
// of the directives for mood, but no prose reprise follows.
export function drawDecidePrompt(contextTail, directives) {
  const parts = [];
  const ctx = (contextTail || '').trim();
  if (ctx) parts.push(ctx);
  const zoneC = (directives || '').trim();
  if (zoneC) parts.push(zoneC);
  parts.push(
    '[you stop writing and pick up a scrap of paper to DRAW, not write. before the picture, ONE line: ' +
      'name the concrete thing you are about to draw - a few words, lowercase, no full stop. then stop.]',
  );
  return parts.join('\n\n');
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
    'You are drawing a PICTURE, not writing. Draw the SHAPE of the thing with lines - do NOT spell the',
    'subject out in letters. A crude prison doodle needs no words. Use the T label at most ONCE in a whole',
    'drawing, and only for a single tiny scrawl if you truly must; otherwise never use T.',
    '',
    'Output ONLY drawing commands, one per line, on a 0-100 grid (x left-to-right, y top-to-bottom).',
    'NO prose, NO explanation, NO numbering, NO blank commentary. The commands are:',
    '  P x,y x,y x,y ...   a freehand line through the points',
    '  L x,y x,y           a straight line',
    '  D x,y               a dot or a stab',
    '  C x,y r             a circle, radius r',
    '  A x,y r a1 a2       an arc from angle a1 to a2 (degrees)',
    '  H x,y x,y n         n scratchy shading strokes between two corners',
    '  T x,y text          a scrawled label (AT MOST ONE, usually none)',
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

// STAGE 2, BASE PASS prompt: lay down the main shapes of the thing, crude and
// quick. `badly` loosens it further. Names the subject ONLY (never his prose) and
// hammers shape-not-words, since the failure mode is transcribing the caption.
export function drawDslPrompt(subject, { badly = false } = {}) {
  const how = badly ? ' rushed and careless, you do not care if it is any good.' : '';
  return (
    'Draw this as a crude PICTURE - lines and shapes only, NOT the written words.' +
    how +
    '\nThe thing: ' +
    subject +
    '\nStart with the main shapes. commands only:\n'
  );
}

// STAGE 2, BUILD-UP PASS prompt: shown the drawing so far, add a little to it.
// `pass` is 'detail' (a few dots/marks/short lines) or 'shade' (a bit of rough
// hatching). Each pass is generated separately and validated, so a pass that adds
// nothing usable (returns END) is simply dropped rather than appending junk.
export function drawPassPrompt(subject, priorDsl, pass) {
  const what =
    pass === 'shade'
      ? 'Add a little rough shading with H (hatch) where a surface or shadow would be. A few strokes only.'
      : 'Add a FEW small details - a dot, a mark, a short line - lining up with what is already there.';
  const nothing =
    pass === 'shade' ? 'If it needs no shading, output only: END' : 'If there is nothing worth adding, output only: END';
  return (
    `Your drawing of "${subject}" so far, on the same 0-100 grid:\n` +
    (priorDsl || '') +
    `\n\n${what} Do NOT redraw what is there, do NOT write any words. ${nothing}\ncommands only:\n`
  );
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
