import assert from 'node:assert/strict';
import {
  buildHistoryPath,
  buildHistoryUrl,
  closeOtherReadings,
  contributorExplanation,
  metricExplanation,
  metricStateSummary,
  visibleContributors,
} from '../public/assets/brain.js';

const metric = {
  label: 'ANXIETY', value: 64, baseline: 18, trend: 'rising', trendDelta: 4.2,
  contributors: [{ contribution: 22.4, description: 'threat or lost control in: the cell search' }],
};
const explanation = metricExplanation(metric);
assert.match(explanation, /Current level 64/);
assert.match(explanation, /Usual resting level 18/);
assert.match(explanation, /\+22\.4: threat or lost control in: the cell search/);
assert.equal(metricStateSummary(metric), 'Current level 64; usual resting level 18. It has risen 4.2 points recently.');

const repeated = {
  contributors: [
    { contribution: 22.4, sourceType: 'cognitive_event', sourceId: '45:unresolved', startedAtMs: 1, description: 'the cell search' },
    { contribution: 18, sourceType: 'cognitive_event', sourceId: '46:unresolved', startedAtMs: 2, description: 'the cell search' },
    { contribution: -5, sourceType: 'social', sourceId: 'visitor:1', startedAtMs: 3, description: 'a kind postcard' },
  ],
};
assert.deepEqual(visibleContributors(repeated).map((item) => item.description), ['the cell search', 'a kind postcard'], 'visible evidence is deduplicated');
const readableContributor = contributorExplanation(repeated.contributors[0]);
assert.match(readableContributor, /the cell search - raised this by 22\.4/);
assert.doesNotMatch(readableContributor, /cognitive_event|45:unresolved/, 'internal source identifiers stay out of the normal disclosure');

const path = buildHistoryPath([
  { ts: 0, value: 10 }, { ts: 60000, value: 20 }, { ts: 120000, value: 30 },
  { ts: 900000, value: 40 },
]);
assert.equal((path.match(/M/g) || []).length, 2, 'a missing-data interval must remain a visible graph gap');
assert.ok((path.match(/L/g) || []).length >= 2, 'contiguous real readings must remain connected');
assert.equal(
  buildHistoryUrl('/api/soma-history.php', 'brain', 'temporalSocial', '7d'),
  '/api/soma-history.php?scope=brain&key=temporalSocial&range=7d',
  'brain regions and Soma metrics share the same history URL builder',
);

const anxietyReading = { open: true };
const arousalReading = { open: true };
const brainReading = { open: true };
closeOtherReadings([anxietyReading, arousalReading, brainReading], arousalReading);
assert.equal(anxietyReading.open, false, 'opening another reading closes the previously open Soma row');
assert.equal(arousalReading.open, true, 'the newly opened reading stays open');
assert.equal(brainReading.open, false, 'the single-open behavior also spans brain-region rows');
console.log('experienced-view.test.js: all checks passed');
