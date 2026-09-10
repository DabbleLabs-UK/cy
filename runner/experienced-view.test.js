import assert from 'node:assert/strict';
import { metricExplanation, buildHistoryPath, buildHistoryUrl } from '../public/assets/brain.js';

const metric = {
  label: 'ANXIETY', value: 64, baseline: 18, trend: 'rising', trendDelta: 4.2,
  contributors: [{ contribution: 22.4, description: 'threat or lost control in: the cell search' }],
};
const explanation = metricExplanation(metric);
assert.match(explanation, /Current 64/);
assert.match(explanation, /Resting tendency 18/);
assert.match(explanation, /\+22\.4: threat or lost control in: the cell search/);

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
console.log('experienced-view.test.js: all checks passed');
