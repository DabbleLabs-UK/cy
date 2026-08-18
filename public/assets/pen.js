// pen.js - the CY handwriting renderer.
//
// Draws incoming text as real single-stroke handwriting: an animated pen lays
// down each Hershey "cursive" glyph stroke by stroke, in order, using the Web
// Animations API to reveal the ink along the stroke path (strokeDashoffset).
//
// The renderer is fed:
//   pen.write(str, mode)   - queue text to be handwritten
//   pen.setVitals(payload) - fatigue/agitation/despair/lucidity modulate style
//   pen.setMode(mode)      - 'letter' switches to unruled paper + salutation
//   pen.abort()            - trail off the current stroke, leave the scar
//
// Coordinate facts (verified, do not re-derive):
//   glyph lookup index   = charCodeAt(0) - 33   (space has no glyph)
//   glyph = {d, o}       d = polylines split on 'M'; o = HALF advance width
//   baseline y = 22, ascender top y = 1, descenders reach y = 34
//   scale = size / 21    (size = desired cap height in px)
//   real advance         = o * 2 * scale

const SVGNS = 'http://www.w3.org/2000/svg';
const BASELINE = 22; // glyph-space baseline

// ---- glyph parsing --------------------------------------------------------

// Parse a Hershey "d" string into an array of strokes; each stroke is an array
// of [x,y] points. Segments are separated by 'M'; within a segment points are
// separated by 'L' or whitespace as "x,y".
function parseGlyph(d) {
  const strokes = [];
  for (const seg of d.split('M')) {
    const s = seg.trim();
    if (!s) continue;
    const pts = [];
    for (const tok of s.split(/[L\s]+/)) {
      const t = tok.trim();
      if (!t) continue;
      const c = t.split(',');
      if (c.length !== 2) continue;
      const x = parseFloat(c[0]);
      const y = parseFloat(c[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
    }
    if (pts.length) strokes.push(pts);
  }
  return strokes;
}

// Catmull-Rom -> cubic bezier, so the pen curves instead of plotting straight
// facets. Control points are p1 +/- (p2 - p0) / 6.
function strokeToPath(pts) {
  if (pts.length === 1) {
    // a lone point (e.g. the dot of an i): draw a tiny tick so it renders.
    const [x, y] = pts[0];
    return `M${x.toFixed(2)},${y.toFixed(2)} L${(x + 0.01).toFixed(2)},${y.toFixed(2)}`;
  }
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ---- sketch geometry ------------------------------------------------------
//
// A drawing is the SAME engine as handwriting: the model emits a coarse 0-100
// stroke DSL, we turn each command into SVG path "d" data in grid space, and the
// pen reveals it stroke by stroke through the exact same WAAPI queue. These
// converters are PURE and DOM-free (no document/window), so the runner and the
// headless tests can validate the geometry the renderer will consume without a
// browser. The Pen class wraps them in a scaled group and animates them.

function circlePathGrid(cx, cy, r, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return strokeToPath(pts);
}

function arcPathGrid(cx, cy, r, a1, a2, n = 20) {
  const s = (a1 * Math.PI) / 180;
  const e = (a2 * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = s + (e - s) * (i / n);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return strokeToPath(pts);
}

// n scratchy near-parallel shading strokes spanning the box of two corners.
function hatchPathsGrid([x1, y1], [x2, y2], n) {
  const xa = Math.min(x1, x2);
  const xb = Math.max(x1, x2);
  const ya = Math.min(y1, y2);
  const yb = Math.max(y1, y2);
  const N = Math.max(1, Math.min(24, n | 0));
  const slant = (xb - xa) * 0.14 + 1.5;
  const out = [];
  for (let k = 0; k < N; k++) {
    const t = N === 1 ? 0.5 : k / (N - 1);
    const fx = xa + (xb - xa) * t;
    const ex = Math.min(100, fx + slant);
    out.push(`M${fx.toFixed(2)},${ya.toFixed(2)} L${ex.toFixed(2)},${yb.toFixed(2)}`);
  }
  return out;
}

// A scrawled label rendered small with the same Hershey glyphs the hand uses,
// laid into grid space with its baseline at (x, y). Needs the font; without it,
// the label is silently dropped (defensive, like every other malformed input).
function glyphTextPathsGrid(text, x, y, size, font) {
  if (!font || !Array.isArray(font.chars)) return [];
  const scale = size / 21;
  const out = [];
  let cx = x;
  for (const ch of String(text)) {
    if (ch === ' ') {
      cx += 6 * scale;
      continue;
    }
    const idx = ch.charCodeAt(0) - 33;
    const raw = idx >= 0 && idx < font.chars.length ? font.chars[idx] : null;
    if (!raw || !raw.d) {
      cx += 6 * scale;
      continue;
    }
    for (const seg of parseGlyph(raw.d)) {
      out.push(strokeToPath(seg.map(([gx, gy]) => [cx + gx * scale, y + (gy - BASELINE) * scale])));
    }
    cx += raw.o * 2 * scale;
  }
  return out;
}

// One parsed DSL stroke -> zero or more grid-space "d" strings.
export function sketchStrokeToPaths(s, { font } = {}) {
  if (!s || typeof s !== 'object') return [];
  switch (s.t) {
    case 'P':
    case 'L':
      return s.pts && s.pts.length >= 2 ? [strokeToPath(s.pts)] : [];
    case 'D': {
      // a dot/stab: a minimal stroke; the round cap makes it a blob at pen width
      const x = Number(s.x);
      const y = Number(s.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      return [`M${x.toFixed(2)},${y.toFixed(2)} L${(x + 0.2).toFixed(2)},${y.toFixed(2)}`];
    }
    case 'C':
      return [circlePathGrid(s.x, s.y, s.r)];
    case 'A':
      return [arcPathGrid(s.x, s.y, s.r, s.a1, s.a2)];
    case 'H':
      return s.pts && s.pts.length >= 2 ? hatchPathsGrid(s.pts[0], s.pts[1], s.n) : [];
    case 'T':
      return glyphTextPathsGrid(s.text, s.x, s.y, 7, font);
    default:
      return [];
  }
}

// A whole pass -> a flat list of { d, dot } segments in grid space. Pure, so a
// headless caller can assert exactly what the renderer will draw.
export function sketchToPaths(strokes, opts = {}) {
  const out = [];
  for (const s of strokes || []) {
    for (const d of sketchStrokeToPaths(s, opts)) {
      if (d && d.length) out.push({ d, dot: s.t === 'D' });
    }
  }
  return out;
}

export class Pen {
  constructor(root, font) {
    this.root = root; // #paper element
    this.font = font; // { name, chars: [ {d,o} | null, ... ] }
    this.glyphCache = new Map();

    // ---- style baselines (modulated by vitals) ----
    this.size = 19; // cap height px
    this.penSpeed = 105; // svg units/sec at size 19
    this.strokeWidth = 1.7;
    this.inkOpacity = 0.92;
    this.jitterRot = 1.4; // +/- degrees
    this.jitterBase = 0.9; // +/- px baseline
    this.jitterScale = 0.035; // +/- x-scale fraction

    this.mode = 'journal';
    this.ruled = true;
    this.instant = false; // true during backlog fill: place ink without animating

    // ---- layout state ----
    this.marginX = 34;
    this.marginTop = 40;
    this.lineGap = 1.62; // multiple of size
    this.x = this.marginX;
    this.y = this.marginTop + this.size;
    this.midWord = false;

    // ---- job queue ----
    this.buf = '';
    this.jobs = []; // pending render jobs {type, ...}
    this.running = false;
    this.abortFlag = false;
    this.glyphNodes = []; // for pruning
    this._sketchBoxes = new Map(); // drawing id -> its reserved box, across passes

    this._buildSvg();
  }

  _buildSvg() {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'ink-svg');
    svg.setAttribute('preserveAspectRatio', 'xMinYMin slice');
    this.svg = svg;

    // ink layer (translated to scroll old lines up out of view)
    this.ink = document.createElementNS(SVGNS, 'g');
    this.ink.setAttribute('class', 'ink-layer');
    svg.appendChild(this.ink);

    // nib layer sits in the SVG root user space (never translated), so a point
    // mapped through path.getCTM() lands correctly over the ink without any
    // scroll correction.
    this.nibLayer = document.createElementNS(SVGNS, 'g');
    this.nibLayer.setAttribute('class', 'nib-layer');
    this.nib = document.createElementNS(SVGNS, 'circle');
    this.nib.setAttribute('r', '1.9');
    this.nib.setAttribute('class', 'pen-nib');
    this.nib.style.opacity = '0';
    this.nibLayer.appendChild(this.nib);
    svg.appendChild(this.nibLayer);

    this.root.appendChild(svg);
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const r = this.root.getBoundingClientRect();
    this.w = Math.max(200, r.width);
    this.h = Math.max(200, r.height);
    this.svg.setAttribute('viewBox', `0 0 ${this.w} ${this.h}`);
    this.svg.setAttribute('width', this.w);
    this.svg.setAttribute('height', this.h);
    this.maxX = this.w - this.marginX;
  }

  // ---- vitals modulation ------------------------------------------------

  setVitals(payload) {
    if (!payload) return;
    const ph = payload.physical || {};
    const me = payload.mental || {};
    const fatigue = clamp01(ph.fatigue ?? 0.3);
    const agitation = clamp01(me.agitation ?? 0.25);
    const despair = clamp01(me.despair ?? 0.3);
    const lucidity = clamp01(me.lucidity ?? 0.65);

    // fatigue -> larger, looser hand
    this.size = 17 + fatigue * 8; // 17..25
    // agitation -> faster, heavier
    this.penSpeed = (95 + agitation * 70) * (this.size / 19); // scales with size
    this.strokeWidth = 1.5 + agitation * 1.3;
    // despair -> fainter ink
    this.inkOpacity = 0.95 - despair * 0.4; // 0.95..0.55
    // lucidity -> tighter line; fatigue -> looser
    const looseness = 0.5 + fatigue * 0.9 - lucidity * 0.5;
    this.jitterRot = 0.7 + looseness * 1.4;
    this.jitterBase = 0.5 + looseness * 1.1;
    this.jitterScale = 0.02 + looseness * 0.04;
  }

  // ---- mode -------------------------------------------------------------

  setMode(mode) {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'letter') {
      this.ruled = false;
      this.root.classList.add('paper-unruled');
      // fresh line + salutation, handwritten like everything else
      this._enqueue({ type: 'newline' });
      this._enqueue({ type: 'newline' });
      this.write('Dear friend,', 'letter');
      this._enqueue({ type: 'newline' });
    } else if (prev === 'letter') {
      this.ruled = true;
      this.root.classList.remove('paper-unruled');
      this._enqueue({ type: 'newline' });
    }
  }

  // ---- public: queue text ----------------------------------------------

  write(str, mode) {
    if (!str) return;
    // a fresh thought clears any lingering abort state
    this.abortFlag = false;
    if (mode && mode !== this.mode) this.setMode(mode);
    // tag the instant flag onto the job so a mid-drain setInstant(false) does
    // not accidentally animate the tail of the backlog.
    const instant = this.instant;
    // resuming after a long silence: lay down the time marker on its own fresh
    // line first, in the same hand, so the gap reads as "then, at HH:MM...".
    if (this._resumeMarker) {
      const mk = this._resumeMarker;
      this._resumeMarker = null;
      for (const ch of mk) this._enqueue({ type: 'char', ch, instant });
      this._enqueue({ type: 'newline' });
    }
    for (const ch of str) this._enqueue({ type: 'char', ch, instant });
    this._pump();
  }

  // ---- public: queue a drawing (one pass) --------------------------------
  //
  // Same queue, same ink, same nib. A drawing arrives as one or more passes
  // sharing an `id` (underdrawing, then detail, then shading), each carrying the
  // parsed strokes for that pass. The first pass reserves a square on the sheet;
  // later passes overlay into it so the viewer watches it BUILD. Backlog fill
  // (this.instant) lays a completed drawing down flat, exactly like text.
  draw(drawing) {
    if (!drawing || !Array.isArray(drawing.strokes) || !drawing.strokes.length) return;
    this.abortFlag = false;
    this._enqueue({ type: 'draw', drawing, instant: this.instant });
  }

  // ---- silence: a real gap, left blank -----------------------------------
  //
  // He stopped. Leave visible empty space proportional to the duration - no ink,
  // no animation, the stillness is the point. For a long silence, arm a time
  // marker so writing resumes on a fresh dated line (see write()).
  silence(seconds, marker) {
    // close off the current line so the gap starts clean
    if (this.midWord || this.x > this.marginX) this._newline();
    const secs = Math.max(0, Number(seconds) || 0);
    // ~0.8 lines at 20s up to a capped ~6 lines for the long (asleep) gaps
    const gapLines = Math.max(0.8, Math.min(6, secs / 40));
    this.y += this.size * this.lineGap * gapLines;
    this.x = this.marginX;
    this.midWord = false;
    this._scroll();
    if (secs >= 90 && marker) this._resumeMarker = String(marker);
  }

  // Backlog fill: lay down ink fully drawn (no per-stroke animation) so the
  // page loads mid-stream instantly instead of animating hundreds of events.
  setInstant(on) {
    this.instant = !!on;
  }

  _enqueue(job) {
    this.jobs.push(job);
    this._pump();
  }

  // ---- abort: trail off + leave a scar ----------------------------------

  abort() {
    // drop everything not yet drawn for the aborted thought...
    this.jobs.length = 0;
    // ...signal the glyph loop to stop after the current stroke...
    this.abortFlag = true;
    // ...and freeze the in-flight stroke where the pen currently is, so it
    // trails off and the fragment stays on the page as a visible scar.
    const c = this._cur;
    if (c && c.anim) {
      try {
        const frozen = getComputedStyle(c.path).strokeDashoffset;
        c.path.__frozen = true; // keep finalize/safety from re-drawing it fully
        c.anim.cancel();
        c.path.style.strokeDashoffset = frozen;
        c.path.classList.add('scar');
      } catch {
        /* leave whatever is drawn */
      }
      this._cur = null;
    }
    this._hideNib();
  }

  // ---- the pump: draw jobs one at a time, strictly in order --------------

  async _pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift();
        if (job.type === 'newline') {
          this._newline();
          continue;
        }
        if (job.type === 'draw') {
          await this._drawSketch(job.drawing, job.instant);
          continue;
        }
        // char
        const ch = job.ch;
        if (ch === '\n') {
          this._newline();
          continue;
        }
        if (ch === ' ' || ch === '\t') {
          this.x += this._spaceAdvance();
          this.midWord = false;
          continue;
        }
        await this._drawChar(ch, job.instant);
      }
    } finally {
      this.running = false;
      this._hideNib();
    }
  }

  _spaceAdvance() {
    return 6 * (this.size / 21); // ~ half advance of a mid-width glyph
  }

  _glyphFor(ch) {
    const idx = ch.charCodeAt(0) - 33;
    if (idx < 0 || idx >= this.font.chars.length) return null;
    const raw = this.font.chars[idx];
    if (!raw || !raw.d) return null;
    let g = this.glyphCache.get(idx);
    if (!g) {
      g = { o: raw.o, strokes: parseGlyph(raw.d).map(strokeToPath) };
      this.glyphCache.set(idx, g);
    }
    return g;
  }

  _newline() {
    this.x = this.marginX;
    this.y += this.size * this.lineGap;
    this.midWord = false;
    this._scroll();
  }

  // keep the current writing line comfortably in view by translating the ink
  // layer up once we run past the bottom margin.
  _scroll() {
    const bottom = this.h - this.size * 1.4;
    const overflow = this.y - bottom;
    const dy = overflow > 0 ? -overflow : 0;
    this.ink.setAttribute('transform', `translate(0, ${dy.toFixed(1)})`);
  }

  async _drawChar(ch, instant) {
    const g = this._glyphFor(ch);
    if (!g) {
      this.x += this._spaceAdvance();
      return;
    }
    const scale = this.size / 21;
    const advance = g.o * 2 * scale;

    // word wrap: only wrap at a word boundary (never mid-word), never on the
    // very first glyph of a line.
    if (!this.midWord && this.x + advance > this.maxX && this.x > this.marginX) {
      this._newline();
    }
    this.midWord = true;

    // per-glyph human jitter
    const rot = (Math.random() * 2 - 1) * this.jitterRot;
    const dyBase = (Math.random() * 2 - 1) * this.jitterBase;
    const sx = scale * (1 + (Math.random() * 2 - 1) * this.jitterScale);
    const sw = this.strokeWidth * (0.9 + Math.random() * 0.2);
    const op = this.inkOpacity * (0.9 + Math.random() * 0.1);

    const grp = document.createElementNS(SVGNS, 'g');
    grp.setAttribute('class', 'glyph');
    grp.setAttribute(
      'transform',
      `translate(${this.x.toFixed(2)}, ${(this.y + dyBase).toFixed(2)}) rotate(${rot.toFixed(2)}) scale(${sx.toFixed(4)}, ${scale.toFixed(4)}) translate(0, ${-BASELINE})`,
    );
    this.ink.appendChild(grp);
    this._trackNode(grp);

    // draw each stroke sequentially
    for (const dPath of g.strokes) {
      if (this.abortFlag) break;
      await this._drawStroke(grp, dPath, sw, op, instant);
    }

    this.x += advance;
  }

  _drawStroke(grp, dPath, sw, op, instant) {
    return new Promise((resolve) => {
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', dPath);
      path.setAttribute('class', 'stroke');
      path.style.strokeWidth = sw.toFixed(2);
      path.style.opacity = op.toFixed(2);
      grp.appendChild(path);

      // instant backlog fill: fully drawn, no animation, no nib
      if (instant) {
        path.style.opacity = op.toFixed(2);
        resolve();
        return;
      }

      let len = 0;
      try {
        len = path.getTotalLength();
      } catch {
        len = 0;
      }
      if (!len) {
        resolve();
        return;
      }

      const scale = this.size / 21;
      // duration is independent of size because penSpeed scales with size.
      let dur = Math.max(55, (len * scale) / this.penSpeed * 1000);

      // ABORT: cut this stroke short and leave the fragment as a visible scar.
      const aborting = this.abortFlag;
      let visible = len;
      if (aborting) {
        visible = len * (0.25 + Math.random() * 0.35); // trail off partway
        dur = Math.max(40, (visible * scale) / this.penSpeed * 1000);
        path.classList.add('scar');
      }

      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;

      // WAAPI (NOT a same-frame CSS transition, which the browser would
      // coalesce into an instant draw). Animate offset len -> (len - visible).
      const anim = path.animate(
        [{ strokeDashoffset: len }, { strokeDashoffset: len - visible }],
        { duration: dur, easing: 'linear', fill: 'forwards' },
      );

      // expose the in-flight stroke so abort() can freeze it mid-draw
      this._cur = { path, anim };

      // ride the nib on the leading tip of the ink
      this._showNib();
      const start = performance.now();
      const drawn = visible;
      let stopped = false;
      const tick = (now) => {
        if (stopped) return;
        const k = Math.min(1, (now - start) / dur);
        this._moveNib(path, drawn * k);
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      let settled = false;
      // natural completion: pin the final dash offset inline so the ink stays
      // drawn after we discard the animation object (do NOT rely on
      // commitStyles - it is unreliable across engines and would leave the
      // stroke reverting to fully hidden).
      const finalize = () => {
        if (settled) return;
        settled = true;
        stopped = true;
        if (!path.__frozen) path.style.strokeDashoffset = String(len - visible);
        try {
          anim.cancel();
        } catch {
          /* ignore */
        }
        if (this._cur && this._cur.path === path) this._cur = null;
        resolve();
      };
      // abort() cancels this animation after freezing the offset itself; just
      // settle the queue without touching the (already frozen) ink.
      const settle = () => {
        if (settled) return;
        settled = true;
        stopped = true;
        if (this._cur && this._cur.path === path) this._cur = null;
        resolve();
      };

      anim.onfinish = finalize;
      anim.oncancel = settle;
      // safety: resolve even if onfinish is missed
      setTimeout(finalize, dur + 150);
    });
  }

  // ---- sketch: a drawing pass, rendered on the same sheet ----------------

  // Marks tracked to the mood of the drawing (a vitals snapshot taken when he
  // drew it): anger presses heavier, despair goes faint and sparse. The line-
  // level shape (crossing strokes, repeated motifs) is decided in the DSL; here
  // we only carry the pressure and the wobble of the hand.
  _sketchStyle(mood, pass) {
    const m = (mood && mood.mental) || {};
    const anger = clamp01(m.anger ?? 0.2);
    const despair = clamp01(m.despair ?? 0.3);
    let sw = 1.3 + anger * 1.7 - despair * 0.5;
    sw = Math.max(0.6, Math.min(3.2, sw));
    let op = 0.9 - despair * 0.45 + anger * 0.08;
    op = Math.max(0.35, Math.min(1, op));
    if (pass && pass.label === 'shade') op *= 0.8; // shading sits under the line
    const jitter = 0.6 + despair * 0.4; // grid-units of hand wobble
    return { sw, op, jitter };
  }

  async _drawSketch(drawing, instant) {
    const id = drawing.id || 'anon';
    const pass = drawing.pass || { i: 0, n: 1 };
    const isFirst = pass.i === 0 || !this._sketchBoxes.has(id);
    const isLast = pass.i >= (pass.n || 1) - 1;

    let box = this._sketchBoxes.get(id);
    if (isFirst || !box) {
      // start on a clean line with a little air above the drawing
      if (this.midWord || this.x > this.marginX) this._newline();
      this.y += this.size * 0.4;
      const avail = this.maxX - this.marginX;
      const side = Math.max(120, Math.min(avail, 240));
      const indent = Math.max(0, (avail - side) * 0.12);
      box = { ox: this.marginX + indent, oy: this.y, side, scale: side / 100 };
      this._sketchBoxes.set(id, box);
      // reserve the vertical run: the square + a caption line + air below
      this.y += side + this.size * 1.9;
      this.x = this.marginX;
      this.midWord = false;
      this._scroll();
    }

    const style = this._sketchStyle(drawing.mood, pass);
    const grp = document.createElementNS(SVGNS, 'g');
    grp.setAttribute('class', 'sketch');
    grp.setAttribute(
      'transform',
      `translate(${box.ox.toFixed(2)}, ${box.oy.toFixed(2)}) scale(${box.scale.toFixed(4)})`,
    );
    this.ink.appendChild(grp);
    this._trackNode(grp);

    for (const seg of sketchToPaths(drawing.strokes, { font: this.font })) {
      if (this.abortFlag) break;
      const jx = (Math.random() * 2 - 1) * style.jitter;
      const jy = (Math.random() * 2 - 1) * style.jitter;
      await this._sketchStroke(grp, seg, box.scale, style, jx, jy, instant);
    }

    // caption in the same hand beneath the drawing, once, on the final pass
    if (isLast) {
      if (drawing.title) {
        const cap = document.createElementNS(SVGNS, 'g');
        cap.setAttribute('class', 'sketch-caption');
        this.ink.appendChild(cap);
        this._trackNode(cap);
        await this._captionLine(cap, box, String(drawing.title), style, instant);
      }
      this._sketchBoxes.delete(id);
    }
  }

  async _captionLine(grp, box, text, style, instant) {
    const capSize = Math.max(10, this.size * 0.62);
    const bx = box.ox;
    const by = box.oy + box.side + capSize * 1.25; // baseline just below the box
    grp.setAttribute('transform', `translate(${bx.toFixed(2)}, ${by.toFixed(2)})`);
    const label = text.length > 42 ? text.slice(0, 42) : text;
    const capStyle = { sw: style.sw * 0.7, op: style.op * 0.85, jitter: 0 };
    for (const d of glyphTextPathsGrid(label, 0, 0, capSize, this.font)) {
      if (this.abortFlag) break;
      await this._sketchStroke(grp, { d, dot: false }, 1, capStyle, 0, 0, instant);
    }
  }

  // The sketch analogue of _drawStroke: reveal one grid-space path through the
  // scaled group, riding the nib, honouring instant fill and abort-to-scar. Kept
  // separate from _drawStroke so the handwriting path is untouched.
  _sketchStroke(grp, seg, scale, style, jx, jy, instant) {
    return new Promise((resolve) => {
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', seg.d);
      path.setAttribute('class', 'stroke');
      const swPx = style.sw * (seg.dot ? 2.2 : 1) * (0.9 + Math.random() * 0.2);
      path.style.strokeWidth = (swPx / scale).toFixed(3); // keep on-screen width even under the group scale
      path.style.opacity = style.op.toFixed(2);
      if (jx || jy) path.setAttribute('transform', `translate(${jx.toFixed(2)},${jy.toFixed(2)})`);
      grp.appendChild(path);

      if (instant) {
        resolve();
        return;
      }

      let len = 0;
      try {
        len = path.getTotalLength();
      } catch {
        len = 0;
      }
      if (!len) {
        resolve();
        return;
      }

      const sketchSpeed = this.penSpeed * 1.4; // a hurried hand, faster than writing
      const onscreen = len * scale;
      let dur = Math.max(50, (onscreen / sketchSpeed) * 1000);

      const aborting = this.abortFlag;
      let visible = len;
      if (aborting) {
        visible = len * (0.25 + Math.random() * 0.35);
        dur = Math.max(40, ((visible * scale) / sketchSpeed) * 1000);
        path.classList.add('scar');
      }

      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      const anim = path.animate(
        [{ strokeDashoffset: len }, { strokeDashoffset: len - visible }],
        { duration: dur, easing: 'linear', fill: 'forwards' },
      );
      this._cur = { path, anim };

      this._showNib();
      const start = performance.now();
      let stopped = false;
      const tick = (now) => {
        if (stopped) return;
        const k = Math.min(1, (now - start) / dur);
        this._moveNib(path, visible * k);
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      let settled = false;
      const finalize = () => {
        if (settled) return;
        settled = true;
        stopped = true;
        if (!path.__frozen) path.style.strokeDashoffset = String(len - visible);
        try {
          anim.cancel();
        } catch {
          /* ignore */
        }
        if (this._cur && this._cur.path === path) this._cur = null;
        resolve();
      };
      const settle = () => {
        if (settled) return;
        settled = true;
        stopped = true;
        if (this._cur && this._cur.path === path) this._cur = null;
        resolve();
      };
      anim.onfinish = finalize;
      anim.oncancel = settle;
      setTimeout(finalize, dur + 150);
    });
  }

  // ---- nib -------------------------------------------------------------

  _showNib() {
    this.nib.style.opacity = '1';
  }
  _hideNib() {
    this.nib.style.opacity = '0';
  }
  _moveNib(path, at) {
    let pt;
    try {
      pt = path.getPointAtLength(at);
    } catch {
      return;
    }
    const m = path.getCTM();
    if (!m) return;
    const v = pt.matrixTransform(m); // path-local -> SVG root user space
    this.nib.setAttribute('cx', v.x.toFixed(2));
    this.nib.setAttribute('cy', v.y.toFixed(2));
  }

  // ---- node pruning: cap the DOM so an all-day tab does not leak ---------

  _trackNode(node) {
    this.glyphNodes.push(node);
    if (this.glyphNodes.length > 1200) {
      const dead = this.glyphNodes.splice(0, this.glyphNodes.length - 1200);
      for (const n of dead) n.remove();
    }
  }
}
