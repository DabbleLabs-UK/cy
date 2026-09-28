// legacy-hunger-isolation.test.js
//
// The legacy elapsed-time-since-meal hunger scalar is quarantined. It must not
// alter the compatibility body/brain/derived diagnostics, must not couple into
// the presented arousal metric, and must be registered as DIAGNOSTICS_ONLY /
// ISOLATED. The grounded physiological satiety model is the only feeding signal
// that may reach presentation, the prompt or brain analogies.

import assert from 'node:assert/strict';
import { brainRegions, computeDerived, heartRate } from './vitals.js';
import { blankExperienced, tickExperienced, experiencedSnapshot } from './experienced-state.js';
import { implementationEntry } from './implementation-registry.js';

const HOUR = 60 * 60 * 1000;
const T0 = 1_000_000_000_000;

const legacyVitals = {
  physical: { pain: 0.1, hunger: 0.2, fatigue: 0.3 },
  mental: {
    anxiety: 0.2, stress: 0.25, despair: 0.1, hope: 0.2, lucidity: 0.7,
    agitation: 0.2, dissociation: 0.1, anger: 0.1, longing: 0.2,
  },
  relations: {}, monotony: 0.2, imageRecall: 0,
};
const highHunger = structuredClone(legacyVitals);
highHunger.physical.hunger = 1;

assert.equal(heartRate(highHunger), heartRate(legacyVitals),
  'legacy hunger cannot alter the synthetic heart-rate diagnostic');
assert.deepEqual(computeDerived(highHunger), computeDerived(legacyVitals),
  'legacy hunger cannot alter compatibility-derived state (overwhelm, brittleness)');
assert.deepEqual(brainRegions(highHunger), brainRegions(legacyVitals),
  'legacy hunger cannot alter any emitted brain-region value (insula)');

// The legacy hunger metric still accumulates as an isolated diagnostic, but it
// must never couple into the presented arousal metric.
const state = blankExperienced(T0, null);
state.body.nutrition.lastMealAtMs = T0 - 18 * HOUR; // deeply "hungry" clock
// Seed a stale pre-quarantine coupling contributor to prove self-healing.
state.contributors.arousal.push({
  id: 'coupling:body-arousal', sourceId: 'coupling:body-arousal', sourceType: 'state_coupling',
  description: 'stale legacy coupling', amount: 20, mode: 'level',
  startedAtMs: T0, updatedAtMs: T0, halfLifeMs: 3600000,
});
tickExperienced(state, { now: T0 + 18 * HOUR });
const snapshot = experiencedSnapshot(state, T0 + 18 * HOUR);
assert.ok(snapshot.metrics.hunger.value > 60,
  'the legacy hunger clock still rises as a diagnostic');
assert.ok(!state.contributors.arousal.some((item) => item.id === 'coupling:body-arousal'),
  'legacy hunger no longer couples into arousal and stale couplings self-heal');
assert.equal(snapshot.metrics.hunger.lifecycleStatus, 'DIAGNOSTICS_ONLY',
  'the hunger snapshot metric is labelled a quarantined diagnostic');

const entry = implementationEntry('soma_subsystems', 'legacy_hunger_metric');
assert.ok(entry, 'the registry documents the quarantined legacy hunger scalar');
assert.equal(entry.lifecycle_status, 'DIAGNOSTICS_ONLY');
assert.equal(entry.data_flow_status, 'ISOLATED');

console.log('legacy-hunger-isolation.test.js: all checks passed');
