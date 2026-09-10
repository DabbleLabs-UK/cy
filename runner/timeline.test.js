import assert from 'node:assert/strict';
import {
  ambientEventLabel,
  bindEndpointTime,
  clockOf,
  dayLabel,
  endpointLabel,
  formatDuration,
  isLiveDate,
  previousDate,
  refreshEndpointTimes,
  shiftDate,
  shiftTimestamp,
  timestampMs,
} from '../public/assets/timeline.js';

assert.equal(formatDuration(2480), '41m 20s');
assert.equal(formatDuration(3661), '1h 1m 1s');
assert.equal(formatDuration(0), '0s');
assert.equal(previousDate('2026-03-01'), '2026-02-28');
assert.equal(previousDate('2024-03-01'), '2024-02-29');
assert.equal(shiftDate('2026-03-01', 1), '2026-03-02');
assert.equal(isLiveDate('2026-09-10', '2026-09-10'), true, 'today selects the live view');
assert.equal(isLiveDate('2026-09-09', '2026-09-10'), false, 'an earlier date selects history');
assert.equal(clockOf('2026-09-09 14:03:27'), '14:03:27');
assert.match(dayLabel('2026-09-09'), /9 September 2026/);
assert.equal(
  endpointLabel('2026-09-09 20:15:45', timestampMs('2026-09-09 20:20:48')),
  '20:15:45 (5m 3s)',
);
const endpoint = { dataset: {}, textContent: '', isConnected: true };
bindEndpointTime(endpoint, '2026-09-09 20:15:45', timestampMs('2026-09-09 20:20:48'));
refreshEndpointTimes(timestampMs('2026-09-09 20:20:49'));
assert.equal(endpoint.textContent, '20:15:45 (5m 4s)', 'endpoint ages advance once per second');
assert.equal(shiftTimestamp('2026-09-09 20:15:45', -125), '2026-09-09 20:13:40');
assert.equal(
  timestampMs('2026-09-09 20:15:45'),
  Date.UTC(2026, 8, 9, 19, 15, 45),
  'Cy timestamps are Europe/London wall time, including BST',
);
assert.equal(ambientEventLabel({ name: 'cell_search' }), 'the cell is searched');
assert.equal(ambientEventLabel({ name: 'provider', to: 'deepseek' }), '');

console.log('timeline.test.js: all checks passed');
