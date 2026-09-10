import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EXPERIENCED_METRICS, BRAIN_REGIONS } from '../public/assets/brain.js';
import { reconcileSoma, somaSnapshot, tickSoma } from './soma.js';

const here = dirname(fileURLToPath(import.meta.url));
const soma = reconcileSoma(null, { now: 1 });
tickSoma(soma, { physical: { hunger: 0.7 }, monotony: 0.2, now: 5001 });
const snapshot = somaSnapshot(soma);

assert.deepEqual(EXPERIENCED_METRICS.map((metric) => metric.key),
  ['anxiety', 'arousal', 'pain', 'hunger', 'fatigue', 'loneliness', 'anger', 'rumination']);
assert.deepEqual(
  [...BRAIN_REGIONS.map((region) => region.key)].sort(),
  [...Object.keys(snapshot.experienced.brain)].sort(),
  'every public functional analogy is derived by the experienced-state snapshot',
);
for (const region of BRAIN_REGIONS) {
  assert.match(region.path, /^M\d/);
  assert.ok(region.label);
  assert.ok(snapshot.experienced.brain[region.key].explanation);
}

const source = await readFile(join(here, '..', 'public', 'assets', 'brain.js'), 'utf8');
assert.match(source, /PLANNED STATS/);
assert.match(source, /SOMA DIAGNOSTICS/);
assert.match(source, /Brain regions are functional analogies, not measured physiology/);
assert.match(source, /class="soma-implemented" hidden/);
assert.match(source, /Experienced state:<\/strong> waiting for an implemented runner snapshot/);
assert.match(source, /this\.root\.querySelector\('\.soma-implemented'\)\.hidden = false/);
assert.match(source, /data-range="1h"/);
assert.match(source, /data-range="24h"/);
assert.match(source, /data-range="7d"/);
assert.match(source, /class="soma-region-list"/);
assert.match(source, /className = 'soma-region-entry'/);
assert.match(source, /setRegionAssociation\(definition\.key, true\)/);
assert.match(source, /region\.classList\.toggle\('is-associated', associated\)/);
assert.match(source, /entry\.classList\.toggle\('is-associated', associated\)/);
assert.doesNotMatch(source, /createElementNS\([^\n]+ellipse/);

console.log('brain.test.js: all checks passed');
