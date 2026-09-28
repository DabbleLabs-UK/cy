// arousal-retirement.test.js
//
// Legacy Arousal/Stress is retired: an arbitrary decaying threat/control
// keyword heuristic that substantially duplicated promoted Anxiety, with no
// defensible physiological grounding. This proves the retirement is complete:
// it can no longer alter the heartbeat/BPM readout or drawing-pen animation,
// the registry correctly isolates it, no promoted UI section mentions it, its
// history remains readable, and Anxiety's own presentation is untouched.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { heartRate } from './vitals.js';
import { implementationEntry, implementationRegistry } from './implementation-registry.js';
import { blankExperienced, experiencedSnapshot } from './experienced-state.js';

const here = dirname(fileURLToPath(import.meta.url));

// A. Legacy arousal cannot alter the heart-rate diagnostic, at any level,
// asleep or awake. It always reports unavailable rather than a fabricated BPM.
const calmVitals = { physical: { pain: 0, hunger: 0, fatigue: 0 }, mental: {
  anxiety: 0, stress: 0, despair: 0, hope: 0.5, lucidity: 0.7, agitation: 0, dissociation: 0, anger: 0, longing: 0,
} };
const extremeVitals = { physical: { pain: 1, hunger: 1, fatigue: 1 }, mental: {
  anxiety: 1, stress: 1, despair: 1, hope: 0, lucidity: 0, agitation: 1, dissociation: 1, anger: 1, longing: 1,
} };
assert.equal(heartRate(calmVitals), null, 'heart rate must report unavailable, not a computed BPM');
assert.equal(heartRate(extremeVitals), null,
  'legacy arousal/agitation at maximum must not produce a computed BPM either');
assert.equal(heartRate(calmVitals, true), heartRate(calmVitals, false),
  'asleep/awake must not change the retired heart-rate output');

// B. Legacy arousal cannot alter drawing-pen animation. pen.js is browser-only
// (SVG/Web Animations DOM APIs), so - matching this repo's existing
// convention for such files (see brain.test.js) - verify by source, not by
// instantiating the renderer.
const penSource = await readFile(join(here, '..', 'public', 'assets', 'pen.js'), 'utf8');
const setVitalsBody = penSource.slice(
  penSource.indexOf('setVitals(payload) {'),
  penSource.indexOf('// ---- mode'),
);
assert.doesNotMatch(setVitalsBody, /me\.agitation/,
  'pen animation must no longer read mental.agitation at all');
assert.doesNotMatch(setVitalsBody, /const agitation/,
  'no agitation-derived variable may remain in the vitals-modulation path');
assert.match(setVitalsBody, /this\.penSpeed\s*=\s*112\s*\*/,
  'pen speed must be a fixed constant, not derived from any mental.* value');
assert.match(setVitalsBody, /this\.strokeWidth\s*=\s*1\.8;/,
  'stroke width must be a fixed constant, not derived from any mental.* value');

// C. Registry isolation: arousal is PROVISIONAL/DIAGNOSTICS_ONLY/ISOLATED with
// an honest legacy label, and the previously-false dependency claims are gone.
const arousalEntry = implementationEntry('soma_variables', 'arousal');
assert.ok(arousalEntry, 'the registry must still document the retired arousal scalar');
assert.equal(arousalEntry.implementation_status, 'PROVISIONAL');
assert.equal(arousalEntry.lifecycle_status, 'DIAGNOSTICS_ONLY');
assert.equal(arousalEntry.data_flow_status, 'ISOLATED');
assert.notEqual(arousalEntry.display_name, 'AROUSAL / STRESS LOAD',
  'the dishonest "AROUSAL / STRESS LOAD" label must be retired');
assert.doesNotMatch(arousalEntry.display_name, /AROUSAL/,
  'the public display name must not claim to measure arousal');
for (const falseDependency of ['possible_harm', 'nociceptive_impact', 'physical_discomfort']) {
  assert.ok(!arousalEntry.data_dependencies.includes(falseDependency),
    `${falseDependency} is never actually consumed by the arousal computation and must not be claimed`);
}
assert.deepEqual(arousalEntry.data_dependencies, ['sleep_interruption'],
  'the only genuinely-consumed structured input is sleep interruption');
// The schema-key validator in implementation-registry.test.js already proves
// every soma_variables dependency string is a real cy.soma-input field; this
// just pins the specific value so a future edit cannot silently widen it back.
assert.ok(implementationRegistry.soma_variables.some((entry) => entry.id === 'arousal'));

// D. No promoted UI section mentions arousal; the quarantine section carries
// the honest legacy label; the old dishonest label string is gone entirely.
const brainSource = await readFile(join(here, '..', 'public', 'assets', 'brain.js'), 'utf8');
assert.doesNotMatch(brainSource, /AROUSAL \/ STRESS/,
  'the old "AROUSAL / STRESS" label must not remain anywhere in the public UI source');
assert.match(brainSource, /LEGACY ACTIVATION HEURISTIC/,
  'the retired metric must carry an honest legacy label');
const promotedBlock = brainSource.slice(
  brainSource.indexOf('<div class="soma-anxiety-promoted">'),
  brainSource.indexOf('<details class="soma-legacy-quarantine">'),
);
assert.doesNotMatch(promotedBlock, /'arousal'|"arousal"|data-metric="arousal"/,
  'the three promoted cards (Anxiety, Sleep Pressure, Satiety) must not reference the arousal metric key');
// Incidental prose use of the word "arousal" is fine and expected here - the
// promoted Anxiety card explicitly disclaims being a biological-arousal
// reading, which is honest and should not be mistaken for a leaked metric.
assert.match(promotedBlock, /not a biological-arousal or brain-activation reading/);
// All eight EXPERIENCED_METRICS cards (including arousal - proven present in
// brain.test.js) are rendered into '.soma-public-readout'. Confirming that
// mount point sits inside the quarantine <details> - and nowhere in the three
// promoted blocks above - proves arousal can only ever appear there.
const quarantineBlock = brainSource.slice(brainSource.indexOf('<details class="soma-legacy-quarantine">'));
assert.match(quarantineBlock, /class="soma-public-readout"/,
  'the metric-card mount point (where arousal renders) must live inside the quarantine section');
assert.doesNotMatch(promotedBlock, /class="soma-public-readout"/,
  'the metric-card mount point must not also exist in the promoted section');

// E. Old arousal history remains fully readable: the server-side history path
// (lib/soma-history.php) is untouched by this retirement and is covered by
// tests/soma_history_test.php, which reads $.soma.experienced.metrics.arousal
// end to end. This just confirms the runner still emits that exact path.
const historyState = blankExperienced(1000, null);
const historySnapshot = experiencedSnapshot(historyState, 1000);
assert.ok(historySnapshot.metrics.arousal, 'the arousal metric must still be present for history continuity');
assert.equal(typeof historySnapshot.metrics.arousal.value, 'number',
  'the arousal metric must still expose a numeric value at the historical JSON path');
assert.equal(historySnapshot.metrics.arousal.implementationStatus, 'PROVISIONAL');
assert.equal(historySnapshot.metrics.arousal.lifecycleStatus, 'DIAGNOSTICS_ONLY');

// F. Anxiety's own presentation and registry entry are untouched by this
// retirement.
const anxietyEntry = implementationEntry('soma_variables', 'anxiety');
assert.equal(anxietyEntry.implementation_status, 'IMPLEMENTED');
assert.equal(anxietyEntry.display_name, 'ANXIETY');
assert.match(brainSource, /Anxiety here means Cy's current computed threat condition/,
  'the promoted Anxiety intro copy must be unchanged');

console.log('arousal-retirement.test.js: all checks passed');
