import assert from 'node:assert/strict';
import {
  blankExperienced,
  reconcileExperienced,
  observeExperienced,
  observeExperiencedOutput,
  tickExperienced,
  experiencedSnapshot,
  experiencedDirective,
  experiencedHistory,
} from './experienced-state.js';

const HOUR = 3600000;
const T0 = Date.parse('2026-09-10T08:00:00Z');
const state = () => blankExperienced(T0, { pain: 0.05, hunger: 0.65, fatigue: 0.75 });
const observe = (subject, name, appraisal, tags = [], at = T0 + 1000) => observeExperienced(subject, {
  observation: { name, text: name.replaceAll('_', ' '), tags },
  appraisal,
  prediction: { error: appraisal.predictionError || 0 },
  family: tags.includes('postcard') ? 'mail' : 'conflict',
}, at);

// A: threat raises both anxious expectation and immediate activation.
{
  const s = state();
  const before = experiencedSnapshot(s);
  observe(s, 'cell_search', { threat: 0.82, controlLoss: 0.9 }, ['threat', 'officer']);
  const after = experiencedSnapshot(s);
  assert.ok(after.metrics.anxiety.value > before.metrics.anxiety.value);
  assert.ok(after.metrics.arousal.value > before.metrics.arousal.value);
}

// B: an actual meal reduces accumulated hunger.
{
  const s = state();
  const before = experiencedSnapshot(s).metrics.hunger.value;
  observe(s, 'meal', { deprivation: 0 }, ['food', 'meal']);
  assert.ok(experiencedSnapshot(s).metrics.hunger.value < before);
}

// C: several hours asleep recover fatigue.
{
  const s = state();
  const before = experiencedSnapshot(s).metrics.fatigue.value;
  tickExperienced(s, { now: T0 + 4 * HOUR, asleep: true });
  assert.ok(experiencedSnapshot(s).metrics.fatigue.value < before);
}

// D: hostility raises anger and threat-related state.
{
  const s = state();
  observe(s, 'hostile_fight', { threat: 0.78, controlLoss: 0.55 }, ['hostile', 'fight']);
  const view = experiencedSnapshot(s);
  assert.ok(view.metrics.anger.value > view.metrics.anger.baseline);
  assert.ok(view.metrics.anxiety.value > view.metrics.anxiety.baseline);
}

// E: a friendly postcard relieves social need and mildly reassures.
{
  const s = state();
  const before = experiencedSnapshot(s).metrics.loneliness.value;
  observe(s, 'friendly_postcard', { affiliation: 0.9, threat: 0.02 }, ['postcard', 'warm']);
  assert.ok(experiencedSnapshot(s).metrics.loneliness.value < before);
}

// F: repeated self-output and an unresolved mismatch increase fixation.
{
  const s = state();
  observe(s, 'unexpected_lockdown', { controlLoss: 0.8, predictionError: 0.9 }, ['lockdown']);
  const before = experiencedSnapshot(s).metrics.rumination.value;
  observeExperiencedOutput(s, { repetition: 0.8, triggerActivation: 0.7, text: 'the same lock and number again' }, T0 + 2000);
  assert.ok(experiencedSnapshot(s).metrics.rumination.value > before);
}

// G: event categories recover differently: arousal falls much faster than pain.
{
  const s = state();
  observe(s, 'injury', { threat: 0.65 }, ['injury', 'pain']);
  const peak = experiencedSnapshot(s);
  tickExperienced(s, { now: T0 + 2 * HOUR, asleep: false });
  const later = experiencedSnapshot(s);
  const arousalRetained = later.metrics.arousal.value - later.metrics.arousal.baseline;
  const painRetained = later.metrics.pain.value - later.metrics.pain.baseline;
  assert.ok(arousalRetained < peak.metrics.arousal.value - peak.metrics.arousal.baseline);
  assert.ok(painRetained > arousalRetained);
}

// H: restart reconciliation preserves current values, contributors and history.
{
  const s = state();
  observe(s, 'cell_search', { threat: 0.75, controlLoss: 0.7 }, ['threat']);
  const json = JSON.parse(JSON.stringify(s));
  const restored = reconcileExperienced(json, { now: T0 + 2000 });
  assert.equal(experiencedSnapshot(restored).metrics.anxiety.value, experiencedSnapshot(s).metrics.anxiety.value);
  assert.equal(experiencedSnapshot(restored).metrics.anxiety.contributors[0].description,
    experiencedSnapshot(s).metrics.anxiety.contributors[0].description);
  assert.ok(experiencedHistory(restored).length >= 2);
}

// I: the public explanation and compact prompt name the same stored cause and
// contain no numeric score instruction.
{
  const s = state();
  observe(s, 'cell_search', { threat: 0.75, controlLoss: 0.7 }, ['threat']);
  const metric = experiencedSnapshot(s).metrics.anxiety;
  assert.match(metric.contributors[0].description, /cell search/);
  assert.match(experiencedDirective(s), /cell search/);
  assert.doesNotMatch(experiencedDirective(s), /\b\d+(?:\.\d+)?\b/);
}

console.log('experienced-state.test.js: all checks passed');
