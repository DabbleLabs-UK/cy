// pen.js - the CAPTIVE handwriting renderer.
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
    for (const ch of str) this._enqueue({ type: 'char', ch, instant });
    this._pump();
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
