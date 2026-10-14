import assert from 'node:assert/strict';
import test from 'node:test';

import {
  awgHealthReport,
  noDurableChangeStreak,
  runChangedDurableState,
} from './awg-health.js';
import {
  awgDroughtActive,
  buildAwgProposalFormat,
  reconcileWorldSimulationState,
} from './ambient-world-generator.js';

// A trivial accepted run: thread NONE, no object, self-resolving - the attractor.
function trivialRun(participants = ['cy', 'bill']) {
  return {
    validationStatus: 'ACCEPTED',
    threadChanges: [],
    candidateOutput: {
      decision: 'EVENT', eventFamily: 'SOCIAL_REQUEST', participants,
      objects: [], thread: { action: 'NONE' }, resolved: true,
    },
  };
}

function threadOpenRun(participants = ['cy', 'fisher']) {
  return {
    validationStatus: 'ACCEPTED',
    threadChanges: [{ action: 'OPEN', threadId: 'thread-x' }],
    candidateOutput: {
      decision: 'EVENT', eventFamily: 'OBJECT_TRANSFER', participants,
      objects: [], thread: { action: 'OPEN' }, resolved: false,
    },
  };
}

function objectRun(participants = ['cy', 'fisher']) {
  return {
    validationStatus: 'ACCEPTED',
    threadChanges: [],
    candidateOutput: {
      decision: 'EVENT', eventFamily: 'OBJECT_TRANSFER', participants,
      objects: [{ type: 'note' }], thread: { action: 'NONE' }, resolved: true,
    },
  };
}

test('runChangedDurableState: trivial is not durable, thread/object are', () => {
  assert.equal(runChangedDurableState(trivialRun()), false);
  assert.equal(runChangedDurableState(threadOpenRun()), true);
  assert.equal(runChangedDurableState(objectRun()), true);
  assert.equal(runChangedDurableState({ validationStatus: 'REJECTED' }), false);
  assert.equal(runChangedDurableState({ validationStatus: 'ACCEPTED_NO_EVENT' }), false);
});

test('noDurableChangeStreak counts trailing trivial accepts, ignoring non-accepts', () => {
  const runs = [
    objectRun(),
    { validationStatus: 'REJECTED' },
    trivialRun(),
    { validationStatus: 'ACCEPTED_NO_EVENT' },
    { validationStatus: 'NOT_RUN' },
    trivialRun(),
    trivialRun(),
  ];
  // Three trailing trivial accepts (REJECTED / NO_EVENT / NOT_RUN are transparent),
  // broken by the durable objectRun at the head.
  assert.equal(noDurableChangeStreak({ recentRuns: runs }), 3);
});

test('noDurableChangeStreak stops at the most recent durable change', () => {
  const runs = [trivialRun(), trivialRun(), threadOpenRun(), trivialRun()];
  assert.equal(noDurableChangeStreak({ recentRuns: runs }), 1);
});

test('a fully collapsed window reports zero durable rate and full concentration', () => {
  const runs = Array.from({ length: 10 }, () => trivialRun());
  const report = awgHealthReport({ recentRuns: runs });
  assert.equal(report.accepted, 10);
  assert.equal(report.durableChangeRate, 0);
  assert.equal(report.objectBearingAccepted, 0);
  assert.equal(report.familyConcentration, 1);
  assert.equal(report.topFamily, 'SOCIAL_REQUEST');
  assert.equal(report.threadActionCounts.NONE, 10);
  assert.equal(report.noDurableChangeStreak, 10);
});

test('awgDroughtActive respects threshold and enabled flag', () => {
  const dry = { recentRuns: Array.from({ length: 4 }, () => trivialRun()) };
  const wet = { recentRuns: [threadOpenRun(), trivialRun()] };
  assert.equal(awgDroughtActive(dry, { threshold: 4 }), true);
  assert.equal(awgDroughtActive(dry, { threshold: 5 }), false);
  assert.equal(awgDroughtActive(wet, { threshold: 1 }), true); // one trailing trivial
  assert.equal(awgDroughtActive(wet, { threshold: 2 }), false);
  assert.equal(awgDroughtActive(dry, { enabled: false, threshold: 1 }), false);
});

// The gate withholds ONLY the trivial branch: a thread-NONE EVENT must carry an
// object under drought, while thread-opening branches, continuations and
// NO_EVENT remain untouched.
function eventBranches(format) {
  return format.oneOf.filter((b) => b?.properties?.decision?.const === 'EVENT');
}
function noneBranches(bs) {
  return bs.filter((b) => b?.properties?.thread?.properties?.action?.const === 'NONE');
}
function openBranches(bs) {
  return bs.filter((b) => b?.properties?.thread?.properties?.action?.const === 'OPEN');
}

// A NONE branch is "action-required" if it mandates a non-null structured action.
const requiresAction = (b) => Array.isArray(b.required) && b.required.includes('action')
  && b.properties.action && b.properties.action.type === 'object';
const requiresObject = (b) => b.properties.objects && b.properties.objects.minItems === 1;

test('drought makes thread-NONE EVENT branches substantive: object-bearing OR action-bearing, never empty', () => {
  const state = reconcileWorldSimulationState({});
  const opts = { plausibleCastIds: ['bill', 'fisher'], currentLocation: 'cell' };

  const base = buildAwgProposalFormat(state, { ...opts, droughtActive: false });
  const baseNone = noneBranches(eventBranches(base));
  assert.ok(baseNone.length > 0, 'baseline has thread-NONE EVENT branches');
  for (const b of baseNone) {
    assert.equal(requiresObject(b), false, 'baseline NONE branch does not require objects (conversation allowed)');
    assert.equal(requiresAction(b), false, 'baseline NONE branch does not require an action');
  }

  const dry = buildAwgProposalFormat(state, { ...opts, droughtActive: true });
  const dryEvents = eventBranches(dry);
  const dryNone = noneBranches(dryEvents);
  const dryOpen = openBranches(dryEvents);
  assert.ok(dryNone.length > 0 && dryOpen.length > 0, 'both NONE and OPEN branches exist under drought');
  // every drought NONE branch is substantive; none is empty (neither object nor action)
  for (const b of dryNone) {
    assert.ok(requiresObject(b) || requiresAction(b), 'drought NONE branch must require an object OR a structured action');
    assert.ok(!(requiresObject(b) && requiresAction(b)), 'a drought NONE variant requires exactly one of object/action');
  }
  // and BOTH kinds are offered (object-bearing and action-bearing escapes exist)
  assert.ok(dryNone.some(requiresObject), 'an object-bearing drought NONE branch exists');
  assert.ok(dryNone.some(requiresAction), 'an action-bearing drought NONE branch exists');
  for (const b of dryOpen) {
    assert.equal(requiresObject(b), false, 'drought leaves OPEN branches free');
  }
  // NO_EVENT remains a legal choice under drought.
  assert.ok(dry.oneOf.some((b) => b?.properties?.decision?.const === 'NO_EVENT'));
});
