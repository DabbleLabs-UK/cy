// soma-promotion.test.js
//
// Locks the Soma #3 promotion of Physiological Satiety: exactly three
// subsystems (Anxiety, Homeostatic Sleep Pressure, Physiological Satiety) are
// promoted above the legacy quarantine, in that order; legacy hunger cannot
// appear in the promoted UI; the satiety wording never claims a subjective
// feeling; and every other legacy/provisional model stays quarantined.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { implementationEntry } from './implementation-registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'public', 'assets', 'brain.js'), 'utf8');

// Exactly three promoted blocks, in the required order, before the quarantine.
const anxietyAt = source.indexOf('soma-anxiety-promoted');
const sleepPressureAt = source.indexOf('soma-sleep-pressure-promoted');
const satietyAt = source.indexOf('soma-satiety-promoted');
const quarantineAt = source.indexOf('soma-legacy-quarantine');
assert.ok(anxietyAt > 0 && sleepPressureAt > anxietyAt && satietyAt > sleepPressureAt && quarantineAt > satietyAt,
  'exactly three subsystems are promoted in order: Anxiety, Homeostatic Sleep Pressure, Physiological Satiety, then the quarantine');

// No fourth promoted block exists.
assert.equal((source.match(/-promoted"/g) || []).length, 3,
  'exactly three "-promoted" containers exist; no unapproved fourth promotion');

// The quarantine note names exactly the three promoted subsystems.
assert.match(source, /Only Anxiety, Homeostatic Sleep Pressure and Physiological Satiety above are currently promoted\./);

// Honest, non-subjective wording for satiety.
assert.match(source, /Physiological satiety is a model estimate of post-meal gastrointestinal and hormonal state\. It is not a measurement of whether Cy feels hungry or full\./);
assert.doesNotMatch(source, /Cy is hungry/i);
assert.doesNotMatch(source, /Cy is full\b/i);
assert.doesNotMatch(source, /SUBJECTIVE HUNGER/);
assert.doesNotMatch(source, /HUNGER HISTORY/);
assert.doesNotMatch(source, /data-metric="hunger"/,
  'the legacy hunger scalar must never become a rendered Soma row');

// The satiety readout is routed to its own promoted container, not the
// quarantined public readout, mirroring how Anxiety is already routed.
assert.match(source,
  /const target = definition\.key === 'anxiety' \? anxietyReadout\s*\n\s*: definition\.key === 'satiety' \? satietyReadout/);

// Registry: satiety stays IMPLEMENTED and legacy hunger stays quarantined.
const satietyEntry = implementationEntry('soma_variables', 'satiety');
assert.equal(satietyEntry.implementation_status, 'IMPLEMENTED');
const legacyHunger = implementationEntry('soma_subsystems', 'legacy_hunger_metric');
assert.ok(legacyHunger, 'the legacy hunger scalar remains documented as a quarantined diagnostic');
assert.equal(legacyHunger.lifecycle_status, 'DIAGNOSTICS_ONLY');
assert.equal(legacyHunger.data_flow_status, 'ISOLATED');

// Every other legacy/provisional model remains inside the quarantine markup,
// not promoted alongside Anxiety / Sleep Pressure / Satiety.
const promotedBlock = source.slice(anxietyAt, quarantineAt);
for (const stillQuarantined of ['circadian-process-card', 'predicted-sleepiness-card', 'threat-learning-card', 'legacy-heart', 'legacy-mental', 'legacy-brain']) {
  assert.ok(!promotedBlock.includes(stillQuarantined),
    `${stillQuarantined} must remain inside the quarantine, not the promoted block`);
}
assert.ok(source.slice(quarantineAt).includes('circadian-process-card'), 'Circadian Process C markup still exists, inside the quarantine');
assert.ok(source.slice(quarantineAt).includes('predicted-sleepiness-card'), 'Predicted sleepiness (KSS) markup still exists, inside the quarantine');

console.log('soma-promotion.test.js: all checks passed');
