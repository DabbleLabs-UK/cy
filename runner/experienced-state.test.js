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
  const lonelinessBefore = experiencedSnapshot(s).metrics.loneliness.value;
  observe(s, 'hostile_fight', { threat: 0.78, controlLoss: 0.55 }, ['hostile', 'fight']);
  const view = experiencedSnapshot(s);
  assert.ok(view.metrics.anger.value > view.metrics.anger.baseline);
  assert.ok(view.metrics.anxiety.value > view.metrics.anxiety.baseline);
  assert.equal(view.metrics.loneliness.value, lonelinessBefore, 'hostile presence is not reassuring contact');
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

// G: injury words cannot manufacture or change the legacy Pain scalar.
{
  const s = state();
  const painBefore = experiencedSnapshot(s).metrics.pain.value;
  observe(s, 'injury', { threat: 0.65 }, ['injury', 'pain']);
  const peak = experiencedSnapshot(s);
  tickExperienced(s, { now: T0 + 2 * HOUR, asleep: false });
  const later = experiencedSnapshot(s);
  const arousalRetained = later.metrics.arousal.value - later.metrics.arousal.baseline;
  assert.ok(arousalRetained < peak.metrics.arousal.value - peak.metrics.arousal.baseline);
  assert.equal(peak.metrics.pain.value, painBefore);
  assert.equal(later.metrics.pain.value, painBefore);
  assert.deepEqual(peak.metrics.pain.contributors, []);
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

  const unqualified = JSON.parse(JSON.stringify(s));
  unqualified.contributors.loneliness.push({
    id: 'old:contact', sourceId: 'old', sourceType: 'social_event',
    description: 'contact from an interaction not checked for hostility', amount: -20,
    mode: 'impulse', startedAtMs: T0, updatedAtMs: T0, halfLifeMs: 5 * HOUR,
  });
  const cleaned = reconcileExperienced(unqualified, { now: T0 + 2000 });
  assert.ok(!cleaned.contributors.loneliness.some((item) => item.id === 'old:contact'),
    'unqualified reassurance from the brief pre-fix state is removed on restart');
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

// J: old ungrounded body values and permanent migration contributors are
// discarded instead of becoming causes in the new state.
{
  const legacy = blankExperienced(T0);
  legacy.version = 1;
  legacy.contributors.hunger.push({
    id: 'migration:hunger', sourceType: 'migration', description: 'old value', amount: 82,
    mode: 'level', startedAtMs: T0, updatedAtMs: T0, halfLifeMs: HOUR,
  });
  legacy.metrics.hunger.value = 100;
  const restored = reconcileExperienced(legacy, {
    now: T0 + 1000,
    legacyPhysical: { pain: 1, hunger: 1, fatigue: 1 },
  });
  assert.equal(restored.version, 2);
  assert.equal(experiencedSnapshot(restored).metrics.hunger.value, 18);
  assert.ok(!restored.contributors.hunger.some((item) => item.sourceType === 'migration'));
}

// K: ordinary repeated incidents approach a soft ceiling and never pin a
// visible variable at 100.
{
  const s = blankExperienced(T0);
  for (let i = 0; i < 80; i++) {
    observe(s, `search_${i}`, { threat: 0.65, controlLoss: 0.6 }, ['threat'], T0 + i * 1000);
  }
  const view = experiencedSnapshot(s, T0 + 80000);
  assert.ok(view.metrics.anxiety.value < 100);
  assert.ok(view.metrics.arousal.value < 100);
  assert.ok(view.metrics.rumination.value < 100);
}

// L: a full day is grounded in recorded food and sleep. Hunger rises from the
// last eaten meal, another meal lowers it, and actual sleep restores fatigue.
{
  const s = blankExperienced(T0);
  observeExperienced(s, {
    observation: {
      name: 'breakfast_eaten', text: 'breakfast came and he ate it', tags: ['meal', 'food'],
      body: { meal: { name: 'breakfast', outcome: 'eaten', amount: 1 } },
    },
    appraisal: {}, prediction: {}, family: 'meal',
  }, T0);
  const fed = experiencedSnapshot(s, T0).metrics.hunger.value;
  tickExperienced(s, { now: T0 + 14 * HOUR, asleep: false });
  const beforeTea = experiencedSnapshot(s, T0 + 14 * HOUR).metrics.hunger.value;
  assert.ok(beforeTea > fed + 35);
  observeExperienced(s, {
    observation: {
      name: 'tea_eaten', text: 'tea came and he ate it', tags: ['meal', 'food'],
      body: { meal: { name: 'tea', outcome: 'eaten', amount: 1 } },
    },
    appraisal: {}, prediction: {}, family: 'meal',
  }, T0 + 14 * HOUR);
  assert.ok(experiencedSnapshot(s, T0 + 14 * HOUR).metrics.hunger.value < beforeTea);
  const beforeSleep = experiencedSnapshot(s, T0 + 16 * HOUR).metrics.fatigue.value;
  tickExperienced(s, { now: T0 + 24 * HOUR, asleep: true });
  const afterSleep = experiencedSnapshot(s, T0 + 24 * HOUR).metrics.fatigue.value;
  assert.ok(afterSleep < beforeSleep);
  assert.ok(s.body.sleep.totalSleepMs >= 8 * HOUR);
}

// M: body history and the causal clocks survive a restart and continue from
// the stored meal/sleep facts rather than re-reading legacy mirrors.
{
  const s = blankExperienced(T0);
  observeExperienced(s, {
    observation: {
      name: 'lunch_partial', text: 'some lunch was eaten', tags: ['meal', 'food'],
      body: { meal: { name: 'lunch', outcome: 'partial', amount: 0.45 } },
    },
    appraisal: {}, prediction: {}, family: 'meal',
  }, T0 + HOUR);
  tickExperienced(s, { now: T0 + 9 * HOUR, asleep: false });
  const before = experiencedSnapshot(s, T0 + 9 * HOUR);
  const restored = reconcileExperienced(JSON.parse(JSON.stringify(s)), { now: T0 + 9 * HOUR });
  const after = experiencedSnapshot(restored, T0 + 9 * HOUR);
  assert.equal(after.body.nutrition.lastMealAtMs, T0 + HOUR);
  assert.equal(after.body.nutrition.lastOutcome, 'partial');
  assert.equal(after.metrics.hunger.value, before.metrics.hunger.value);
  assert.equal(experiencedHistory(restored).length, experiencedHistory(s).length);
}

// N: ordinary, non-threatening company is a real social input and lowers the
// social-need value without pretending every nearby person is reassuring.
{
  const s = blankExperienced(T0);
  observeExperienced(s, {
    observation: {
      name: 'quiet_company', text: 'someone sat with him for a while', tags: ['social'],
      social: { quality: 'ordinary', strength: 0.45 },
    },
    appraisal: { affiliation: 0.45, threat: 0.02 }, prediction: {}, family: 'social',
  }, T0);
  tickExperienced(s, { now: T0 + 30 * HOUR, asleep: false });
  const before = experiencedSnapshot(s).metrics.loneliness.value;
  observeExperienced(s, {
    observation: {
      name: 'association_quiet_company', text: 'sat together without any trouble',
      tags: ['social', 'company'], social: { quality: 'ordinary', strength: 0.5 },
    },
    appraisal: { affiliation: 0.5, threat: 0.03, controlLoss: 0.03 }, prediction: {}, family: 'social',
  }, T0 + 30 * HOUR + 1000);
  assert.ok(experiencedSnapshot(s).metrics.loneliness.value < before);
  assert.equal(s.body.social.supportiveContacts, 2);
}

console.log('experienced-state.test.js: all checks passed');
