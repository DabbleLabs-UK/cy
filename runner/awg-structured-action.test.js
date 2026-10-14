import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAwgCandidate, applyAwgCandidate, awgEventToEnvironment, buildAwgProposalFormat,
  reconcileWorldSimulationState,
} from './ambient-world-generator.js';
import {
  runChangedDurableState, runIsGroundedSubstantive, noDurableChangeStreak, awgHealthReport,
} from './awg-health.js';

const AWG_SCHEMA = 'cy.ambient-world-candidate';
const NOW = Date.parse('2026-10-14T12:00:00.000Z');

// A valid officer physical-action EVENT (a headcount in the cell).
function ev(overrides = {}) {
  return {
    schema: AWG_SCHEMA, version: 1, decision: 'EVENT', eventFamily: 'OFFICER_ACTIVITY',
    participants: ['cy', 'sweep'], location: 'cell', occurredAt: new Date(NOW).toISOString(),
    objective: { eventType: 'headcount', summary: 'Mr Sweep ran the count.' },
    objects: [], observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Mr Sweep ran the count.' }],
    informationClaims: [],
    thread: { action: 'NONE', id: null, type: null, summary: null, nextEligibleAt: null },
    action: { actionClass: 'HEADCOUNT', actorId: 'sweep', targetId: null },
    ...overrides,
  };
}
const val = (c) => validateAwgCandidate(c, null, { nowMs: NOW, currentLocation: 'cell', plausibleCastIds: [] });

// ---- schema -----------------------------------------------------------------
test('schema: action is an optional property on EVENT branches (and absent is valid)', () => {
  const fmt = buildAwgProposalFormat(reconcileWorldSimulationState({}), {
    plausibleCastIds: ['bill', 'sweep'], currentLocation: 'cell', droughtActive: false,
  });
  const anEvent = fmt.oneOf.find((b) => b?.properties?.decision?.const === 'EVENT' && b.properties.action);
  assert.ok(anEvent, 'EVENT branches expose an optional action property');
  assert.ok(!anEvent.required.includes('action'), 'action is NOT required (backward compatible)');
  // the non-null alternative requires actionClass + actorId
  const obj = anEvent.properties.action.oneOf.find((a) => a.type === 'object');
  assert.deepEqual(obj.required, ['actionClass', 'actorId']);
});

// ---- validation -------------------------------------------------------------
test('validation: a well-formed officer headcount is accepted', () => {
  const r = val(ev());
  assert.equal(r.valid, true, r.errors.join(','));
  assert.deepEqual(r.candidate.action, { actionClass: 'HEADCOUNT', actorId: 'sweep', targetId: null });
});

test('validation: conversation (SOCIAL_REQUEST) may not carry a physical action', () => {
  const r = val(ev({ eventFamily: 'SOCIAL_REQUEST', objective: { eventType: 'chat', summary: 'Cy and Sweep talk.' } }));
  assert.ok(r.errors.includes('SOCIAL_REQUEST_ACTION_FORBIDDEN'), r.errors.join(','));
});

test('validation: role plausibility - only an officer may perform a headcount', () => {
  const r = val(ev({ participants: ['cy', 'bill'], action: { actionClass: 'HEADCOUNT', actorId: 'bill', targetId: null },
    objective: { eventType: 'headcount', summary: 'Bill ran the count.' } }));
  assert.ok(r.errors.includes('ACTION_ACTOR_ROLE_MISMATCH'), r.errors.join(','));
});

test('validation: location plausibility - a cell search only in the cell', () => {
  const r = val(ev({ location: 'wing',
    action: { actionClass: 'CELL_SEARCH', actorId: 'sweep', targetId: 'cell' },
    objective: { eventType: 'cell_search', summary: 'Mr Sweep turned the cell over.' } }));
  // note: validator runs with currentLocation 'cell' but candidate.location 'wing' -> also IMPOSSIBLE_CY_LOCATION;
  // the action-location check is the one under test:
  assert.ok(r.errors.includes('ACTION_LOCATION_IMPLAUSIBLE'), r.errors.join(','));
});

test('validation: the action actor must be a participant', () => {
  const r = val(ev({ action: { actionClass: 'HEADCOUNT', actorId: 'locke', targetId: null } }));
  assert.ok(r.errors.includes('ACTION_ACTOR_NOT_PARTICIPANT'), r.errors.join(','));
});

test('validation: a non-person location target is allowed; an unknown target is rejected', () => {
  assert.equal(val(ev({ action: { actionClass: 'CELL_SEARCH', actorId: 'sweep', targetId: 'cell' },
    objective: { eventType: 'cell_search', summary: 'Mr Sweep searched the cell.' } })).valid, true);
  assert.ok(val(ev({ action: { actionClass: 'HEADCOUNT', actorId: 'sweep', targetId: 'nowhere' } }))
    .errors.includes('INVALID_ACTION_TARGET'));
});

// ---- materialisation --------------------------------------------------------
test('materialisation: actor/target/actionClass are explicit and ground to an archetype', () => {
  const validation = val(ev());
  const applied = applyAwgCandidate(null, validation, { makeId: (p) => `${p}-1`, acceptedAt: ev().occurredAt });
  assert.equal(applied.event.actorId, 'sweep', 'actor is explicit, not positional');
  assert.equal(applied.event.actionClass, 'HEADCOUNT');
  applied.validationCandidate = validation.candidate;
  const envm = awgEventToEnvironment(applied);
  assert.equal(envm.archetypeId, 'calm_routine', 'HEADCOUNT grounds to the calm_routine archetype');
  assert.equal(envm.world.participants.actor, 'sweep');
  assert.equal(envm.world.situation.agency, 'officer');
  assert.equal(envm.world.situation.action_class, 'HEADCOUNT');
  // no invented consequence: no object, no thread change
  assert.equal(applied.changes.length, 0);
});

// ---- backward compatibility -------------------------------------------------
test('backward compatibility: an action-less proposal validates and materialises as before', () => {
  const noAction = ev({ eventFamily: 'SOCIAL_REQUEST', action: undefined,
    participants: ['cy', 'bill'], objective: { eventType: 'chat', summary: 'Cy and Bill talk.' },
    observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy and Bill talk.' }] });
  const r = val(noAction);
  assert.equal(r.valid, true, r.errors.join(','));
  assert.equal(r.candidate.action, null, 'missing action normalises to null');
  const applied = applyAwgCandidate(null, r, { makeId: (p) => `${p}-1`, acceptedAt: noAction.occurredAt });
  assert.equal(applied.event.actionClass, null);
  assert.equal(applied.event.actorId, 'cy', 'falls back to positional actor derivation');
  applied.validationCandidate = r.candidate;
  assert.equal(awgEventToEnvironment(applied).archetypeId, 'ambient_world_event', 'no action -> generic archetype, unchanged');
});

// ---- health / drought distinction ------------------------------------------
test('health: a structured action is grounded-substantive but NOT a durable change', () => {
  const headcountRun = { validationStatus: 'ACCEPTED', threadChanges: [],
    candidateOutput: { eventFamily: 'OFFICER_ACTIVITY', participants: ['cy', 'sweep'], objects: [], action: { actionClass: 'HEADCOUNT' } } };
  const openRun = { validationStatus: 'ACCEPTED', threadChanges: [{ action: 'OPEN', threadId: 't1' }],
    candidateOutput: { eventFamily: 'SOCIAL_REQUEST', participants: ['cy', 'bill'], objects: [] } };
  const talkRun = { validationStatus: 'ACCEPTED', threadChanges: [],
    candidateOutput: { eventFamily: 'SOCIAL_REQUEST', participants: ['cy', 'bill'], objects: [] } };

  assert.equal(runChangedDurableState(headcountRun), false, 'headcount changes no persistent state');
  assert.equal(runIsGroundedSubstantive(headcountRun), true, 'headcount is substantive');
  assert.equal(runChangedDurableState(openRun), true);
  assert.equal(runIsGroundedSubstantive(openRun), true);
  assert.equal(runChangedDurableState(talkRun), false);
  assert.equal(runIsGroundedSubstantive(talkRun), false, 'pure conversation is neither');

  // headcounts do NOT reset the no-durable-change streak (drought still nudges to durable)
  const state = { recentRuns: [openRun, headcountRun, headcountRun] }; // newest last
  assert.equal(noDurableChangeStreak(state), 2, 'two non-durable headcounts since the last durable change');

  const report = awgHealthReport(state);
  assert.equal(report.durableChanges, 1);
  assert.equal(report.groundedSubstantive, 3, 'all three accepted runs are grounded-substantive');
  assert.equal(report.actionBearingAccepted, 2);
});
