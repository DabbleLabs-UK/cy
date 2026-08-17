// brain.js - the internal readout beside the page.
//
// A stylised lateral brain (hand-authored inline SVG, no external asset) whose
// regions tint on a cool-to-hot ramp by their 0..1 activation, with a white
// bloom above 0.9. Beside it a monospace strip prints each region's name, its
// percentage and a state word. A heart-rate indicator pulses at the actual BPM
// and a compact bar list shows the mental vitals.
//
//   const hud = new BrainHud(document.getElementById('brain'));
//   hud.setBrain(vitals.brain);          // { amygdala:0.5, ... }
//   hud.setHeart(vitals.hr);
//   hud.setMental(vitals.mental);

const SVGNS = 'http://www.w3.org/2000/svg';

// cool -> hot endpoints
const COOL = [0x2b, 0x5f, 0x8f]; // #2b5f8f
const HOT = [0xff, 0x5b, 0x2e]; // #ff5b2e

function ramp(a) {
  a = Math.max(0, Math.min(1, a));
  const r = Math.round(COOL[0] + (HOT[0] - COOL[0]) * a);
  const g = Math.round(COOL[1] + (HOT[1] - COOL[1]) * a);
  const b = Math.round(COOL[2] + (HOT[2] - COOL[2]) * a);
  return [r, g, b];
}

// blend toward white for the >0.9 bloom
function bloom(rgb, a) {
  if (a <= 0.9) return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const t = (a - 0.9) / 0.1; // 0..1 across the top decile
  const r = Math.round(rgb[0] + (255 - rgb[0]) * t * 0.85);
  const g = Math.round(rgb[1] + (255 - rgb[1]) * t * 0.85);
  const b = Math.round(rgb[2] + (255 - rgb[2]) * t * 0.85);
  return `rgb(${r},${g},${b})`;
}

// Region geometry for a left-facing lateral brain (frontal lobe at the left).
// Purely stylised; shapes are ellipses/paths positioned by eye.
const REGIONS = [
  { key: 'dmn', label: 'DEFAULT MODE', ell: [182, 112, 66, 34], faint: true },
  { key: 'dlpfc', label: 'DLPFC', ell: [108, 82, 27, 21] },
  { key: 'broca', label: 'BROCA', ell: [94, 132, 19, 15] },
  { key: 'acc', label: 'ANT CINGULATE', ell: [150, 90, 23, 16] },
  { key: 'insula', label: 'INSULA', ell: [166, 124, 21, 16] },
  { key: 'thalamus', label: 'THALAMUS', ell: [188, 114, 16, 14] },
  { key: 'hippocampus', label: 'HIPPOCAMPUS', ell: [178, 152, 17, 11] },
  { key: 'amygdala', label: 'AMYGDALA', ell: [150, 152, 13, 11] },
  { key: 'v1', label: 'VISUAL CTX', ell: [258, 120, 22, 18] },
  { key: 'locusCoeruleus', label: 'LOCUS COER.', ell: [250, 168, 9, 12] },
];

const ORDER = [
  'amygdala', 'acc', 'insula', 'hippocampus', 'dlpfc',
  'broca', 'v1', 'locusCoeruleus', 'dmn', 'thalamus',
];

// derived composite states, in display order
const DERIVED = ['confusion', 'overwhelm', 'numbness', 'paranoia', 'fixation', 'resignation', 'brittleness'];

// the cast, in display order, with the name CY uses (viewer mirror of cast.js)
const CAST_LABELS = [
  ['root', 'ROOT'], ['reg', 'REG'], ['bill', 'BILL'], ['mark', 'MARK'],
  ['nick', 'NICK'], ['fisher', 'FISHER'], ['ping', 'PING'], ['daemon', 'DAEMON'],
];

export class BrainHud {
  constructor(root) {
    this.root = root;
    this.nodes = {}; // key -> region svg element
    this.overheatSince = {}; // key -> ts when it first crossed 0.9
    this.rows = {}; // key -> readout row element
    this.hr = 0;
    this._build();
  }

  _build() {
    this.root.classList.add('brainhud');
    this.root.innerHTML = '';

    // ---- brain svg ----
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 320 240');
    svg.setAttribute('class', 'brain-svg');

    // outline
    const outline = document.createElementNS(SVGNS, 'path');
    outline.setAttribute(
      'd',
      'M42,142 C30,92 74,44 132,40 C184,36 236,46 274,72 C302,92 300,128 286,150 ' +
        'C296,160 292,180 274,186 C256,192 242,180 236,182 C214,198 150,206 100,190 ' +
        'C62,178 50,166 46,160 C40,156 36,150 42,142 Z',
    );
    outline.setAttribute('class', 'brain-outline');
    svg.appendChild(outline);

    // brainstem stub
    const stem = document.createElementNS(SVGNS, 'path');
    stem.setAttribute('d', 'M244,178 C248,196 250,210 246,222 C244,214 240,196 240,182 Z');
    stem.setAttribute('class', 'brain-outline');
    svg.appendChild(stem);

    // sulci hint lines
    const sulci = document.createElementNS(SVGNS, 'path');
    sulci.setAttribute(
      'd',
      'M120,58 C150,86 150,120 128,150 M170,52 C186,96 182,140 168,176 M214,64 C224,110 220,150 206,182',
    );
    sulci.setAttribute('class', 'brain-sulci');
    svg.appendChild(sulci);

    for (const reg of REGIONS) {
      const el = document.createElementNS(SVGNS, 'ellipse');
      const [cx, cy, rx, ry] = reg.ell;
      el.setAttribute('cx', cx);
      el.setAttribute('cy', cy);
      el.setAttribute('rx', rx);
      el.setAttribute('ry', ry);
      el.setAttribute('class', 'brain-region' + (reg.faint ? ' faint' : ''));
      el.setAttribute('fill', `rgb(${COOL[0]},${COOL[1]},${COOL[2]})`);
      svg.appendChild(el);
      this.nodes[reg.key] = el;
    }
    this.root.appendChild(svg);

    // ---- readout strip ----
    const strip = document.createElement('div');
    strip.className = 'brain-readout';
    const labels = Object.fromEntries(REGIONS.map((r) => [r.key, r.label]));
    for (const key of ORDER) {
      const row = document.createElement('div');
      row.className = 'readout-row';
      row.innerHTML =
        `<span class="rr-name">${labels[key]}</span>` +
        `<span class="rr-pct">--%</span>` +
        `<span class="rr-state">----</span>`;
      strip.appendChild(row);
      this.rows[key] = row;
    }
    this.root.appendChild(strip);

    // ---- heart + mental vitals ----
    const bio = document.createElement('div');
    bio.className = 'bio';
    bio.innerHTML = `
      <div class="heart">
        <div class="heart-icon" id="heart-icon">&#9829;</div>
        <div class="heart-read"><span id="hr-bpm">--</span><small>BPM</small></div>
      </div>
      <div class="mental" id="mental"></div>`;
    this.root.appendChild(bio);
    this.heartIcon = bio.querySelector('#heart-icon');
    this.hrBpm = bio.querySelector('#hr-bpm');
    this.mentalEl = bio.querySelector('#mental');

    const MENTAL = ['anxiety', 'stress', 'despair', 'hope', 'lucidity', 'agitation', 'dissociation', 'anger', 'longing'];
    this.mentalBars = {};
    for (const k of MENTAL) {
      const row = document.createElement('div');
      row.className = 'mrow';
      row.innerHTML =
        `<span class="mname">${k.slice(0, 4).toUpperCase()}</span>` +
        `<span class="mbar"><i style="width:0%"></i></span>`;
      this.mentalEl.appendChild(row);
      this.mentalBars[k] = row.querySelector('i');
    }

    // ---- amplification meter ----
    const amp = document.createElement('div');
    amp.className = 'ampmeter';
    amp.innerHTML = `
      <div class="amp-top">
        <span class="amp-k">MONOTONY</span>
        <span class="amp-bar"><i id="amp-mono" style="width:0%"></i></span>
        <span class="amp-x" id="amp-x">x1.0</span>
      </div>
      <div class="amp-hint">small things scale by the amp factor</div>`;
    this.root.appendChild(amp);
    this.monoBar = amp.querySelector('#amp-mono');
    this.ampX = amp.querySelector('#amp-x');

    // ---- derived composite states ----
    const dwrap = document.createElement('div');
    dwrap.className = 'derived';
    dwrap.innerHTML = `<div class="sec-title">COMPOSITE STATES</div>`;
    this.derivedEl = document.createElement('div');
    this.derivedEl.className = 'dbars';
    dwrap.appendChild(this.derivedEl);
    this.root.appendChild(dwrap);
    this.derivedBars = {};
    for (const k of DERIVED) {
      const row = document.createElement('div');
      row.className = 'drow';
      row.innerHTML =
        `<span class="dname">${k.toUpperCase()}</span>` +
        `<span class="dbar"><i style="width:0%"></i></span>` +
        `<span class="dpct">--</span>`;
      this.derivedEl.appendChild(row);
      this.derivedBars[k] = { bar: row.querySelector('i'), pct: row.querySelector('.dpct'), row };
    }

    // ---- the cast + standing ----
    const cwrap = document.createElement('div');
    cwrap.className = 'castbox';
    cwrap.innerHTML = `<div class="sec-title">ON THE SPUR</div>`;
    this.castEl = document.createElement('div');
    this.castEl.className = 'castlist';
    cwrap.appendChild(this.castEl);
    this.root.appendChild(cwrap);
    this.castRows = {};
    for (const [key, label] of CAST_LABELS) {
      const row = document.createElement('div');
      row.className = 'crow';
      row.innerHTML =
        `<span class="cname">${label}</span>` +
        `<span class="cstd">` +
        `<span class="cmini w"><i style="width:0%"></i></span>` +
        `<span class="cmini s"><i style="width:0%"></i></span>` +
        `<span class="cmini g"><i style="width:0%"></i></span>` +
        `</span>`;
      this.castEl.appendChild(row);
      this.castRows[key] = {
        row,
        w: row.querySelector('.cmini.w i'),
        s: row.querySelector('.cmini.s i'),
        g: row.querySelector('.cmini.g i'),
      };
    }
  }

  // ---- amplification -----------------------------------------------------

  setAmp(monotony, amp) {
    const mono = clampNum(monotony);
    if (mono != null && this.monoBar) this.monoBar.style.width = Math.round(mono * 100) + '%';
    if (typeof amp === 'number' && Number.isFinite(amp) && this.ampX) {
      this.ampX.textContent = 'x' + amp.toFixed(1);
      this.ampX.classList.toggle('hot', amp > 2.0);
    }
  }

  // ---- derived composite states -----------------------------------------

  setDerived(derived) {
    if (!derived) return;
    for (const k of DERIVED) {
      const v = clampNum(derived[k]);
      const node = this.derivedBars[k];
      if (v == null || !node) continue;
      node.bar.style.width = Math.round(v * 100) + '%';
      node.pct.textContent = Math.round(v * 100);
      node.row.classList.toggle('active', v > 0.6); // directive is live above 0.6
    }
  }

  // ---- cast standing ----------------------------------------------------

  setCast(relations) {
    if (!relations) return;
    for (const [key] of CAST_LABELS) {
      const r = relations[key];
      const row = this.castRows[key];
      if (!r || !row) continue;
      const w = clampNum(r.warmth) || 0;
      const s = clampNum(r.suspicion) || 0;
      const g = clampNum(r.grudge) || 0;
      row.w.style.width = Math.round(w * 100) + '%';
      row.s.style.width = Math.round(s * 100) + '%';
      row.g.style.width = Math.round(g * 100) + '%';
      row.row.classList.toggle('feud', g > 0.7); // grudge directive is live
    }
  }

  // ---- brain map --------------------------------------------------------

  setBrain(brain, now) {
    if (!brain) return;
    now = now || this._now();
    for (const reg of REGIONS) {
      const a = clampNum(brain[reg.key]);
      if (a == null) continue;
      const el = this.nodes[reg.key];
      el.setAttribute('fill', bloom(ramp(a), a));
      el.classList.toggle('bloom', a > 0.9);

      // sustained-saturation tracking for OVERHEAT
      if (a > 0.9) {
        if (!this.overheatSince[reg.key]) this.overheatSince[reg.key] = now;
      } else {
        this.overheatSince[reg.key] = 0;
      }
      const sustained = this.overheatSince[reg.key] && now - this.overheatSince[reg.key] >= 60000;

      const state = this._state(a, sustained);
      const row = this.rows[reg.key];
      row.querySelector('.rr-pct').textContent = Math.round(a * 100) + '%';
      const st = row.querySelector('.rr-state');
      st.textContent = state;
      st.className = 'rr-state s-' + state.toLowerCase();
    }
  }

  _state(a, sustained) {
    if (sustained) return 'OVERHEAT';
    if (a < 0.1) return 'SUPPRESSED';
    if (a >= 0.9) return 'SATURATED';
    if (a >= 0.65) return 'ELEVATED';
    return 'NOMINAL';
  }

  // ---- heart ------------------------------------------------------------

  setHeart(hr) {
    if (!hr || hr <= 0) return;
    this.hr = hr;
    this.hrBpm.textContent = Math.round(hr);
    // pulse the icon at the real BPM
    const dur = (60 / hr).toFixed(3) + 's';
    this.heartIcon.style.animationDuration = dur;
    this.heartIcon.classList.toggle('tachy', hr > 100);
  }

  // ---- mental bars ------------------------------------------------------

  setMental(mental) {
    if (!mental) return;
    for (const k in this.mentalBars) {
      const v = clampNum(mental[k]);
      if (v == null) continue;
      const bar = this.mentalBars[k];
      bar.style.width = Math.round(v * 100) + '%';
      // hope/lucidity read "good" (cool green), the rest read "hot"
      bar.classList.toggle('good', k === 'hope' || k === 'lucidity');
    }
  }

  _now() {
    return typeof performance !== 'undefined' ? performance.now() + this._epoch() : Date.now();
  }
  _epoch() {
    // stable wall-clock offset so 60s OVERHEAT timing is real time
    if (this.__e == null) this.__e = Date.now() - performance.now();
    return this.__e;
  }
}

function clampNum(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
}
