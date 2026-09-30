// day-rollover.test.js - the scheduler's day-rollover watch survives a
// restart landing anywhere near midnight, instead of silently skipping that
// day's 'day' event and vitals.day increment.
//
// initialRolloverDate/applyDayRollover are the exact two pieces scheduler()
// uses in run.js; main() itself is not exercised here (no live model, no
// network) - see abort.test.js for the established pattern of importing
// pure helpers out of run.js without triggering main().
//
//   node runner/day-rollover.test.js

import assert from 'node:assert/strict';
import { applyDayRollover, initialRolloverDate } from './run.js';

// A. Normal case: the persisted date already matches today (the previous
// process detected the rollover itself, or this is the same day it started
// on) - seed from it as-is, no spurious re-fire.
assert.equal(initialRolloverDate('2026-09-30', '2026-09-30'), '2026-09-30');

// B. THE BUG: a restart lands after a real midnight has passed but the
// persisted state still reflects yesterday (the pre-restart process went
// down before its own scheduler tick ever saw the new date). Restoring
// yesterday's date here - not "now" - is what lets the very next scheduler
// tick correctly detect `date !== prevDate` and fire the missed rollover.
assert.equal(initialRolloverDate('2026-09-29', '2026-09-30'), '2026-09-29');

// C. Fresh install / upgrading from before this field existed: no persisted
// value at all falls back to today, exactly as the old unconditional
// `londonParts().date` seed did.
assert.equal(initialRolloverDate(undefined, '2026-09-30'), '2026-09-30');
assert.equal(initialRolloverDate(null, '2026-09-30'), '2026-09-30');
assert.equal(initialRolloverDate('', '2026-09-30'), '2026-09-30');

// D. A corrupt/malformed persisted value is never trusted over the real
// current date. Shape-only validation (YYYY-MM-DD), matching the existing
// convention elsewhere in this codebase (e.g. timetravel.js's validDate) -
// not a new calendar-validity check.
assert.equal(initialRolloverDate('not-a-date', '2026-09-30'), '2026-09-30');
assert.equal(initialRolloverDate('30-09-2026', '2026-09-30'), '2026-09-30');

// E. applyDayRollover increments the day counter and persists the new date
// together, so a crash between them can't reopen the gap (B) exists to close.
{
  const vitals = { day: 50 };
  const n = applyDayRollover(vitals, '2026-09-30');
  assert.equal(n, 51);
  assert.equal(vitals.day, 51);
  assert.equal(vitals.lastRolloverDate, '2026-09-30');
}

// F. A never-before-run vitals object (no day field yet) starts counting
// from 1, same as the pre-existing `vitals.day || 1` fallback.
{
  const vitals = {};
  const n = applyDayRollover(vitals, '2026-09-25');
  assert.equal(n, 2);
  assert.equal(vitals.day, 2);
}

// G. End-to-end restart simulation: a process runs up to just before
// midnight, crashes, and a fresh process starts just after midnight. Without
// the fix, the fresh process's prevDate would seed straight to the new date
// and the transition would never fire; with it, the persisted (stale)
// lastRolloverDate correctly triggers exactly one rollover.
{
  const vitals = { day: 50, lastRolloverDate: '2026-09-29' }; // persisted before the crash
  const nowDateAfterRestart = '2026-09-30';
  let prevDate = initialRolloverDate(vitals.lastRolloverDate, nowDateAfterRestart);
  assert.equal(prevDate, '2026-09-29', 'must seed from the stale persisted date, not "now"');
  // first scheduler tick after restart
  const rolled = prevDate !== nowDateAfterRestart;
  assert.equal(rolled, true, 'the missed midnight must still be detected on the first post-restart tick');
  if (rolled) {
    applyDayRollover(vitals, nowDateAfterRestart);
    prevDate = nowDateAfterRestart;
  }
  assert.equal(vitals.day, 51);
  assert.equal(vitals.lastRolloverDate, '2026-09-30');
  // a second tick moments later must NOT re-fire
  const rolledAgain = prevDate !== nowDateAfterRestart;
  assert.equal(rolledAgain, false, 'must not double-fire on the very next tick');
}

console.log('day-rollover.test.js: all checks passed');
