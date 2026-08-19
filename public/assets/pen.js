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
// Multiplier on the space-character advance (inter-word gap only - letter spacing
// within a word is untouched). Bumped up from the raw half-advance because words
// were reading as run-together at 1x.
const WORD_SPACE_MULT = 2;
// Below this many CSS px the writing surface has not been laid out yet (it is the
// hidden view, or we are in the same tick as its reveal). We never wrap against a
// size this small - we defer and measure again once it is real. Kept low so a
// legitimately narrow surface (a postcard's message area, ~150px) still counts.
const MIN_SANE_PX = 24;

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

// Dream murmurs render fainter and smaller than waking prose - the page at night
// should look almost empty. A lucid night-waking line is the exception: it uses
// the normal weight so it lands hard. Pure + static so a headless test can assert
// the murmur style is genuinely faint and small without a browser.
export function dreamTextStyle() {
  return { opacityScale: 0.45, sizeScale: 0.82 };
}

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

// The grid-space bounding box of a set of parsed strokes, so a drawing can be
// FITTED to its own content instead of always reserving a full 0-100 square (a
// tiny scrawl in an enormous empty frame). Pure + DOM-free. Returns
// { minX, minY, maxX, maxY, w, h } or null when there is nothing to bound.
export function sketchBounds(strokes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const s of strokes || []) {
    if (!s || typeof s !== 'object') continue;
    switch (s.t) {
      case 'P':
      case 'L':
      case 'H':
        for (const p of s.pts || []) add(p[0], p[1]);
        break;
      case 'D':
        add(s.x, s.y);
        break;
      case 'C':
      case 'A': // arc bounds approximated by the full circle - cheap and never clips
        add(s.x - s.r, s.y - s.r);
        add(s.x + s.r, s.y + s.r);
        break;
      case 'T': {
        // a scrawled label extends right from (x,y) and sits just above the baseline
        const len = String(s.text || '').length;
        add(s.x, s.y - 7);
        add(s.x + Math.max(4, len * 4.5), s.y + 2);
        break;
      }
      default:
        break;
    }
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
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
    // right-edge crop instrumentation, gated behind ?111 (window.CY.raw): logs the
    // sheet clientWidth, viewBox width, maxX, and any glyph that reaches past maxX.
    this._debug = typeof window !== 'undefined' && !!(window.CY && window.CY.raw);

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
    // card mode: the reply is written on a postcard, not the sheet. A card pen is
    // constrained to the card's message area - a smaller hand, tighter leading, no
    // ruled paper, no scrolling - and CRAMS (shrinks + keeps going) when it runs
    // out of vertical room rather than clipping or scrolling the ink away.
    this.card = false;
    this.cram = false;
    this.minSize = 6;

    // ---- layout state ----
    this.marginX = 34;
    this.marginRight = 46; // a touch more room than the left, so nothing clips
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
    this.glyphNodes = []; // ink groups, for pruning
    this.textNodes = []; // one invisible <text> per rendered line, for pruning
    this._line = null; // the line currently being written into the text layer
    this.lang = 'en';
    this._sketchBoxes = new Map(); // drawing id -> its reserved box, across passes

    // retained logical flow (chars/spaces/newlines/silences/drawings) so a width
    // change can re-wrap EVERYTHING through the same layout path the live stream
    // uses. Excludes dream murmurs (their surface is fixed and non-scrolling) and
    // card pens (fixed objects that never reflow).
    this.flow = [];
    // the current word's already-drawn glyphs, so an overflow can move the whole
    // word down to the next line (word-boundary wrap) instead of breaking it.
    this._wordGlyphs = [];
    this._wordAtMargin = true;
    // layout gating: we only lay ink down once the surface has a real measured
    // size, and a genuine width change re-wraps what is already there.
    this._laidOut = false;
    this._reflowRequested = false;
    this._remeasureQueued = false;
    this._remeasureTries = 0;

    this._buildSvg();
    this._buildLiveRegion();
  }

  _buildSvg() {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'ink-svg');
    svg.setAttribute('preserveAspectRatio', 'xMinYMin slice');
    svg.setAttribute('lang', this.lang);
    this.svg = svg;

    // scroll group: ink + text move together, so the invisible text layer
    // tracks the ink exactly, including when old lines scroll up out of view.
    this.scrollG = document.createElementNS(SVGNS, 'g');
    this.scrollG.setAttribute('class', 'scroll-layer');
    svg.appendChild(this.scrollG);

    // ink layer - the visible handwriting strokes. Pure decoration painted on
    // top of the text layer; it is not the hit target (see style.css) and is
    // hidden from assistive tech, which reads the real text instead.
    this.ink = document.createElementNS(SVGNS, 'g');
    this.ink.setAttribute('class', 'ink-layer');
    this.ink.setAttribute('aria-hidden', 'true');
    this.scrollG.appendChild(this.ink);

    // text layer - one real <text> node per rendered line, transparent-filled,
    // per-character positioned to sit under the ink. This is what the browser
    // selects, copies, searches and reads aloud (the PDF-viewer technique).
    this.textLayer = document.createElementNS(SVGNS, 'g');
    this.textLayer.setAttribute('class', 'text-layer');
    this.scrollG.appendChild(this.textLayer);

    // dream layer - the slowly-filling surface for the night's dream drawing. It
    // sits in the SVG ROOT user space (a sibling of the scroll group, NOT inside
    // it), so it does NOT scroll away with the text: the abstract shape stays put
    // and accumulates one mark at a time through the small hours. Faint ink, no
    // ruled lines. Persists until lights_on, when it fades and is set aside.
    this.dreamLayer = document.createElementNS(SVGNS, 'g');
    this.dreamLayer.setAttribute('class', 'dream-layer');
    this.dreamLayer.setAttribute('aria-hidden', 'true');
    svg.appendChild(this.dreamLayer);
    this._dreamBoxes = new Map(); // dream drawing id -> its fixed surface box

    // nib layer sits in the SVG root user space (never translated), so a point
    // mapped through path.getCTM() lands correctly over the ink without any
    // scroll correction.
    this.nibLayer = document.createElementNS(SVGNS, 'g');
    this.nibLayer.setAttribute('class', 'nib-layer');
    this.nibLayer.setAttribute('aria-hidden', 'true');
    this.nib = document.createElementNS(SVGNS, 'circle');
    this.nib.setAttribute('r', '1.9');
    this.nib.setAttribute('class', 'pen-nib');
    this.nib.style.opacity = '0';
    this.nibLayer.appendChild(this.nib);
    svg.appendChild(this.nibLayer);

    this.root.appendChild(svg);
    this._resize();
    window.addEventListener('resize', () => {
      if (this._resize()) this._scroll();
    });
    // The viewBox width must match the rendered width, and the wrap point is
    // derived from that same width. When the instrument panels lay out after
    // load, the sheet resizes; without this the coordinate space would keep the
    // stale width and glyphs would be drawn (and wrapped) past the visible edge.
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        if (this._resize()) this._scroll();
      });
      this._ro.observe(this.root);
    }
  }

  // Measure the REAL rendered width of the writing surface, or return null when it
  // is not laid out yet. The coordinate space must match the actually-rendered
  // width (the SVG is CSS width:100%), so we size to the CONTENT box, not the
  // border box: getBoundingClientRect().width includes the sheet's 1px border and
  // any padding, and feeding that wider number into the viewBox made 1 user unit
  // slightly narrower than 1px and let the wrap point sit past the visible edge.
  // clientWidth excludes the border; we subtract padding too so the viewBox, the
  // rendered width and the wrap point all agree on ONE number. A display:none
  // surface (the hidden view) has no client rects and a 0 client size - we return
  // null for that rather than inventing a width, which is what wrapped the
  // re-rendered history at ~8 chars a line.
  _measure() {
    const el = this.root;
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return null;
    const r = el.getBoundingClientRect();
    const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(el) : null;
    const padX = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
    const padY = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 0;
    const cw = (el.clientWidth || Math.round(r.width)) - padX;
    const ch = (el.clientHeight || Math.round(r.height)) - padY;
    const w = Math.round(cw);
    const h = Math.round(ch);
    if (w < MIN_SANE_PX || h < MIN_SANE_PX) return null; // 0 / implausibly small: not laid out
    return { w, h };
  }

  // Recompute the coordinate space from the live, LAID-OUT sheet size. Returns true
  // when the size actually changed so the resize/observer callers can rescroll.
  // When there is no trustworthy box yet we defer and re-measure after layout,
  // rather than adopting a fallback width and wrapping against it.
  _resize() {
    const m = this._measure();
    if (!m) {
      this._scheduleRemeasure();
      return false;
    }
    const changed = m.w !== this.w || m.h !== this.h;
    const widthChanged = m.w !== this.w;
    this.w = m.w;
    this.h = m.h;
    this.svg.setAttribute('viewBox', `0 0 ${this.w} ${this.h}`);
    this.svg.setAttribute('width', this.w);
    this.svg.setAttribute('height', this.h);
    // the wrap point comes from the SAME width used for the viewBox above.
    this.maxX = this.w - this.marginRight;
    if (this._debug) {
      // eslint-disable-next-line no-console
      console.log('[pen] resize', { clientWidth: this.root.clientWidth, viewBoxW: this.w, maxX: this.maxX, laidOut: this._laidOut });
    }
    const firstLayout = !this._laidOut;
    this._laidOut = true;
    this._remeasureTries = 0;
    if (firstLayout) {
      // first real size: drain whatever queued while we had no width to wrap to.
      this._pump();
    } else if (widthChanged && !this.card && this._hasContent()) {
      // a genuine width change (e.g. a window resize): re-wrap all existing text
      // to the new width through the same layout path the live stream uses.
      this._requestReflow();
    }
    return changed;
  }

  _hasContent() {
    return this.flow.length > 0;
  }

  _requestReflow() {
    this._reflowRequested = true;
    this._pump();
  }

  // Re-measure on the next frame when the surface was not laid out yet (the reveal
  // happens after the tick that switched to this view). Bounded so a permanently
  // hidden view does not spin rAF forever - the ResizeObserver picks up the reveal.
  _scheduleRemeasure() {
    if (this._remeasureQueued || this._laidOut) return;
    if ((this._remeasureTries | 0) > 240) return;
    this._remeasureQueued = true;
    this._remeasureTries = (this._remeasureTries | 0) + 1;
    const again = () => {
      this._remeasureQueued = false;
      if (this._resize()) this._scroll();
    };
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(again);
    else if (typeof setTimeout !== 'undefined') setTimeout(again, 32);
  }

  // Wipe the rendered ink + text and re-lay the retained flow at the CURRENT width.
  // This runs at a job boundary inside _pump (never concurrently with a live draw),
  // and drives the SAME job queue -> _drawChar path the live stream uses, so the
  // streamed case and this bulk re-render can never wrap differently.
  _reflowReset() {
    while (this.ink.firstChild) this.ink.removeChild(this.ink.firstChild);
    while (this.textLayer.firstChild) this.textLayer.removeChild(this.textLayer.firstChild);
    this.glyphNodes = [];
    this.textNodes = [];
    this._line = null;
    this._sketchBoxes.clear();
    this._wordGlyphs = [];
    this.scrollG.setAttribute('transform', 'translate(0, 0)');
    this.x = this.marginX;
    this.y = this.marginTop + this.size;
    this.midWord = false;

    const items = this.flow;
    this.flow = []; // rebuilt identically as the replay drains back through _pump
    const replay = [];
    for (const it of items) {
      if (it.t === 'c') replay.push({ type: 'char', ch: it.ch, instant: true, dream: it.dream, shout: it.shout });
      else if (it.t === 'sp') replay.push({ type: 'char', ch: ' ', instant: true, dream: it.dream });
      else if (it.t === 'n') replay.push({ type: 'newline' });
      else if (it.t === 'si') replay.push({ type: 'silence', seconds: it.seconds });
      else if (it.t === 'd') replay.push({ type: 'draw', drawing: it.drawing, instant: true });
    }
    this.jobs = replay.concat(this.jobs);
  }

  // Retain one logical flow item so a later width change can reproduce it. Capped
  // so an all-day tab does not grow it without bound (older lines have scrolled off
  // and been pruned from the DOM anyway).
  _recordFlow(item) {
    if (this.card) return;
    this.flow.push(item);
    const CAP = 6000;
    if (this.flow.length > CAP) this.flow.splice(0, this.flow.length - CAP);
  }

  // ---- a11y: a polite live region announces completed passages -----------
  //
  // The <text> layer is real text an assistive tech user can browse, but a live
  // region should not fire on every glyph. We announce a passage only once it
  // is complete (a finished line, or the fragment left by an abort), so the
  // reader hears whole thoughts, not a stutter of single characters.
  _buildLiveRegion() {
    const live = document.createElement('div');
    live.className = 'ink-live';
    live.setAttribute('role', 'log');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-relevant', 'additions');
    live.setAttribute('aria-atomic', 'false');
    live.setAttribute('lang', this.lang);
    this.root.appendChild(live);
    this.live = live;
  }

  _announce(text) {
    const t = (text || '').trim();
    if (!this.live || !t) return;
    const line = document.createElement('div');
    line.textContent = t;
    this.live.appendChild(line);
    // cap the log so a day-long tab does not grow it without bound
    while (this.live.childElementCount > 24) this.live.firstChild.remove();
  }

  // ---- card layout: constrain this pen to a postcard's message area ---------
  //
  // Called once, right after construction, on the pen that writes a reply onto a
  // postcard. Small hand, tight leading, no ruled paper, no scrolling, and cram
  // enabled so a long reply shrinks toward the bottom edge instead of clipping.
  setCardLayout() {
    this.card = true;
    this.cram = true;
    this.ruled = false;
    this.mode = 'letter';
    this.size = 11;
    this.minSize = 6;
    this.penSpeed = 78;
    this.strokeWidth = 1.15;
    this.inkOpacity = 0.9;
    this.jitterRot = 1.2;
    this.jitterBase = 0.55;
    this.jitterScale = 0.03;
    this.marginX = 12;
    this.marginRight = 12;
    this.marginTop = 10;
    this.lineGap = 1.32;
    this.x = this.marginX;
    this.y = this.marginTop + this.size;
    this.maxX = this.w - this.marginRight;
  }

  // Tear down observers so a pruned/removed card pen does not leak.
  destroy() {
    try { if (this._ro) this._ro.disconnect(); } catch { /* ignore */ }
  }

  // ---- vitals modulation ------------------------------------------------

  setVitals(payload) {
    if (!payload) return;
    // a card pen keeps its fixed small hand - vitals must not blow the size up
    // past the card's message area.
    if (this.card) return;
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
      return;
    }
    if (mode === 'dream') {
      // night: mark the paper as the dream surface (a hook for a dimmer sheet) and
      // start the murmurs on a fresh line. No salutation, nothing else.
      if (this.root && this.root.classList) this.root.classList.add('paper-dream');
      this._enqueue({ type: 'newline' });
      return;
    }
    if (prev === 'letter') {
      this.ruled = true;
      this.root.classList.remove('paper-unruled');
      this._enqueue({ type: 'newline' });
    } else if (prev === 'dream') {
      // lights_on: fade the dream surface aside and resume normal ruled paper.
      if (this.root && this.root.classList) this.root.classList.remove('paper-dream');
      this._fadeDreamSurface();
      this._enqueue({ type: 'newline' });
    }
  }

  // ---- public: queue text ----------------------------------------------

  // `shout` (optional) is an array of [start, end) character ranges within `str`
  // that were capitalised as anger: those glyphs get heavier, slightly larger ink
  // so the shouting reads as physical pressure on the page (see _drawChar).
  write(str, mode, lucid, shout) {
    if (!str) return;
    // a fresh thought clears any lingering abort state
    this.abortFlag = false;
    if (mode && mode !== this.mode) this.setMode(mode);
    // tag the instant flag onto the job so a mid-drain setInstant(false) does
    // not accidentally animate the tail of the backlog.
    const instant = this.instant;
    // a dream murmur is written faint + small; a lucid night-waking line (lucid)
    // uses the normal hand so it lands hard, even though it too carries mode dream.
    const dreamText = mode === 'dream' && !lucid;
    const spans = Array.isArray(shout) ? shout : null;
    const inShout = (i) => {
      if (!spans) return false;
      for (const r of spans) if (i >= r[0] && i < r[1]) return true;
      return false;
    };
    // resuming after a long silence: lay down the time marker on its own fresh
    // line first, in the same hand, so the gap reads as "then, at HH:MM...".
    if (this._resumeMarker) {
      const mk = this._resumeMarker;
      this._resumeMarker = null;
      for (const ch of mk) this._enqueue({ type: 'char', ch, instant });
      this._enqueue({ type: 'newline' });
    }
    // index over the code UNITS of str, so the offsets line up with the runner's
    // character ranges (the transform only ever capitalises ASCII letters).
    let i = 0;
    for (const ch of str) {
      this._enqueue({ type: 'char', ch, instant, dream: dreamText, shout: inShout(i) });
      i += ch.length;
    }
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
    // a dream drawing (drawing.dream) accumulates on the separate, non-scrolling
    // dream surface, one mark at a time; a waking drawing lays into the page flow.
    if (drawing.dream) {
      this._enqueue({ type: 'dreamdraw', drawing, instant: this.instant });
      return;
    }
    this._enqueue({ type: 'draw', drawing, instant: this.instant });
  }

  // ---- silence: a real gap, left blank -----------------------------------
  //
  // He stopped. Leave visible empty space proportional to the duration - no ink,
  // no animation, the stillness is the point. For a long silence, arm a time
  // marker so writing resumes on a fresh dated line (see write()).
  silence(seconds, marker) {
    const secs = Math.max(0, Number(seconds) || 0);
    this._applyGap(secs);
    if (secs >= 90 && marker) this._resumeMarker = String(marker);
    this._recordFlow({ t: 'si', seconds: secs });
  }

  // The visible blank gap of a silence. Shared by the live path (silence()) and the
  // reflow replay (a 'silence' job), so a re-render reproduces the gap identically.
  _applyGap(seconds) {
    // close off the current line so the gap starts clean
    if (this.midWord || this.x > this.marginX) this._newline();
    const secs = Math.max(0, Number(seconds) || 0);
    // ~0.8 lines at 20s up to a capped ~6 lines for the long (asleep) gaps
    const gapLines = Math.max(0.8, Math.min(6, secs / 40));
    this.y += this.size * this.lineGap * gapLines;
    this.x = this.marginX;
    this.midWord = false;
    this._scroll();
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
    // ...forget the in-progress word so a later line cannot try to relocate glyphs
    // that belong to the abandoned thought...
    this._wordGlyphs = [];
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
    // the fragment stays on the page and selectable; finalize its text node and
    // let a screen reader hear what was written before the thought cut off.
    if (this._line) {
      const frag = this._line.chars.join('');
      this._line = null;
      this._announce(frag);
    }
    this._hideNib();
  }

  // ---- the pump: draw jobs one at a time, strictly in order --------------

  async _pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        // A pending reflow (a real width change) re-lays everything at the new
        // width BEFORE we touch the queue further. Done here, at a job boundary,
        // so it never runs concurrently with an in-flight stroke.
        if (this._reflowRequested) {
          this._reflowRequested = false;
          this._reflowReset();
          continue;
        }
        // Hold until the surface has a real, laid-out size. We never draw at a
        // guessed width (that is what wrapped the history at ~8 chars); the first
        // valid _resize() resumes us, and the ResizeObserver covers a later reveal.
        if (!this._laidOut) break;
        if (!this.jobs.length) break;
        const job = this.jobs.shift();
        if (job.type === 'newline') {
          this._newline();
          this._recordFlow({ t: 'n' });
          continue;
        }
        if (job.type === 'silence') {
          // only ever enqueued by the reflow replay; live silences run immediately
          this._applyGap(job.seconds);
          this._recordFlow({ t: 'si', seconds: job.seconds });
          continue;
        }
        if (job.type === 'draw') {
          await this._drawSketch(job.drawing, job.instant);
          this._recordFlow({ t: 'd', drawing: job.drawing });
          continue;
        }
        if (job.type === 'dreamdraw') {
          await this._drawDreamStroke(job.drawing, job.instant);
          continue;
        }
        // char
        const ch = job.ch;
        if (ch === '\n') {
          this._newline();
          this._recordFlow({ t: 'n' });
          continue;
        }
        if (ch === ' ' || ch === '\t') {
          this._recordChar(' '); // real space in the text, at its own x
          this.x += this._spaceAdvance(job.dream);
          this.midWord = false;
          this._recordFlow({ t: 'sp', dream: !!job.dream });
          continue;
        }
        await this._drawChar(ch, job.instant, job.dream, job.shout);
      }
    } finally {
      this.running = false;
      this._hideNib();
    }
  }

  _spaceAdvance(dream) {
    const size = dream ? this.size * dreamTextStyle().sizeScale : this.size;
    return 6 * (size / 21) * WORD_SPACE_MULT; // ~ half advance of a mid-width glyph, widened
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
    this._flushLine();
    this.x = this.marginX;
    if (this.cram) this._cramShrink();
    this.y += this.size * this.lineGap;
    this.midWord = false;
    this._scroll();
  }

  // Card cram: when the next line would run off the bottom of the card, shrink the
  // hand a little and tighten the leading, then keep writing. A real person running
  // out of room does exactly this - the letters get smaller and crowd toward the
  // edge - rather than clipping a word or scrolling the earlier lines out of sight.
  _cramShrink() {
    const bottom = this.h - this.size * 0.6;
    const nextBaseline = this.y + this.size * this.lineGap;
    if (nextBaseline <= bottom) return; // still room on the card
    if (this.size <= this.minSize) return; // already as small as the hand goes
    this.size = Math.max(this.minSize, this.size * 0.86);
    this.lineGap = Math.max(1.05, this.lineGap * 0.95);
    this.maxX = this.w - this.marginRight;
  }

  // keep the current writing line comfortably in view by translating the whole
  // scroll group (ink + text together) up once we run past the bottom margin. A
  // card pen never scrolls: its ink must stay fixed inside the card's message area
  // (the cram shrink keeps a long reply on the card instead).
  _scroll() {
    if (this.card) return;
    const bottom = this.h - this.size * 1.4;
    const overflow = this.y - bottom;
    const dy = overflow > 0 ? -overflow : 0;
    this.scrollG.setAttribute('transform', `translate(0, ${dy.toFixed(1)})`);
  }

  // ---- text layer: one real <text> node per rendered line ----------------
  //
  // As the pen lays out each glyph we already know its exact x and the line
  // baseline y. We mirror that into a single <text> per line whose x attribute
  // is the LIST of per-character x positions ("54 63 71 ...") so every glyph is
  // placed individually - metric mismatch can only widen/narrow a highlight
  // box, never drift the text off the ink. One node per line keeps the DOM
  // light. The characters are the real reading-order text, spaces included.
  _ensureLine() {
    if (this._line) return this._line;
    const node = document.createElementNS(SVGNS, 'text');
    node.setAttribute('class', 'ink-text');
    node.setAttribute('xml:space', 'preserve');
    node.setAttribute('y', this.y.toFixed(2));
    node.setAttribute('font-size', this.size.toFixed(2));
    this.textLayer.appendChild(node);
    this._trackTextNode(node);
    this._line = { node, chars: [], xs: [], y: this.y, size: this.size };
    return this._line;
  }

  _recordChar(ch) {
    // skip spaces at the very start of a line so a copied line has no left pad
    if (ch === ' ' && (!this._line || this._line.chars.length === 0)) return;
    const line = this._ensureLine();
    line.chars.push(ch);
    line.xs.push(this.x);
    line.node.setAttribute('x', line.xs.map((v) => v.toFixed(2)).join(' '));
    line.node.textContent = line.chars.join('');
  }

  // Finish the current line: the node stays in the DOM (still selectable), we
  // just stop appending to it and announce the completed passage.
  _flushLine() {
    if (!this._line) return;
    const line = this._line;
    this._line = null;
    this._announce(line.chars.join(''));
  }

  // The absolute transform that lands a glyph's local coordinate space at (x, y) on
  // the sheet. Shared by the initial placement and by a word relocation, so a moved
  // glyph keeps the exact hand (jitter rotation, per-glyph x-scale) it was drawn
  // with - only its x and baseline change.
  _glyphTransform(x, y, rot, sx, scale) {
    return `translate(${x.toFixed(2)}, ${y.toFixed(2)}) rotate(${rot.toFixed(2)}) scale(${sx.toFixed(4)}, ${scale.toFixed(4)}) translate(0, ${-BASELINE})`;
  }

  // Word-boundary wrap: the current word (every glyph since the last space or line
  // start) has run past the right edge, so move the WHOLE word down to a fresh line
  // instead of breaking it. The already-drawn glyph groups are re-positioned and
  // their characters are moved from the old text line onto the new one, so ink,
  // selectable text and reading order all stay consistent.
  _relocateWord() {
    const glyphs = this._wordGlyphs;
    const n = glyphs.length;
    if (!n) {
      this._newline();
      return;
    }
    try {
      // pull the word's characters off the current text line - they belong on the
      // next line now.
      const line = this._line;
      if (line && line.chars.length >= n) {
        line.chars.splice(line.chars.length - n, n);
        line.xs.splice(line.xs.length - n, n);
        if (line.chars.length) {
          line.node.setAttribute('x', line.xs.map((v) => v.toFixed(2)).join(' '));
          line.node.textContent = line.chars.join('');
        } else {
          // nothing was left before the word: drop the now-empty line node
          line.node.remove();
          const i = this.textNodes.indexOf(line.node);
          if (i >= 0) this.textNodes.splice(i, 1);
          this._line = null;
        }
      }
      this._newline(); // announce/flush the (word-less) old line, start a fresh one
      // re-lay each glyph of the word on the fresh line. A word wider than a whole
      // line still breaks, but only after it has had a full line to itself.
      for (const gi of glyphs) {
        if (this.x + gi.advance > this.maxX && this.x > this.marginX) this._newline();
        gi.grp.setAttribute('transform', this._glyphTransform(this.x, this.y + gi.dyBase, gi.rot, gi.sx, gi.scale));
        this._recordChar(gi.ch);
        this.x += gi.advance;
      }
      this._wordAtMargin = true; // the word now begins the fresh line
    } catch {
      // any inconsistency: fall back to a plain break so we never throw mid-stream
      this._newline();
      this._wordAtMargin = true;
    }
  }

  async _drawChar(ch, instant, dream, shout) {
    const g = this._glyphFor(ch);
    // a dream murmur renders smaller and fainter than waking prose
    const ds = dream ? dreamTextStyle() : null;
    // pen PRESSURE: a shouted glyph is pressed slightly larger and heavier, like
    // someone bearing down on the page. Kept tasteful - a firmer hand, not a
    // different font. Never applied to faint dream murmurs.
    const pressed = shout && !ds;
    const size = (ds ? this.size * ds.sizeScale : this.size) * (pressed ? 1.12 : 1);
    const scale = size / 21;

    if (!g) {
      // no glyph for this codepoint: still keep it in the readable text
      this._recordChar(ch);
      this.x += this._spaceAdvance(dream);
      this.midWord = true;
      this._recordFlow({ t: 'c', ch, dream: !!dream, shout: !!shout });
      return;
    }
    const advance = g.o * 2 * scale;

    // starting a new word? remember whether it begins at the left margin - a word
    // that starts at the margin and STILL overflows is genuinely too long and may
    // break mid-word; a word that started mid-line moves down whole instead.
    if (!this.midWord) {
      this._wordGlyphs = [];
      this._wordAtMargin = this.x <= this.marginX + 0.5;
    }

    if (this._debug && this.x + advance > this.maxX) {
      // eslint-disable-next-line no-console
      console.log('[pen] glyph past maxX', {
        ch,
        x: +this.x.toFixed(1),
        advance: +advance.toFixed(1),
        rightEdge: +(this.x + advance).toFixed(1),
        maxX: this.maxX,
        atMargin: this._wordAtMargin,
      });
    }
    // word wrap: on overflow, move the whole in-progress word to the next line so
    // words are never split ('to visit|ation', 'mr pro|ctor'). Only a word that
    // began at the margin and is itself wider than a full line breaks mid-word
    // ('degre|es' is fine when the word alone cannot fit). Never wrap on the very
    // first glyph of a line (x > marginX), so an over-wide glyph still lands.
    if (this.x + advance > this.maxX && this.x > this.marginX) {
      if (!this._wordAtMargin && this._wordGlyphs.length) {
        this._relocateWord();
      } else {
        this._newline();
        this._wordAtMargin = true;
      }
    }
    this.midWord = true;

    // mirror this glyph into the text layer at its exact x on the current line
    // (after any wrap above, so x/baseline are the values the ink will use).
    this._recordChar(ch);

    // per-glyph human jitter
    const rot = (Math.random() * 2 - 1) * this.jitterRot;
    const dyBase = (Math.random() * 2 - 1) * this.jitterBase;
    const sx = scale * (1 + (Math.random() * 2 - 1) * this.jitterScale);
    const sw = this.strokeWidth * (0.9 + Math.random() * 0.2) * (pressed ? 1.55 : 1);
    const op = this.inkOpacity * (0.9 + Math.random() * 0.1) * (ds ? ds.opacityScale : 1);

    const grp = document.createElementNS(SVGNS, 'g');
    grp.setAttribute('class', ds ? 'glyph dream' : 'glyph');
    grp.setAttribute('transform', this._glyphTransform(this.x, this.y + dyBase, rot, sx, scale));
    this.ink.appendChild(grp);
    this._trackNode(grp);

    // remember this glyph so a later overflow in the same word can relocate it
    this._wordGlyphs.push({ grp, ch, advance, dyBase, rot, sx, scale });

    // draw each stroke sequentially
    for (const dPath of g.strokes) {
      if (this.abortFlag) break;
      await this._drawStroke(grp, dPath, sw, op, instant);
    }

    this.x += advance;
    this._recordFlow({ t: 'c', ch, dream: !!dream, shout: !!shout });
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
      // Fit the box to the drawing's own content, at a FIXED grid->px scale, so a
      // small doodle is a small object and a full drawing fills the width - not a
      // tiny scrawl marooned in a big empty square. The scale maps the full 0-100
      // grid to a sensible max side; the actual box is only as big as the content.
      const maxSide = Math.max(110, Math.min(avail, 220));
      const scale = maxSide / 100;
      const pad = 8; // grid units of breathing room around the marks
      const b = sketchBounds(drawing.strokes);
      let gx0 = 0;
      let gy0 = 0;
      let gw = 100;
      let gh = 100;
      if (b) {
        gx0 = Math.max(0, b.minX - pad);
        gy0 = Math.max(0, b.minY - pad);
        gw = Math.max(8, Math.min(100, b.maxX + pad) - gx0);
        gh = Math.max(8, Math.min(100, b.maxY + pad) - gy0);
      }
      const boxW = gw * scale;
      const boxH = gh * scale;
      const indent = Math.max(0, (avail - boxW) * 0.12);
      box = { ox: this.marginX + indent, oy: this.y, w: boxW, h: boxH, gx0, gy0, scale };
      this._sketchBoxes.set(id, box);
      // reserve the vertical run: the drawing + a caption line + air below
      this.y += boxH + this.size * 1.9;
      this.x = this.marginX;
      this.midWord = false;
      this._scroll();
    }

    const style = this._sketchStyle(drawing.mood, pass);
    const grp = document.createElementNS(SVGNS, 'g');
    grp.setAttribute('class', 'sketch');
    // translate so the content's cropped top-left (gx0,gy0) lands at the box origin
    grp.setAttribute(
      'transform',
      `translate(${(box.ox - box.gx0 * box.scale).toFixed(2)}, ${(box.oy - box.gy0 * box.scale).toFixed(2)}) scale(${box.scale.toFixed(4)})`,
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
    const by = box.oy + box.h + capSize * 1.25; // baseline just below the box
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

  // ---- dream surface: the slow, non-scrolling drawing of the night ---------
  //
  // A dream drawing arrives ONE stroke at a time over the small hours, all events
  // sharing an `id`. The first stroke reserves a fixed box on the dream layer
  // (centred, in root user space so it never scrolls away); every later stroke
  // overlays into that SAME box, so the shape accumulates. Because each stroke is
  // its own event, a page reload replays them all and the surface rebuilds to
  // exactly where it was. Faint ink, no ruled lines. Backlog fill lays each mark
  // down flat (instant), so a mid-drawing reload is not re-animated from scratch.
  async _drawDreamStroke(drawing, instant) {
    const id = drawing.id || 'dream';
    let box = this._dreamBoxes.get(id);
    if (!box) {
      const side = Math.max(140, Math.min(this.w, this.h) * 0.5);
      const grp = document.createElementNS(SVGNS, 'g');
      grp.setAttribute('class', 'dream-sketch');
      const ox = (this.w - side) / 2;
      const oy = (this.h - side) / 2;
      grp.setAttribute('transform', `translate(${ox.toFixed(2)}, ${oy.toFixed(2)}) scale(${(side / 100).toFixed(4)})`);
      this.dreamLayer.appendChild(grp);
      box = { ox, oy, side, scale: side / 100, grp };
      this._dreamBoxes.set(id, box);
    }
    // very faint, a touch of wobble; despair/mood not applied - a dream is dim.
    const style = { sw: 1.0, op: 0.26, jitter: 0.6 };
    for (const seg of sketchToPaths(drawing.strokes, { font: this.font })) {
      if (this.abortFlag) break;
      const jx = (Math.random() * 2 - 1) * style.jitter;
      const jy = (Math.random() * 2 - 1) * style.jitter;
      await this._sketchStroke(box.grp, seg, box.scale, style, jx, jy, instant);
    }
  }

  // lights_on: fade the accumulated dream surface aside and clear it so the next
  // night starts on a fresh surface. The strokes already laid down stay faint
  // under the fade; a real fade-out is left to CSS via the `.faded` class.
  _fadeDreamSurface() {
    if (!this.dreamLayer) return;
    if (this.dreamLayer.classList) this.dreamLayer.classList.add('faded');
    this._dreamBoxes.clear();
    const clear = () => {
      while (this.dreamLayer.firstChild) this.dreamLayer.removeChild(this.dreamLayer.firstChild);
      if (this.dreamLayer.classList) this.dreamLayer.classList.remove('faded');
    };
    if (typeof setTimeout !== 'undefined') setTimeout(clear, 2000);
    else clear();
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

  // Text-node pruning is selection-aware: a user may be part-way through
  // selecting a passage, and yanking a node out of the middle of the range
  // would collapse their selection. So we never remove a node that intersects
  // the current selection, and if that leaves us over the cap we defer the rest
  // until the selection is cleared.
  _trackTextNode(node) {
    this.textNodes.push(node);
    this._pruneText();
  }

  _pruneText() {
    const CAP = 300; // lines kept; well past a screenful, bounds the DOM
    if (this.textNodes.length <= CAP) return;
    const sel = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
    const hasSel = !!(sel && sel.rangeCount && !sel.isCollapsed);
    let excess = this.textNodes.length - CAP;
    const survivors = [];
    let deferred = false;
    for (const n of this.textNodes) {
      if (excess > 0) {
        if (hasSel && this._inSelection(sel, n)) {
          survivors.push(n); // intersects the live selection - keep it
          deferred = true;
        } else {
          n.remove();
          excess--;
        }
      } else {
        survivors.push(n);
      }
    }
    this.textNodes = survivors;
    if (deferred) this._armSelectionPrune();
  }

  _inSelection(sel, node) {
    try {
      return sel.containsNode(node, true); // true = partial containment counts
    } catch {
      return false;
    }
  }

  // Re-run the deferred prune once the selection is gone, then unsubscribe.
  _armSelectionPrune() {
    if (this._selPruneArmed) return;
    this._selPruneArmed = true;
    const handler = () => {
      const s = window.getSelection ? window.getSelection() : null;
      if (!s || !s.rangeCount || s.isCollapsed) {
        document.removeEventListener('selectionchange', handler);
        this._selPruneArmed = false;
        this._pruneText();
      }
    };
    document.addEventListener('selectionchange', handler);
  }
}
