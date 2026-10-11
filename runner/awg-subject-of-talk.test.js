import test from 'node:test';
import assert from 'node:assert/strict';
import { isSubjectOfTalk, validateAwgCandidate, AWG_SCHEMA } from './ambient-world-generator.js';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');

// A plain SOCIAL_REQUEST event with a single Cy observation and no thread/object.
function social({ participants, summary, obsSummary, claims = [] }) {
  return {
    schema: AWG_SCHEMA, version: 1, decision: 'EVENT', eventFamily: 'SOCIAL_REQUEST',
    participants, location: 'cell', occurredAt: new Date(NOW).toISOString(),
    objective: { eventType: 'conversation', summary },
    objects: [],
    observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: obsSummary }],
    informationClaims: claims,
    resolved: false,
    thread: { action: 'NONE', id: null, type: null, summary: null, nextEligibleAt: null },
    continuationOf: null,
  };
}
const errs = (c) => validateAwgCandidate(c, null, { nowMs: NOW, currentLocation: 'cell' }).errors;

// ---- direct helper semantics -------------------------------------------------
test('isSubjectOfTalk: absent subjects of talk are recognised, present/addressed actors are not', () => {
  // subjects of talk (absent) -> true
  assert.equal(isSubjectOfTalk('Bill tells Cy about ', "'s recent activity"), true); // about X
  assert.equal(isSubjectOfTalk('I heard Bill talking about Fisher having a conversation with ', ''), true); // nested/reported
  assert.equal(isSubjectOfTalk('Bill and I discuss Mr ', "' schedule"), true); // discuss + title
  assert.equal(isSubjectOfTalk('I noticed Bill asking about Mr. ', ''), true); // about + titled
  assert.equal(isSubjectOfTalk('discuss their experience with Mr ', '.'), true); // discuss...with + title
  assert.equal(isSubjectOfTalk('there was news of ', "'s transfer"), true); // news of X
  // present / addressed / acting -> false
  assert.equal(isSubjectOfTalk('I start asking ', ' about Fisher'), false); // addressed (asked)
  assert.equal(isSubjectOfTalk('just asked ', ' about Fisher'), false); // addressed
  assert.equal(isSubjectOfTalk('Bill sat with ', ' on association'), false); // present
  assert.equal(isSubjectOfTalk('mentioned the weather and ', ' punched Cy'), false); // agent of present action
  assert.equal(isSubjectOfTalk('Cy spoke to ', ' by the gate'), false); // addressed
});

// ---- the five audited production rejections, reconstructed --------------------
test('fixture 1 (Fisher/Locke discussed, not present) no longer false-rejects', () => {
  const e = errs(social({
    participants: ['cy', 'bill'],
    summary: "Bill tells Cy about Fisher's recent suspicious activity",
    obsSummary: 'I heard Bill talking about Fisher having an unusual conversation with Locke',
  }));
  assert.ok(!e.includes('NAMED_CAST_NOT_PARTICIPANT'), e.join(','));
});

test('fixture 2 (Mr Keyes discussed) no longer false-rejects', () => {
  const e = errs(social({
    participants: ['cy', 'bill'],
    summary: "Bill and I discuss Mr Keyes' schedule and the guard's mood.",
    obsSummary: 'I noticed Bill asking about Mr. Keyes',
  }));
  assert.ok(!e.includes('NAMED_CAST_NOT_PARTICIPANT'), e.join(','));
});

test('fixture 5 (Mr Keyes as topic of discussion) no longer false-rejects', () => {
  const e = errs(social({
    participants: ['cy', 'bill'],
    summary: 'Cy asks Bill to discuss their experience with Mr Keyes.',
    obsSummary: 'Bill looks at Cy with interest',
  }));
  assert.ok(!e.includes('NAMED_CAST_NOT_PARTICIPANT'), e.join(','));
});

test('fixture 3 (impossible root speaker) still rejected via the speaker check', () => {
  const e = errs(social({
    participants: ['cy', 'bill'],
    summary: 'Cy tries to start conversation about fisher and bailey with Bill',
    obsSummary: 'Bill is already busy',
    claims: [{ speakerId: 'root', content: 'No comment.', truthStatus: 'TRUE' }],
  }));
  assert.ok(e.includes('SPEAKER_NOT_PARTICIPANT'), e.join(','));
  // and the absent subjects of talk do not additionally trip the name check
  assert.ok(!e.includes('NAMED_CAST_NOT_PARTICIPANT'), e.join(','));
});

test('fixture 4 (Bailey addressed as present but omitted) still rejected', () => {
  const e = errs(social({
    participants: ['cy'], // Bailey is addressed ("asked Bailey") yet not a participant
    summary: "I start asking bailey about Fisher's whereabouts.",
    obsSummary: 'just asked Bailey about Fisher',
  }));
  assert.ok(e.includes('NAMED_CAST_NOT_PARTICIPANT'), e.join(','));
});

// ---- safety: a present non-participant actor is still rejected ----------------
test('a directly-acting non-participant is still rejected (no presence weakening)', () => {
  const e = errs(social({
    participants: ['cy', 'bill'],
    summary: 'Bill and Cy talk; then Fisher shoved Cy on the landing',
    obsSummary: 'Fisher shoved Cy',
  }));
  assert.ok(e.includes('NAMED_CAST_NOT_PARTICIPANT'), e.join(','));
});
