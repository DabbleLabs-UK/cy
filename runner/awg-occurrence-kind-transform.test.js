import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAwgProposalFormat, AWG_EVENT_FAMILIES } from './ambient-world-generator.js';
import {
  transformOccurrenceKind, OCCURRENCE_KIND_SOCIAL, OCCURRENCE_KIND_OTHER,
} from './awg-occurrence-kind-transform.js';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');

// A production-faithful schema: no open threads, two other cast members present,
// not under drought. Contains the family-less NO_EVENT member, two all-family
// (enum[8]) base EVENT branches, and the single-const open-thread branches.
function builtSchema(opts = {}) {
  return buildAwgProposalFormat(
    { threads: [], objects: [] },
    {
      plausibleCastIds: ['bill', 'sweep'], currentLocation: 'cell', nowMs: NOW,
      droughtActive: false, ...opts,
    },
  );
}

const familyOf = (member) => member.properties && member.properties.eventFamily;
const allowedOf = (member) => {
  const ef = familyOf(member);
  if (!ef) return null;
  if (Object.prototype.hasOwnProperty.call(ef, 'const')) return [ef.const];
  if (Array.isArray(ef.enum)) return ef.enum.slice();
  return null;
};
const occOf = (member) => member.properties
  && member.properties.occurrenceKind && member.properties.occurrenceKind.const;
const isNoEvent = (member) => member.properties
  && member.properties.decision && member.properties.decision.const === 'NO_EVENT';

// ---- NO_EVENT untouched -----------------------------------------------------
test('NO_EVENT member is passed through byte/structurally identical', () => {
  const input = builtSchema();
  const before = input.oneOf.find(isNoEvent);
  assert.ok(before, 'fixture must contain a NO_EVENT member');
  const out = transformOccurrenceKind(input);
  const after = out.oneOf.find(isNoEvent);
  assert.ok(after, 'NO_EVENT must survive the transform');
  // Deep-equal and no occurrenceKind introduced.
  assert.deepEqual(after, before);
  assert.equal(Object.prototype.hasOwnProperty.call(after.properties, 'occurrenceKind'), false);
});

// ---- all original families remain reachable ---------------------------------
test('every original event family is still reachable after the transform', () => {
  const out = transformOccurrenceKind(builtSchema());
  const reachable = new Set();
  for (const member of out.oneOf) {
    for (const family of (allowedOf(member) || [])) reachable.add(family);
  }
  for (const family of AWG_EVENT_FAMILIES) {
    assert.ok(reachable.has(family), `family ${family} must remain reachable`);
  }
});

// ---- only the mixed all-family branch is split ------------------------------
test('only the mixed (SOCIAL_REQUEST + others) branches are split; count math holds', () => {
  const input = builtSchema();
  const mixedBefore = input.oneOf.filter((m) => {
    const a = allowedOf(m);
    return a && a.includes('SOCIAL_REQUEST') && a.some((f) => f !== 'SOCIAL_REQUEST');
  });
  assert.ok(mixedBefore.length > 0, 'fixture must contain at least one mixed branch');

  const out = transformOccurrenceKind(input);
  // Each mixed branch becomes exactly two members (SOCIAL + OTHER); every other
  // member maps 1:1. So the member count grows by exactly the number of mixed branches.
  assert.equal(out.oneOf.length, input.oneOf.length + mixedBefore.length);

  // The split products: a SOCIAL half pinned to const SOCIAL_REQUEST, and an OTHER
  // half whose enum is exactly the original family set minus SOCIAL_REQUEST.
  for (const mixed of mixedBefore) {
    const original = allowedOf(mixed);
    const expectedOther = original.filter((f) => f !== 'SOCIAL_REQUEST');
    const socialHalves = out.oneOf.filter((m) => occOf(m) === OCCURRENCE_KIND_SOCIAL
      && JSON.stringify(allowedOf(m)) === JSON.stringify(['SOCIAL_REQUEST']));
    const otherHalves = out.oneOf.filter((m) => occOf(m) === OCCURRENCE_KIND_OTHER
      && JSON.stringify(allowedOf(m)) === JSON.stringify(expectedOther));
    assert.ok(socialHalves.length > 0, 'split must yield a SOCIAL_REQUEST half');
    assert.ok(otherHalves.length > 0, 'split must yield an OTHER half with the exact remainder');
  }

  // No surviving member mixes SOCIAL_REQUEST with other families.
  for (const member of out.oneOf) {
    const a = allowedOf(member);
    if (a && a.includes('SOCIAL_REQUEST')) {
      assert.deepEqual(a, ['SOCIAL_REQUEST'], 'SOCIAL_REQUEST must never coexist with others post-transform');
    }
  }
});

// ---- no family merged or reclassified ---------------------------------------
test('no family is merged or reclassified; occurrenceKind matches eventFamily everywhere', () => {
  const out = transformOccurrenceKind(builtSchema());
  for (const member of out.oneOf) {
    if (isNoEvent(member)) continue;
    const allowed = allowedOf(member);
    const occ = occOf(member);
    if (allowed == null) continue;
    if (allowed.length === 1 && allowed[0] === 'SOCIAL_REQUEST') {
      assert.equal(occ, OCCURRENCE_KIND_SOCIAL);
    } else {
      // Any non-SOCIAL-only branch must be OTHER and must contain no SOCIAL_REQUEST.
      assert.equal(occ, OCCURRENCE_KIND_OTHER);
      assert.ok(!allowed.includes('SOCIAL_REQUEST'));
    }
    // Families themselves are preserved (never renamed to anything outside the vocab).
    for (const family of allowed) {
      assert.ok(AWG_EVENT_FAMILIES.includes(family), `unexpected family ${family}`);
    }
  }
});

// ---- occurrenceKind is required ---------------------------------------------
test('occurrenceKind is a required property on every transformed event branch', () => {
  const out = transformOccurrenceKind(builtSchema());
  for (const member of out.oneOf) {
    if (isNoEvent(member)) continue;
    if (!familyOf(member)) continue;
    assert.ok(Array.isArray(member.required), 'event branch must have a required array');
    assert.ok(member.required.includes('occurrenceKind'), 'occurrenceKind must be required');
    assert.ok(member.properties.occurrenceKind, 'occurrenceKind property must exist');
    assert.ok(
      Object.prototype.hasOwnProperty.call(member.properties.occurrenceKind, 'const'),
      'occurrenceKind must be a const discriminator',
    );
  }
});

// ---- property insertion order: decision -> occurrenceKind -> eventFamily -----
test('property insertion order is decision, then occurrenceKind, then eventFamily', () => {
  const out = transformOccurrenceKind(builtSchema());
  for (const member of out.oneOf) {
    if (isNoEvent(member)) continue;
    if (!familyOf(member)) continue;
    const keys = Object.keys(member.properties);
    const di = keys.indexOf('decision');
    const oi = keys.indexOf('occurrenceKind');
    const ei = keys.indexOf('eventFamily');
    assert.ok(di >= 0 && oi >= 0 && ei >= 0, 'decision, occurrenceKind, eventFamily all present');
    assert.equal(oi, di + 1, 'occurrenceKind must be immediately after decision');
    assert.ok(oi < ei, 'occurrenceKind must come before eventFamily');
    // required also places occurrenceKind right after decision.
    const rd = member.required.indexOf('decision');
    const ro = member.required.indexOf('occurrenceKind');
    assert.equal(ro, rd + 1, 'required: occurrenceKind immediately after decision');
  }
});

// ---- input schema is not mutated --------------------------------------------
test('the input schema is not mutated by the transform', () => {
  const input = builtSchema();
  const snapshot = structuredClone(input);
  const out = transformOccurrenceKind(input);
  assert.deepEqual(input, snapshot, 'input schema must be untouched');
  assert.notEqual(out, input, 'a fresh schema object must be returned');
  // And the output genuinely differs (sanity: occurrenceKind was added somewhere).
  assert.ok(JSON.stringify(out).includes('occurrenceKind'));
});

// ---- SOCIAL_REQUEST remains reachable both pinned and split -----------------
test('SOCIAL_REQUEST stays reachable via both its pinned branch and the split half', () => {
  const out = transformOccurrenceKind(builtSchema());
  const socialMembers = out.oneOf.filter((m) => {
    const a = allowedOf(m);
    return a && a.length === 1 && a[0] === 'SOCIAL_REQUEST';
  });
  assert.ok(socialMembers.length >= 1, 'SOCIAL_REQUEST must be reachable');
  for (const m of socialMembers) assert.equal(occOf(m), OCCURRENCE_KIND_SOCIAL);
});
