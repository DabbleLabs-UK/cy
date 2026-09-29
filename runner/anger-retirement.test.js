// anger-retirement.test.js
//
// Legacy Anger/Hostility is retired: an arbitrary decaying threat/control
// keyword heuristic that substantially duplicated Anxiety (and formerly
// Arousal), with registry-claimed appraisal-theory dependencies that were
// never actually read. This proves the retirement is complete: it is no
// longer mirrored into compatibility vitals, the registry correctly isolates
// it, history remains readable, and - critically - the separate, still-live
// shout.js capitalisation mechanism (which owns vitals.mental.anger via its
// own independent grudge/self-text model) is untouched by this retirement.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { implementationEntry } from './implementation-registry.js';
import { blankExperienced, experiencedSnapshot } from './experienced-state.js';
import { updateAffect } from './shout.js';

const here = dirname(fileURLToPath(import.meta.url));

// A. Registry isolation: honest label, PROVISIONAL/DIAGNOSTICS_ONLY/ISOLATED,
// and the previously-false appraisal-theory dependency claims are gone.
const angerEntry = implementationEntry('soma_variables', 'anger');
assert.ok(angerEntry, 'the registry must still document the retired anger scalar');
assert.equal(angerEntry.implementation_status, 'PROVISIONAL');
assert.equal(angerEntry.lifecycle_status, 'DIAGNOSTICS_ONLY');
assert.equal(angerEntry.data_flow_status, 'ISOLATED');
assert.notEqual(angerEntry.display_name, 'ANGER / HOSTILITY',
  'the dishonest "ANGER / HOSTILITY" label must be retired');
for (const falseDependency of ['goal_obstruction', 'agency', 'responsibility_evidence', 'intent', 'learned_context']) {
  assert.ok(!angerEntry.data_dependencies.includes(falseDependency),
    `${falseDependency} is never actually consumed by the anger computation and must not be claimed`);
}
assert.deepEqual(angerEntry.data_dependencies, [],
  'no genuinely-consumed structured dependency exists for this heuristic');

// B. run.js no longer mirrors the legacy anger metric into compatibility
// vitals. This is a source check (same convention as the arousal retirement)
// since the live mirror was a specific assignment line, not a function.
const runSource = await readFile(join(here, 'run.js'), 'utf8');
assert.doesNotMatch(runSource, /vitals\.mental\.anger\s*=\s*experienced\.anger\.value/,
  'the legacy anger metric must no longer be mirrored into vitals.mental.anger');

// C. shout.js is untouched: it still independently owns vitals.mental.anger
// via its own grudge/self-text easing, unrelated to the retired metric.
assert.match(runSource, /updateAffect\(vitals, \{ amp: ampOf\(vitals\) \}\)/,
  'the separate, independently-audited shout.js affect mechanism must remain live');
const before = { mental: { anger: 0.4 }, lastBurstAnger: 0.6, relations: { x: { grudge: 0.5 } } };
const result = updateAffect(before, { amp: 1 });
assert.ok(Number.isFinite(result.anger) && result.anger > 0,
  'shout.js anger dynamics must still function, driven by its own inputs, not the retired metric');

// D. Historical continuity: the anger metric is still present and correctly
// flagged for the existing quarantine diagnostics rendering.
const state = blankExperienced(1000, null);
const snapshot = experiencedSnapshot(state, 1000);
assert.ok(snapshot.metrics.anger, 'the anger metric must still be present for history continuity');
assert.equal(typeof snapshot.metrics.anger.value, 'number');
assert.equal(snapshot.metrics.anger.implementationStatus, 'PROVISIONAL');
assert.equal(snapshot.metrics.anger.lifecycleStatus, 'DIAGNOSTICS_ONLY');

// E. No promoted UI section mentions the legacy anger metric; Anxiety is
// unaffected.
const brainSource = await readFile(join(here, '..', 'public', 'assets', 'brain.js'), 'utf8');
assert.doesNotMatch(brainSource, /'ANGER \/ HOSTILITY'/,
  'the old "ANGER / HOSTILITY" label must not remain anywhere in the public UI source');
const promotedBlock = brainSource.slice(
  brainSource.indexOf('<div class="soma-anxiety-promoted"'),
  brainSource.indexOf('<details class="soma-legacy-quarantine">'),
);
assert.ok(promotedBlock.length > 100, 'promoted-card slice failed to locate its start/end anchors');
assert.doesNotMatch(promotedBlock, /'anger'|"anger"|data-metric="anger"/,
  'the three promoted cards must not reference the anger metric key');
const anxietyEntry = implementationEntry('soma_variables', 'anxiety');
assert.equal(anxietyEntry.implementation_status, 'IMPLEMENTED');
assert.equal(anxietyEntry.display_name, 'ANXIETY');

console.log('anger-retirement.test.js: all checks passed');
