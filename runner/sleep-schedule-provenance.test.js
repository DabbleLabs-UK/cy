// sleep-schedule-provenance.test.js - Cy has no biological sleep sensor: his
// sleep/wake state is imposed from the fixed lights-out/lights-on schedule,
// then written into structured state. This test guards against that state
// being re-described anywhere (registry provenance, public UI, prompt
// context) as if it had been directly, biologically observed.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const brainSource = readFileSync(new URL('../public/assets/brain.js', import.meta.url), 'utf8');
const registry = JSON.parse(readFileSync(new URL('../config/implementation-registry.json', import.meta.url), 'utf8'));
const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
const proseContextSource = readFileSync(new URL('./grounded-prose-context.js', import.meta.url), 'utf8');

// 1/2. Registry provenance for all three sleep-related subsystems must not
// claim direct observation, whether the schedule currently reads asleep or
// awake - the claim is about provenance, not the momentary state.
const sleepinessNote = registry.soma_variables.find((entry) => entry.id === 'sleepiness').status_note;
const homeostasisNote = registry.soma_subsystems.find((entry) => entry.id === 'sleep_homeostasis').status_note;
const tpmNote = registry.soma_subsystems.find((entry) => entry.id === 'predicted_sleepiness_tpm').status_note;
for (const note of [sleepinessNote, homeostasisNote, tpmNote]) {
  assert.doesNotMatch(note, /observed/i, `registry status_note must not claim observation: ${note}`);
  assert.match(note, /schedule-derived/i, `registry status_note must be honest about provenance: ${note}`);
}

// Public UI: the predicted-sleepiness and Process S cards must not label
// schedule-derived sleep history as "OBSERVED".
assert.doesNotMatch(brainSource, /SLEEP HISTORY<\/dt><dd>OBSERVED/);
assert.match(brainSource, /two complete schedule-derived sleep episodes are required/i,
  'the sleep-history provenance facts dl was removed as main-page jargon, but the schedule-derived (not directly observed) framing must remain honest somewhere on the card');
assert.doesNotMatch(brainSource, /observed sleep history/i);
assert.doesNotMatch(brainSource, /observed sleep episodes?/i);
assert.doesNotMatch(brainSource, /FROM OBSERVED SLEEP HISTORY/);
assert.match(brainSource, /CALIBRATING FROM SCHEDULE-DERIVED SLEEP HISTORY/);
assert.match(brainSource, /ESTABLISHED FROM SCHEDULE-DERIVED SLEEP HISTORY/);

// Process C's own "cannot be observed" honesty (already correct) must remain
// intact - this file only removes FALSE observation claims, not true ones.
assert.match(brainSource, /Cy's exact biological phase cannot be observed/);

// Prompt-facing CALIBRATING text must use the same honest wording.
assert.doesNotMatch(proseContextSource, /observed sleep episodes?/i);
assert.match(proseContextSource, /schedule-derived sleep episodes/i);

// 1/2 (schedule-driven sync summary). Neither branch of the runner's
// asleep/awake sync summary - the text written when the schedule (not a
// sensor) flips Cy's recorded sleep state - may claim direct observation.
const summaryMatch = runSource.match(/const summary = asleep \? '([^']+)' : '([^']+)';/);
assert.ok(summaryMatch, 'the asleep/awake sync summary literals must be present in run.js');
const [, asleepSummary, awakeSummary] = summaryMatch;
assert.doesNotMatch(asleepSummary, /observed/i, `scheduled-asleep summary must not claim observation: "${asleepSummary}"`);
assert.doesNotMatch(awakeSummary, /observed/i, `scheduled-awake summary must not claim observation: "${awakeSummary}"`);

console.log('sleep-schedule-provenance.test.js: all checks passed');
