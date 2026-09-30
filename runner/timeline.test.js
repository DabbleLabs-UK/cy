import assert from 'node:assert/strict';
import {
  ambientEventLabel,
  bindEndpointTime,
  clockOf,
  dayLabel,
  endpointLabel,
  formatDuration,
  isLiveDate,
  liveDateCorrection,
  londonToday,
  previousDate,
  refreshEndpointTimes,
  scheduledRoutineLabel,
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
assert.equal(liveDateCorrection('2026-09-29', '2026-09-30'), '2026-09-30',
  'a long-running live tab corrects a missed rollover');
assert.equal(liveDateCorrection('2026-09-28', '2026-09-30'), '2026-09-30',
  'a suspended tab can catch up by more than one day');
assert.equal(liveDateCorrection('2026-09-30', '2026-09-30'), null,
  'an already-correct tab does not replay the rollover');
assert.equal(liveDateCorrection('2026-09-29', '2026-09-30', { historyMode: true }), null,
  'date correction does not interrupt history reading');
assert.equal(liveDateCorrection('2026-09-29', '2026-09-30', { bootstrapping: true }), null,
  'date correction does not interrupt initial day loading');
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
assert.equal(ambientEventLabel({ name: 'location_transition', text: 'Cy was taken onto the exercise yard' }), 'Cy was taken onto the exercise yard');
assert.equal(ambientEventLabel({ name: 'yard_quiet' }), 'a quiet turn around the exercise yard');
assert.equal(ambientEventLabel({ name: 'cell_search_property_result' }), 'the cell search produced a result');
assert.equal(ambientEventLabel({ name: 'provider', to: 'deepseek' }), '');
assert.equal(scheduledRoutineLabel({ name: 'breakfast_eaten', meal: 'breakfast', outcome: 'eaten' }),
  'breakfast came and Cy ate it');
assert.equal(scheduledRoutineLabel({ name: 'lunch_partial', meal: 'lunch', outcome: 'partial' }),
  'lunch came; Cy ate some');
assert.equal(scheduledRoutineLabel({ name: 'tea_missed', meal: 'tea', outcome: 'missed' }),
  'tea did not reach Cy');
assert.equal(scheduledRoutineLabel({ name: 'supper snack_refused', meal: 'supper snack', outcome: 'refused' }),
  'supper snack came; Cy did not eat it');
assert.equal(scheduledRoutineLabel({ name: 'shower_cold', routine: 'shower', outcome: 'shower_cold' }),
  'the shower ran cold');
assert.equal(scheduledRoutineLabel({ name: 'association_shared_joke', routine: 'association', outcome: 'association_shared_joke' }),
  'a joke on association');
assert.equal(scheduledRoutineLabel({ name: 'phone_no_answer', routine: 'phone', outcome: 'phone_no_answer' }),
  'the phone rang out');
assert.equal(scheduledRoutineLabel({ name: 'breakfast_expected', meal: 'breakfast', outcome: 'expected' }), '',
  'an expected meal is not an actual meal');
assert.equal(scheduledRoutineLabel({ name: 'breakfast_eaten', meal: 'breakfast' }), '',
  'a name without an outcome does not create a public meal');
assert.equal(scheduledRoutineLabel({ name: 'breakfast_eaten', meal: 'lunch', outcome: 'eaten' }), '',
  'contradictory name and meal facts are not presented as routine');
assert.equal(scheduledRoutineLabel({ name: 'cold_tea' }), '',
  'ambient tray irritations are not promoted to scheduled meals');
assert.equal(scheduledRoutineLabel({ name: 'yard_interaction' }), '',
  'already-visible yard events are not duplicated by routine handling');
assert.equal(ambientEventLabel({ name: 'lunch_eaten', meal: 'lunch', outcome: 'eaten' }),
  'lunch came and Cy ate it', 'alternate plain view uses the same grounded routine label');

// londonToday() has no injectable clock (it must read the real viewer clock
// to be any use as a drift self-check), so cross-check its output shape and
// value against an independent computation of the same instant rather than
// asserting a fixed date.
assert.match(londonToday(), /^\d{4}-\d{2}-\d{2}$/);
{
  const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  assert.equal(londonToday(), expected, 'must agree with an independent Europe/London formatter for "now"');
}

console.log('timeline.test.js: all checks passed');
