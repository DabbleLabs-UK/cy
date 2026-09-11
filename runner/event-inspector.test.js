import assert from 'node:assert/strict';
import { INSPECTION_HEADINGS, loadEnvironmentInspection } from '../public/assets/event-inspector.js';

assert.deepEqual(INSPECTION_HEADINGS.map((entry) => entry[1]), [
  'WHAT HAPPENED',
  'WHAT CY OBSERVED',
  'WHAT SOMA RECEIVED',
  'WHAT THREAT LEARNING DID',
  'WHAT CURRENT DEFENSIVE CONTEXT DID',
  'WHAT ACTION-OUTCOME CONTINGENCY DID',
  'WHAT INSTRUMENTAL AGENCY DID',
  'WHAT FEEDING LEDGER DID',
  'WHAT SYSTEMS CONSUMED IT',
]);

let requested = '';
const inspection = await loadEnvironmentInspection('/api/environment-event.php', 'env 1', async (url) => {
  requested = url;
  return { ok: true, json: async () => ({ ok: true, inspection: { event_id: 'env 1' } }) };
});
assert.equal(requested, '/api/environment-event.php?id=env%201');
assert.equal(inspection.event_id, 'env 1');

console.log('event-inspector.test.js: all checks passed');
