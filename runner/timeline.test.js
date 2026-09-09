import assert from 'node:assert/strict';
import {
  ambientEventLabel,
  clockOf,
  dayLabel,
  formatDuration,
  previousDate,
  sinceLabel,
  timestampMs,
} from '../public/assets/timeline.js';

assert.equal(formatDuration(2480), '41m 20s');
assert.equal(formatDuration(3661), '1h 1m 1s');
assert.equal(formatDuration(0), '0s');
assert.equal(previousDate('2026-03-01'), '2026-02-28');
assert.equal(previousDate('2024-03-01'), '2024-02-29');
assert.equal(clockOf('2026-09-09 14:03:27'), '14:03:27');
assert.match(dayLabel('2026-09-09'), /9 September 2026/);
const before = timestampMs('2026-09-09 13:22:07');
assert.equal(sinceLabel('2026-09-09 14:03:27', before), '41m 20s since previous');
assert.equal(ambientEventLabel({ name: 'cell_search' }), 'the cell is searched');
assert.equal(ambientEventLabel({ name: 'provider', to: 'deepseek' }), '');

console.log('timeline.test.js: all checks passed');
