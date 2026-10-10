import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeIncident,
  makeObjectTransitionIncident,
  incidentsDirective,
  selectJournalTurn,
  reconcileLedger,
  reconcileObjectIncidentThreads,
  unresolvedThreads,
  pushIncident,
} from './incidents.js';
import { buildPrompt, buildDirectives, turnDirective, JOURNAL_CONTINUATION_CHARS } from './prompt.js';

// Local timestamp in the runner's tsNow() shape ("YYYY-MM-DD HH:MM:SS.mmm"),
// so Date.parse() treats it as local time exactly as production incidents do.
function localTs(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const oldObject = {
  id: 'object-photo', type: 'photo', status: 'ACTIVE', holderId: 'cy', location: 'cell',
  revision: 1, transitionId: '11111111-1111-4111-8111-111111111111',
};
const confiscated = {
  ...oldObject, status: 'CONFISCATED', holderId: 'locke', location: 'officer_desk',
  revision: 2, transitionId: '22222222-2222-4222-8222-222222222222',
};
const returned = {
  ...oldObject, revision: 3, transitionId: '33333333-3333-4333-8333-333333333333',
};

test('ambient texture and an ordinary search cannot establish object loss', () => {
  const ambient = makeIncident('texture', { phase: 'lights_out', rnd: () => 0.24 });
  assert.equal(ambient.evidenceClass, 'AMBIENT_TEXTURE');
  assert.equal(ambient.open, undefined);
  assert.doesNotMatch(JSON.stringify(ambient), /photo is not where|threadKind/);

  const search = makeIncident('officer', {
    actorKey: 'locke', evType: 'search', slight: 'searched the cell',
    environmentEventId: 'search-event-1', rnd: () => 0,
  });
  assert.equal(search.evidenceClass, 'OBSERVED_EVENT');
  assert.equal(search.open, undefined);
  assert.equal(search.threadKind, undefined);
  assert.deepEqual(unresolvedThreads([ambient, search]), []);
});

test('only a revisioned, observed object transition establishes custody', () => {
  const claim = makeObjectTransitionIncident({
    before: oldObject, after: confiscated, sourceEventId: 'event-search-1',
    actor: 'Mr Locke', observedByCy: true,
  });
  assert.equal(claim.evidenceClass, 'WORLD_TRANSITION');
  assert.equal(claim.objectEvidence.id, oldObject.id);
  assert.equal(claim.objectEvidence.transitionId, confiscated.transitionId);
  assert.equal(claim.sourceEventId, 'event-search-1');
  assert.equal(claim.threadKind, 'object_custody');
  assert.deepEqual(unresolvedThreads([claim], { objects: [confiscated] }), [
    'the confiscated photo remains in officer custody',
  ]);
  assert.equal(makeObjectTransitionIncident({
    before: oldObject, after: confiscated, sourceEventId: 'event-search-1',
    observedByCy: false,
  }), null);
  assert.equal(makeObjectTransitionIncident({
    before: oldObject, after: oldObject, sourceEventId: 'event-search-1',
    observedByCy: true,
  }), null);
  assert.equal(makeObjectTransitionIncident({
    before: oldObject, after: { ...confiscated, revision: 1 },
    sourceEventId: 'event-search-1', observedByCy: true,
  }), null);
});

test('distinct object transitions never collapse by matching prose', () => {
  const secondBefore = { ...oldObject, id: 'object-photo-2' };
  const secondAfter = { ...confiscated, id: 'object-photo-2',
    transitionId: '44444444-4444-4444-8444-444444444444' };
  const first = makeObjectTransitionIncident({
    before: oldObject, after: confiscated, sourceEventId: 'event-search-1',
    actor: 'Mr Locke', observedByCy: true,
  });
  const second = makeObjectTransitionIncident({
    before: secondBefore, after: secondAfter, sourceEventId: 'event-search-2',
    actor: 'Mr Locke', observedByCy: true,
  });
  const ledger = [];
  pushIncident(ledger, first);
  pushIncident(ledger, second);
  pushIncident(ledger, second);
  assert.equal(ledger.length, 2);
});

test('old Sweep/photo and Locke/moved claims remain historical but never factual prompt evidence', () => {
  const ledger = reconcileLedger([
    {
      actor: 'Mr Sweep', verb: 'been through the cell', object: '',
      detail: 'the photo is not where you left it', open: true, threadKind: 'taken',
      subject: 'Sweep', resolved: false,
    },
    {
      actor: 'Mr Locke', verb: 'turned the cell over', object: '',
      detail: 'left it worse', open: true, threadKind: 'taken',
      subject: 'Locke', resolved: false,
    },
  ]);
  assert.equal(ledger[0].evidenceClass, 'LEGACY_UNVERIFIED');
  assert.deepEqual(unresolvedThreads(ledger, { objects: [oldObject] }), []);
  const prompt = incidentsDirective(ledger, { objects: [oldObject], rnd: () => 0 });
  assert.match(prompt, /unverified concern about belongings/);
  assert.doesNotMatch(prompt, /photo is not where|whatever .* moved|STILL OPEN/);
  assert.equal(ledger[0].resolved, false); // rendering never rewrites history
});

test('ambiguous observations stay usable without being promoted to object fact', () => {
  const observed = makeIncident('wing', { line: 'a shout on the landing' });
  const ambient = makeIncident('environment', { text: 'someone said an item was gone' });
  const prompt = incidentsDirective([observed, ambient], { rnd: () => 0 });
  assert.match(prompt, /unverified impression: a shout on the landing/);
  assert.match(prompt, /unverified impression: someone said an item was gone/);
  assert.doesNotMatch(prompt, /verified world transition|STILL OPEN/);
});

test('journal prompt separates subjective continuation from labelled incident evidence', () => {
  const observed = makeIncident('wing', { line: 'a shout on the landing' });
  const claim = makeObjectTransitionIncident({
    before: oldObject, after: confiscated, sourceEventId: 'event-search-1',
    actor: 'Mr Locke', observedByCy: true,
  });
  const prompt = buildPrompt('i worried someone moved my photo', 'journal', null,
    incidentsDirective([observed, claim], { objects: [confiscated], rnd: () => 0 }));
  assert.match(prompt, /i worried someone moved my photo/);
  assert.match(prompt, /unverified impression: a shout on the landing/);
  assert.match(prompt, /verified world transition: Mr Locke confiscated photo/);
  assert.doesNotMatch(prompt, /observed by cy:.*a shout on the landing/);
  assert.equal(JOURNAL_CONTINUATION_CHARS, 520);
});

test('current world object overrides and resolves a stale custody thread', () => {
  const claim = makeObjectTransitionIncident({
    before: oldObject, after: confiscated, sourceEventId: 'event-search-1',
    actor: 'Mr Locke', observedByCy: true,
  });
  const unrelated = makeIncident('texture', { phase: 'lights_out', rnd: () => 0.99 });
  const ledger = [claim, unrelated];
  assert.deepEqual(unresolvedThreads(ledger, { objects: [returned] }), []);
  assert.equal(reconcileObjectIncidentThreads(ledger, [returned]), 1);
  assert.equal(claim.resolved, true);
  assert.equal(unrelated.resolved, false);
  assert.equal(reconcileObjectIncidentThreads(ledger, [returned]), 0);
  assert.equal(returned.status, 'ACTIVE');
  assert.match(incidentsDirective(ledger, { objects: [returned], rnd: () => 0 }),
    /verified world transition: Mr Locke confiscated photo/);
});

// ---- waking-journal development steer (selectJournalTurn / turnDirective) -----
// Structural anti-recurrence: orient the next entry on what has happened SINCE the
// last one, from real world timing - not a phrase ban.

test('selectJournalTurn surfaces a fresh incident filed since the last entry', () => {
  const now = Date.now();
  const lastJournalAtMs = now - 120000; // wrote 2 min ago
  const ledger = [
    { ...makeIncident('trivial', { sub: 'no_eggs', rnd: () => 0 }), ts: localTs(now - 300000) }, // stale (before last entry)
    { ...makeIncident('officer', { actorKey: 'keyes', slight: 'pulled you out', rnd: () => 0 }), ts: localTs(now - 10000) }, // fresh
  ];
  const turn = selectJournalTurn(ledger, { lastJournalAtMs, lastIncidentMs: now - 10000 });
  assert.equal(turn.nothingNew, false);
  assert.ok(turn.freshLine && /keyes/i.test(turn.freshLine), 'fresh officer incident is surfaced, not the stale eggs one');
  assert.doesNotMatch(turn.freshLine, /no eggs/i);
});

test('selectJournalTurn reports nothing-new when no incident has occurred since the last entry', () => {
  const now = Date.now();
  const lastJournalAtMs = now - 60000;
  const ledger = [
    { ...makeIncident('trivial', { sub: 'cold_tea', rnd: () => 0 }), ts: localTs(now - 300000) }, // older than last entry
  ];
  const turn = selectJournalTurn(ledger, { lastJournalAtMs, lastIncidentMs: now - 300000 });
  assert.equal(turn.freshLine, '');
  assert.equal(turn.nothingNew, true);
});

test('selectJournalTurn gives no steer when something happened but is not in the ledger window (ordinary continuity)', () => {
  const now = Date.now();
  const lastJournalAtMs = now - 60000;
  // lastIncidentMs is newer than the last entry, but no ledger row is newer (rotated out):
  const ledger = [{ ...makeIncident('texture', { rnd: () => 0 }), ts: localTs(now - 300000) }];
  const turn = selectJournalTurn(ledger, { lastJournalAtMs, lastIncidentMs: now - 5000 });
  assert.equal(turn.freshLine, '');
  assert.equal(turn.nothingNew, false, 'no false "nothing new" when the incident clock moved');
});

test('selectJournalTurn prefers an open unresolved thread over a newer non-open incident', () => {
  const now = Date.now();
  const lastJournalAtMs = now - 120000;
  const refusal = makeIncident('officer', { actorKey: 'locke', slight: 'knocked you back', evType: 'refusal', rnd: () => 0 });
  assert.equal(refusal.open, true); // guard: this builder yields an open 'owed' thread
  const ledger = [
    { ...refusal, ts: localTs(now - 20000) }, // open thread, older
    { ...makeIncident('wing', { line: 'a door went heavy on the 2s' }), ts: localTs(now - 10000) }, // newest, never open
  ];
  const turn = selectJournalTurn(ledger, { lastJournalAtMs, lastIncidentMs: now - 10000 });
  assert.ok(turn.freshLine && /locke/i.test(turn.freshLine),
    'the open officer thread outranks a newer non-open incident');
});

test('turnDirective wording: fresh offers a new one-thing; nothing-new steers off restatement; otherwise empty', () => {
  assert.match(turnDirective({ freshLine: 'Keyes pulled you out' }),
    /NEW SINCE YOU LAST WROTE: Keyes pulled you out.*let this be the one thing/s);
  assert.match(turnDirective({ nothingNew: true }), /nothing new since you last wrote/);
  assert.match(turnDirective({ nothingNew: true }), /ONE real thing in the cell/);
  assert.equal(turnDirective({}), '');
});

test('buildDirectives folds the steer into the WAKING journal only, leaving ONE_SUBJECT and voice intact', () => {
  const v = { recentOpeners: [] };
  const withFresh = buildDirectives(v, 'journal', { turn: turnDirective({ freshLine: 'the meds trolley went by' }) });
  assert.match(withFresh, /meds trolley went by/);
  assert.match(withFresh, /ONE THING/, 'ONE_SUBJECT coherence rule is still present');
  // Non-journal modes never carry the steer even if a turn string is passed.
  const sleep = buildDirectives(v, 'sleep', { turn: 'should not appear' });
  assert.doesNotMatch(sleep, /should not appear/);
});
