import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { watchingCostPph } from '../public/assets/tempo.js';

const idle = (22 / 1000) * 0.2635 * 100;
const load = (62 / 1000) * 0.2635 * 100;

assert.equal(watchingCostPph(5, idle, load).toFixed(1), '0.0', 'unwatched 5% baseline adds no watching cost');
assert.equal(watchingCostPph(30, idle, load).toFixed(1), '0.3', 'ordinary one-viewer tempo is priced from the power model');
assert.equal(watchingCostPph(100, idle, load).toFixed(1), '1.0', 'full tempo matches the established watching-cost figure');
assert.equal(watchingCostPph(100, 'bad', load), null, 'invalid anchors cannot produce a misleading price');

const source = await readFile(new URL('../public/assets/tempo.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /this\.cphEl\.textContent\s*=\s*['"]--['"]/, 'the cost display never falls back to an unexplained placeholder');
assert.match(source, /if \(d\) this\.update\(d\);/, 'the initial API response supplies cost anchors as well as tempo state');

console.log('tempo-view.test.js: all checks passed');
