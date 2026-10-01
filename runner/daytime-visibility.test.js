import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchDayEvents, NARRATIVE_KINDS } from '../public/assets/history-feed.js';
import { scheduledRoutineLabel } from '../public/assets/timeline.js';

const meal = {
  seq: 10, ts: '2026-09-30 11:45:03.447', kind: 'event',
  payload: { name: 'lunch_eaten', meal: 'lunch', outcome: 'eaten' },
};
const journal = { seq: 11, ts: '2026-09-30 11:46:00.000', kind: 'text', payload: { s: 'still here' } };
const postcard = { seq: 12, ts: '2026-09-30 11:47:00.000', kind: 'postcard_in', payload: { id: 'card-1' } };
const pages = [
  { ok: true, now: 12, events: [meal, journal], cursors: { next: 11, has_more_forward: true } },
  { ok: true, now: 12, events: [meal, postcard], cursors: { next: 12, has_more_forward: false } },
];
const fetched = await fetchDayEvents({
  rangeUrl: '/api/range.php', date: '2026-09-30',
  fetchImpl: async () => ({ ok: true, json: async () => pages.shift() }),
});
assert.deepEqual(fetched.events.map((event) => event.seq), [10, 11, 12],
  'a repeated page cannot draw the same lunch twice or displace journal/postcard events');
assert.ok(['event', 'text', 'postcard_in', 'postcard_out', 'dream', 'draw'].every((kind) => NARRATIVE_KINDS.includes(kind)),
  'routine events remain in the same chronology as prose, postcards and drawings');
assert.equal(scheduledRoutineLabel(meal.payload), 'lunch came and Cy ate it');
assert.equal(scheduledRoutineLabel({ name: 'lunch_expected', meal: 'lunch', outcome: 'expected' }), '',
  'an expected-only meal never appears as an actual lunch');

const app = await readFile(fileURLToPath(new URL('../public/assets/app.js', import.meta.url)), 'utf8');
assert.match(app, /const routineLabel = scheduledRoutineLabel\(p\);\s*if \(routineLabel\) \{[\s\S]*?pen\.event\(routineLabel, '', ts, 'prison', '', p\);[\s\S]*?return;/,
  'the handwritten center view adds one existing routine event and stops before any generic fallback');
assert.match(app, /case 'postcard_in':/);
assert.match(app, /case 'text':/);
assert.match(app, /const correction = liveDateCorrection\(currentDate, londonToday\(\), \{ bootstrapping, historyMode \}\);/,
  'the live browser date safety net stays connected');
