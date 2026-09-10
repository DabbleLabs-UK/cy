// power.test.js - the electricity meter DISPLAYS the latest cumulative total and
// never accumulates client-side, and the pence/pounds switch works either side of
// GBP 1.00. Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/power.test.js

import assert from 'node:assert/strict';
import { Power, formatCost } from '../public/assets/power.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

// ---- 1. formatCost: pence under a pound, pounds at/above, auto-switch ----
assert.deepEqual(formatCost(0.0302), { text: '3.0p', cur: '' });   // the live value
assert.deepEqual(formatCost(0), { text: '0.0p', cur: '' });
assert.deepEqual(formatCost(0.999), { text: '99.9p', cur: '' });   // just under a pound
assert.deepEqual(formatCost(1), { text: '1.00', cur: 'GBP' });     // exactly a pound -> pounds
assert.deepEqual(formatCost(1.5), { text: '1.50', cur: 'GBP' });
assert.deepEqual(formatCost(150), { text: '150.00', cur: 'GBP' });
ok('formatCost shows pence below GBP 1 and pounds at/above, switching at 1.00');

// ---- a headless DOM stub: just enough for Power to build and render ----
function stub() {
  return {
    textContent: '',
    style: {},
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
  };
}
function fakeRoot() {
  const els = {};
  return {
    classList: { add() {} },
    set innerHTML(v) { this.html = v; },
    get innerHTML() { return this.html || ''; },
    querySelector: (sel) => (els[sel] || (els[sel] = stub())),
  };
}

// ---- 2. displays the LATEST cost_total / kwh_total, not a client-side sum ----
const root = fakeRoot();
const p = new Power(root);
assert.doesNotMatch(root.innerHTML, /pw-ytop/, 'the internal vertical scale ceiling is not presented as a watt reading');
assert.match(root.innerHTML, /pw-xstart/);
assert.match(root.innerHTML, /pw-xend/);
const feed = { watts: 35.1, kwh_total: 0.114606, cost_total: 0.0302, cost_per_hour: 0.0093, uptime_s: 27588 };
let t = 1_700_000_000_000;
p.push(feed, t);
assert.equal(p.costEl.textContent, '3.0p', 'displayed total equals the latest cost_total, in pence');
assert.equal(p.curEl.textContent, '', 'GBP prefix hidden in pence mode');
assert.equal(p.kwhEl.textContent, '0.115 kWh', 'kWh reads the latest kwh_total');
ok('meter displays the latest cost_total (3.0p) and kwh_total');

// ---- 3. replaying identical events does NOT grow the total ----
for (let i = 0; i < 8; i++) p.push(feed, (t += 30000));
assert.equal(p.costEl.textContent, '3.0p', 'identical replayed events must not accumulate');
assert.equal(p.kwhEl.textContent, '0.115 kWh', 'kWh must not accumulate either');
assert.match(p.xStartEl.textContent, /^\d{2}:\d{2}$/);
assert.match(p.xEndEl.textContent, /^\d{2}:\d{2}$/);
assert.notEqual(p.xStartEl.textContent, p.xEndEl.textContent, 'the graph endpoints are shown separately');
ok('identical replayed events leave the total unchanged (no client-side integration)');

// ---- 4. crossing GBP 1.00 flips pence -> pounds automatically ----
p.push({ ...feed, cost_total: 0.87 }, (t += 30000));
assert.equal(p.costEl.textContent, '87.0p');
assert.equal(p.curEl.textContent, '');
p.push({ ...feed, cost_total: 1.23 }, (t += 30000));
assert.equal(p.costEl.textContent, '1.23', 'over a pound reads in pounds');
assert.equal(p.curEl.textContent, 'GBP', 'GBP prefix shown in pounds mode');
ok('pence/pounds switch works either side of GBP 1.00 as the total moves');

// ---- 5. missed samples remain continuous without diagonal interpolation ----
const outageRoot = fakeRoot();
const outagePower = new Power(outageRoot);
const sample = { watts: 30, watts_min: 25, watts_max: 35, watts_inst: 30, cost_total: 0.1, cost_per_hour: 0.01, kwh_total: 1 };
outagePower.push({ ...sample, t_ms: 1_700_000_000_000 });
outagePower.push({ ...sample, t_ms: 1_700_000_003_000 });
outagePower.push({ ...sample, t_ms: 1_700_000_060_000 });
outagePower.push({ ...sample, t_ms: 1_700_000_063_000 });
assert.equal((outagePower.lineEl.attrs.d.match(/M/g) || []).length, 1, 'line remains one continuous path');
assert.equal((outagePower.areaEl.attrs.d.match(/Z/g) || []).length, 1, 'area remains one continuous region');
assert.equal((outagePower.bandEl.attrs.d.match(/Z/g) || []).length, 1, 'min/max band remains one continuous region');
assert.match(outagePower.lineEl.attrs.d, /H[^H]+V/, 'line uses horizontal holds and vertical changes');
assert.doesNotMatch(outagePower.lineEl.attrs.d, /L/, 'line never draws a diagonal between samples');
ok('power paths hold across missed samples without blank or diagonal joins');

console.log(`\npower.test.js: all ${n} checks passed`);
