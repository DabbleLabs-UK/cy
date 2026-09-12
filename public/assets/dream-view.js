import { sketchBounds, sketchToPaths } from './pen.js';

export const DREAM_ANIMATION_MS = 4800;

const OFFSETS = Object.freeze([4, 18, 9, 27, 13]);
const OPACITIES = Object.freeze([0.86, 0.72, 0.80, 0.66, 0.76]);
const SCALES = Object.freeze([1.00, 0.96, 0.98, 1.01, 0.97]);
const GAPS = Object.freeze([10, 18, 8, 22, 14]);

function hash(text) {
  let value = 2166136261;
  for (const ch of String(text || '')) {
    value ^= ch.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function dreamLayout(eventId, index) {
  const pos = ((hash(eventId) % OFFSETS.length) + Math.max(0, Number(index) || 0)) % OFFSETS.length;
  return {
    offsetPct: OFFSETS[pos], opacity: OPACITIES[pos], scale: SCALES[pos], gapPx: GAPS[pos],
  };
}

export function applyDreamLayout(element, eventId, index) {
  const layout = dreamLayout(eventId, index);
  element.style.setProperty('--dream-offset', layout.offsetPct + '%');
  element.style.setProperty('--dream-opacity', String(layout.opacity));
  element.style.setProperty('--dream-scale', String(layout.scale));
  element.style.setProperty('--dream-gap', layout.gapPx + 'px');
  return layout;
}

export function makeDreamSvg(label = 'dream drawing') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  return svg;
}

export function renderDreamSketch(svg, strokes, font = null) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const bounds = sketchBounds(strokes);
  const pad = 8;
  let vx = 0;
  let vy = 0;
  let vw = 100;
  let vh = 100;
  if (bounds) {
    vx = Math.max(0, bounds.minX - pad);
    vy = Math.max(0, bounds.minY - pad);
    vw = Math.max(8, Math.min(100, bounds.maxX + pad) - vx);
    vh = Math.max(8, Math.min(100, bounds.maxY + pad) - vy);
  }
  svg.setAttribute('viewBox', `${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`);
  for (const segment of sketchToPaths(strokes, { font })) {
    if (!segment || !segment.d) continue;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', segment.d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', segment.dot ? '2.6' : '1.35');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
}

export const DREAM_LAYOUT_INVENTORY = Object.freeze({
  offsetsPct: OFFSETS,
  opacities: OPACITIES,
  scales: SCALES,
  gapsPx: GAPS,
  animationMs: DREAM_ANIMATION_MS,
});
