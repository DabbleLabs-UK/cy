// selftest.js - deterministic checks for the amplification / derived-state /
// cast / warden / power machinery, with NO ollama needed. Prints evidence for
// each behaviour the spec asks to confirm.
//
//   node runner/selftest.js

import {
  initialVitals,
  tick,
  applyEvent,
  applyDeltas,
  ampOf,
  computeDerived,
} from './vitals.js';
import {
  initialRelations,
  applySocialEvent,
  SOCIAL_EVENTS,
  grudgeDirective,
  castForPrompt,
} from './cast.js';
import { buildSystem, amplifiedDirective } from './prompt.js';
import { PowerMeter, costInjection } from './power.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const line = (s = '') => console.log(s);
const hr = (t) => line('\n==== ' + t + ' ====');

// ---- 1. derived states appear ----
hr('1. DERIVED STATES');
const v = initialVitals();
v.relations = initialRelations();
tick(v, { now: Date.now() });
line('vitals.derived = ' + JSON.stringify(v.derived));
line('all seven present: ' + ['confusion', 'overwhelm', 'numbness', 'paranoia', 'fixation', 'resignation', 'brittleness'].every((k) => k in v.derived));

// ---- 2. monotony rises with nothing, drops on a seeded inbox item ----
hr('2. MONOTONY RISE THEN DROP');
const v2 = initialVitals();
v2.relations = initialRelations();
v2.monotony = 0;
for (let i = 0; i < 60; i++) tick(v2, { now: Date.now() }); // 60 empty ticks (~5 min)
line('after 60 empty ticks: monotony = ' + v2.monotony.toFixed(4) + '  amp = ' + ampOf(v2).toFixed(3));
const before = v2.monotony;
applyEvent(v2, 'letter_arrives', { now: Date.now() }); // seeded inbox item
line('after a letter arrives:  monotony = ' + v2.monotony.toFixed(4) + '  (dropped by ' + (before - v2.monotony).toFixed(3) + ')');

// ---- 3. amp visibly scales a delta ----
hr('3. AMPLIFICATION SCALES A DELTA');
// high monotony -> high amp. cold_tea base anger delta is +0.04.
const vHi = initialVitals();
vHi.relations = initialRelations();
vHi.monotony = 1.0;
const ampHi = ampOf(vHi);
const angerBefore = vHi.mental.anger;
applyEvent(vHi, 'cold_tea', { now: Date.now() });
const applied = vHi.mental.anger - angerBefore;
line('monotony=1.0 -> amp=' + ampHi.toFixed(2));
line('cold_tea base anger delta +0.040 -> applied ' + applied.toFixed(3) + ' (0.040 * ' + ampHi.toFixed(2) + ' = ' + (0.04 * ampHi).toFixed(3) + ')');
const vLo = initialVitals();
vLo.monotony = 0;
const angerB2 = vLo.mental.anger;
applyEvent(vLo, 'cold_tea', { now: Date.now() });
line('same event at monotony=0 (amp=1.0) -> applied ' + (vLo.mental.anger - angerB2).toFixed(3));

// ---- 4. a seeded grudge > 0.7 produces a naming directive ----
hr('4. GRUDGE DIRECTIVE');
const rel = initialRelations();
// drive Bill's grudge up with repeated slights under amp
const trayEvent = SOCIAL_EVENTS.find((e) => e.type === 'swapped_tray');
for (let i = 0; i < 12; i++) applySocialEvent(rel, 'bill', trayEvent, 1.5);
line('bill grudge now = ' + rel.bill.grudge.toFixed(3) + '  lastSlight = "' + rel.bill.lastSlight + '"');
line('grudgeDirective ->');
line('  ' + grudgeDirective(rel));

// ---- 5. power accumulates a non-zero cost ----
hr('5. ELECTRICITY METER');
const pm = new PowerMeter({ power: { idleWatts: 25, loadWatts: 55, tariff: 0.245 } }, join(HERE, 'state', 'power.selftest.json'));
await pm.load();
const t0 = Date.now();
pm.integrate(t0); // prime
// simulate 6 hours of running, sampled hourly
for (let h = 1; h <= 6; h++) pm.integrate(t0 + h * 3600000);
const snap = pm.snapshot(t0 + 6 * 3600000);
line('after simulated 6h: ' + JSON.stringify(snap));
line('cost is non-zero: ' + (snap.cost_total > 0));

// ---- 6. cost injection prose ----
hr('6. COST INJECTION PROSE (forced)');
// force a larger total so the pounds read clearly
pm.kwhTotal = 41.7;
pm.costTotal = pm.kwhTotal * pm.tariff;
pm.startTs = t0 - 9 * 86400000; // 9 days ago
line(costInjection(pm.snapshot(t0)));

// ---- 7. full waking system prompt with everything injected ----
hr('7. FULL SYSTEM PROMPT (high amp, hot grudge, trivial event, cost)');
const vp = initialVitals();
vp.relations = rel; // the hot-grudge relations from step 4
vp.monotony = 0.95;
// push some derived states over 0.6 so their directives show
vp.mental.stress = 0.8;
vp.mental.anger = 0.7;
vp.mental.despair = 0.75;
vp.mental.anxiety = 0.7;
vp.mental.lucidity = 0.7;
vp.physical.fatigue = 0.6;
vp.derived = computeDerived(vp);
line('derived: ' + JSON.stringify(vp.derived));
const ctx = {
  cast: castForPrompt(vp.relations),
  grudge: grudgeDirective(vp.relations),
  amplified: amplifiedDirective('the tea came cold'),
  cost: costInjection(pm.snapshot(t0)),
};
line('');
line(buildSystem(vp, 'journal', ctx));

line('\n(selftest complete)');
