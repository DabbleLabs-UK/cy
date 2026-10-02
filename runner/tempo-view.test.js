import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_CYCLE_MS,
  Tempo,
  estimatedWakingBusyShare,
  watchingCostPph,
} from '../public/assets/tempo.js';

const idle = (22 / 1000) * 0.2635 * 100;
const load = (62 / 1000) * 0.2635 * 100;

assert.equal(watchingCostPph(5, idle, load).toFixed(1), '0.0', 'unwatched 5% baseline adds no watching cost');
assert.equal(DEFAULT_CYCLE_MS, 280000, 'the estimate starts from measured chooser-plus-prose wall time');
assert.ok(estimatedWakingBusyShare(30) > 0.7,
  '30% Tempo is an opportunity pace, not a misleading 30% duty claim');
assert.equal(watchingCostPph(30, idle, load).toFixed(1), '0.7',
  'one-viewer cost uses the new waking opportunity and rest mapping');
assert.equal(watchingCostPph(100, idle, load).toFixed(1), '0.9',
  'full-tempo cost retains the unwatched waking baseline');
assert.ok(watchingCostPph(50, idle, load) > watchingCostPph(30, idle, load));
assert.ok(watchingCostPph(30, idle, load, 360000) > watchingCostPph(30, idle, load, 200000),
  'the estimate responds to representative inference work rather than speed alone');
assert.equal(watchingCostPph(100, 'bad', load), null, 'invalid anchors cannot produce a misleading price');

const fields = new Map();
for (const id of ['#tp-pct', '#tp-slider', '#tp-cph', '#tp-cadence']) {
  fields.set(id, { textContent: '', addEventListener() {} });
}
const heading = { textContent: 'TEMPO / DUTY CYCLE' };
const root = {
  classList: { add() {} },
  closest: () => ({ querySelector: () => heading }),
  querySelector: (selector) => fields.get(selector),
};
const tempo = Object.create(Tempo.prototype);
tempo.root = root;
tempo.viewerEl = { textContent: '', setAttribute() {} };
tempo.pphIdle = idle;
tempo.pphLoad = load;
tempo.burstMs = DEFAULT_CYCLE_MS;
tempo.viewers = 1;
tempo._build();
tempo._render(30);
assert.equal(heading.textContent, 'TEMPO / WAKING PACE');
assert.equal(fields.get('#tp-cadence').textContent, '~5 min / opportunity');
assert.equal(fields.get('#tp-cph').textContent, '0.7');
assert.match(root.innerHTML, /entries may be delayed or rejected/i);
assert.match(root.innerHTML, /whole-host estimate/i);
assert.match(root.innerHTML, /aria-label="waking expression tempo, opportunity pace"/);

const source = await readFile(new URL('../public/assets/tempo.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /this\.cphEl\.textContent\s*=\s*['"]--['"]/, 'the cost display never falls back to an unexplained placeholder');
assert.match(source, /if \(d\) this\.update\(d\);/, 'the initial API response supplies cost anchors as well as tempo state');
assert.doesNotMatch(source, /percent duty cycle|\(s \/ 100\) \* range/,
  'the live control no longer describes or estimates a literal duty percentage');

console.log('tempo-view.test.js: all checks passed');
