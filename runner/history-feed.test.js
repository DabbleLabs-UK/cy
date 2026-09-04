import assert from 'node:assert/strict';
import { fetchDayEvents, fetchDaySnapshot } from '../public/assets/history-feed.js';

const calls = [];
const pages = [
  {
    ok: true,
    now: 99,
    events: [{ seq: 10, kind: 'text' }, { seq: 11, kind: 'mode' }],
    cursors: { next: 11, has_more_forward: true },
  },
  {
    ok: true,
    now: 100,
    events: [{ seq: 11, kind: 'mode' }, { seq: 12, kind: 'text' }],
    cursors: { next: 12, has_more_forward: false },
  },
];
const fetchImpl = async (url) => {
  calls.push(new URL(url, 'https://cy.invalid'));
  const data = pages.shift();
  return { ok: true, json: async () => data };
};

const day = await fetchDayEvents({
  rangeUrl: '/api/range.php',
  date: '2026-09-04',
  kinds: ['text', 'mode'],
  fetchImpl,
  limit: 2,
});
assert.deepEqual(day.events.map((e) => e.seq), [10, 11, 12]);
assert.equal(day.head, 100);
assert.equal(day.pages, 2);
assert.equal(calls[0].searchParams.get('date'), '2026-09-04');
assert.equal(calls[0].searchParams.get('after'), '0');
assert.equal(calls[1].searchParams.get('after'), '11');
assert.equal(calls[0].searchParams.get('kinds'), 'text,mode');

const snapshotCalls = [];
const snapshot = await fetchDaySnapshot({
  rangeUrl: '/api/range.php',
  date: '2026-09-04',
  head: 200,
  kinds: ['vitals'],
  fetchImpl: async (url) => {
    snapshotCalls.push(new URL(url, 'https://cy.invalid'));
    return {
      ok: true,
      json: async () => ({ ok: true, now: 201, events: [{ seq: 150, kind: 'vitals' }] }),
    };
  },
});
assert.deepEqual(snapshot.events.map((e) => e.seq), [150]);
assert.equal(snapshotCalls[0].searchParams.get('date'), '2026-09-04');
assert.equal(snapshotCalls[0].searchParams.get('before'), '201');

await assert.rejects(
  () => fetchDayEvents({ rangeUrl: '/x', date: 'not-a-day', fetchImpl }),
  /YYYY-MM-DD/,
);

console.log('history-feed.test.js: all checks passed');
