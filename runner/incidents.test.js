import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeIncident,
  makeObjectTransitionIncident,
  incidentsDirective,
  reconcileLedger,
  reconcileObjectIncidentThreads,
  unresolvedThreads,
  pushIncident,
} from './incidents.js';
import { buildPrompt, JOURNAL_CONTINUATION_CHARS } from './prompt.js';

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
