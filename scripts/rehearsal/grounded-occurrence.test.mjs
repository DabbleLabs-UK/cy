import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildAffordancePacket, buildStage2Request, checkSelection, evaluateStage2,
  fingerprint, preparePrototype, productionSemantics, selectionSchema, worldTimeMs,
} from './grounded-occurrence.mjs';
import * as awg from '../../runner/ambient-world-generator.js';

const nowMs = Date.parse('2026-10-13T20:58:28.359Z');
function fixture() {
  return { schema: 'cy.awg-capture.v1', model: 'synthetic-no-provider', currentLocation: 'cell',
    plausibleCastIds: ['bill', 'locke'], contextRendering: 'Frozen production context',
    locationRegime: { current: { id: 'CELL', entered_at: '2026-10-13T18:00:00.000Z',
      regime_activity: 'CELL_TIME', source_event_id: 'env:location' }, activeRoutineEpisode: null },
    worldSimulation: { objects: [], threads: [], recentAccepted: [], recentRuns: [] }, recentWorldHistory: [],
    postBody: { model: 'synthetic-no-provider', system: 'Frozen production system', prompt: 'Frozen production prompt',
      format: {}, options: { temperature: 0.65, top_p: 0.9, num_predict: 420, num_ctx: 3072, num_thread: 4, stop: ['<|im_end|>'] } } };
}
function sketch(overrides = {}) {
  return { decision: 'OCCURRENCE', actors: ['cy', 'bill'],
    occurrence: { eventType: 'quiet_question', summary: 'Cy asks Bill whether he heard a noise.' },
    target: { kind: 'ACTOR', id: 'bill', transition: null, holderId: null },
    observation: { observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy asks Bill whether he heard a noise.' },
    sourceRefs: ['state:current', 'actor:cy', 'actor:bill', 'channel:cy-direct'], ...overrides };
}
function setup(c = fixture(), s = sketch()) {
  const packet = buildAffordancePacket(c, { nowMs });
  const selection = checkSelection(c, packet, s, { nowMs });
  return { capture: c, packet, selection, sketch: s };
}
function encoded(context) {
  const request = buildStage2Request(context.capture, context.packet, context.selection, { nowMs });
  return Object.fromEntries(Object.entries(request.format.properties).map(([key, schema]) => (
    [key, key === 'eventFamily' ? schema.enum[0] : structuredClone(schema.const)]
  )));
}
function rejects(c, s, expected) {
  const result = checkSelection(c, buildAffordancePacket(c, { nowMs }), s, { nowMs });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes(expected)), JSON.stringify(result.errors));
}

test('packet copies state, never character metaphors, personality or an invented incident menu', () => {
  const c = fixture();
  c.contextRendering = 'Daemon runs in the background; Bailey is the outer wall.';
  c.contextInspection = { packet: { sections: [{ id: 'cast_context', items: [{ content: 'invented drama' }] }] } };
  const before = fingerprint(c);
  const p = buildAffordancePacket(c, { nowMs });
  assert.deepEqual(p.actors.map(a => a.id), ['cy', 'bill', 'locke']);
  assert.ok(p.actors.slice(1).every(a => a.eligibility === 'PRODUCTION_PLAUSIBLE_NOT_CONFIRMED_PRESENT'));
  assert.deepEqual(p.objects, []); assert.deepEqual(p.threads, []);
  assert.deepEqual(p.recentFacts, []); assert.deepEqual(p.interactionOpportunities, []);
  assert.ok(!JSON.stringify(p).includes('background'));
  assert.ok(!JSON.stringify(p).includes('outer wall'));
  assert.ok(!JSON.stringify(p).includes('invented drama'));
  assert.equal(fingerprint(c), before);
});
test('NO_EVENT remains valid in sparse state; no stage-2 request or fabricated event', () => {
  const c = fixture(); c.plausibleCastIds = [];
  const result = preparePrototype(c, { nowMs, selectionRaw: '{"decision":"NO_EVENT"}' });
  assert.equal(result.trace.status, 'NO_EVENT');
  assert.equal(result.stage2Request, null);
  assert.equal(result.trace.stage2, null);
  assert.equal(result.trace.inferenceExecuted, false);
  assert.equal(result.trace.latency.stage1InferenceMs, null);
});
test('past positive facts retain exact wording, IDs and historical scope without implying continued presence', () => {
  const c = fixture();
  c.recentWorldHistory = [{ id: 'env:1', timestamp: '2026-10-13 21:47:19.797', eventFamily: 'social',
    eventType: 'overheard', participants: ['bill'], location: 'wing', cyObserved: true, summary: 'Bill said a word; Cy could not make it out.' }];
  const p = buildAffordancePacket(c, { nowMs });
  assert.equal(p.recentFacts[0].summary, c.recentWorldHistory[0].summary);
  assert.equal(p.recentFacts[0].ref, 'event:env:1');
  assert.equal(p.recentFacts[0].atMs, Date.parse('2026-10-13T20:47:19.797Z'));
  assert.equal(p.recentFacts[0].temporalScope, 'HISTORICAL_NOT_ONGOING_OR_COPRESENCE');
  assert.equal(p.actors.find(a => a.id === 'bill').eligibility, 'PRODUCTION_PLAUSIBLE_NOT_CONFIRMED_PRESENT');
});
test('London timestamp handling is host-independent and rejects ambiguous, nonexistent, future and stale facts', () => {
  assert.equal(worldTimeMs('2026-10-13 21:56:10.483'), Date.parse('2026-10-13T20:56:10.483Z'));
  assert.equal(worldTimeMs('2026-10-25 01:30:00.000'), null);
  assert.equal(worldTimeMs('2026-03-29 01:30:00.000'), null);
  assert.equal(worldTimeMs('2026-02-31 10:00:00.000'), null);
  const c = fixture();
  c.recentWorldHistory = [
    { id: 'old', timestamp: '2026-10-10T20:00:00Z', summary: 'old' },
    { id: 'future', timestamp: '2026-10-20T20:00:00Z', summary: 'future' },
  ].map(e => ({ ...e, eventFamily: 'custody' }));
  assert.deepEqual(buildAffordancePacket(c, { nowMs }).recentFacts, []);
});
test('private/visitor/expression inputs never become positive world affordances', () => {
  const c = fixture();
  c.recentWorldHistory = [
    { eventFamily: 'POSTCARD' }, { eventFamily: 'CY_EXPRESSION' },
    { eventFamily: 'social', privacyScope: 'SENDER_RECALLABLE' },
    { eventFamily: 'social', subjectVisitorId: 'private-sender' },
  ].map((e, i) => ({ id: `private:${i}`, timestamp: '2026-10-13T20:50:00Z', summary: 'PRIVATE_SENTINEL', ...e }));
  assert.ok(!JSON.stringify(buildAffordancePacket(c, { nowMs })).includes('PRIVATE_SENTINEL'));
});
test('conversation remains a valid occurrence without requiring an object or persistent consequence', () => {
  const x = setup(); assert.equal(x.selection.valid, true, x.selection.errors.join(','));
  const p = encoded(x); p.eventFamily = 'SOCIAL_REQUEST';
  const result = evaluateStage2(x.capture, x.packet, x.selection, JSON.stringify(p), { nowMs });
  assert.equal(result.fidelity.valid, true); assert.equal(result.productionValidation.valid, true);
  assert.deepEqual(p.objects, []); assert.equal(p.thread.action, 'NONE'); assert.equal(result.applied, false);
});
test('unknown/missing source refs, actors and target actors are rejected before stage 2', () => {
  const c = fixture();
  rejects(c, sketch({ sourceRefs: ['state:current', 'actor:cy', 'actor:bill', 'invented:event'] }), 'INVALID_SOURCE_REFS');
  rejects(c, sketch({ sourceRefs: ['actor:cy', 'actor:bill', 'channel:cy-direct'] }), 'INVALID_SOURCE_REFS');
  rejects(c, sketch({ sourceRefs: [] }), 'INVALID_SOURCE_REFS');
  rejects(c, sketch({ actors: ['cy', 'imaginary'] }), 'UNAVAILABLE_ACTOR');
  rejects(c, sketch({ target: { kind: 'ACTOR', id: 'locke', transition: null, holderId: null } }), 'UNAVAILABLE_TARGET_ACTOR');
  const result = preparePrototype(c, { nowMs, selectionRaw: JSON.stringify(sketch({ sourceRefs: [] })) });
  assert.equal(result.trace.status, 'PRECONDITION_REJECTED'); assert.equal(result.stage2Request, null);
});
test('explicit wrong locations and location contradictions in prose are rejected before realisation', () => {
  rejects(fixture(), { ...sketch(), location: 'exercise_yard' }, 'INVALID_SELECTION_FIELDS');
  rejects(fixture(), sketch({ occurrence: { eventType: 'quiet_question', summary: 'Cy asks Bill a question in the yard.' } }), 'OBJECTIVE_LOCATION_CONTRADICTION');
  const c = fixture(); c.locationRegime.current.id = 'EXERCISE_YARD';
  assert.throws(() => buildAffordancePacket(c, { nowMs }), /CAPTURE_LOCATION_DISAGREEMENT/);
});
test('observation access/participation and missing channel refs are enforced', () => {
  rejects(fixture(), sketch({ observation: { observerId: 'bill', access: 'CY_DIRECT', summary: 'Bill knows this.' } }), 'UNSUPPORTED_OBSERVATION_CHANNEL');
  rejects(fixture(), sketch({ observation: { observerId: 'cy', access: 'CY_LEARNS_LATER', summary: 'Cy magically learned this.' } }), 'UNSUPPORTED_OBSERVATION_CHANNEL');
  rejects(fixture(), sketch({ observation: { observerId: 'world', access: 'WORLD_ONLY', summary: 'Cy sees this.' } }), 'OBSERVATION_PARTICIPATION_MISMATCH');
  rejects(fixture(), sketch({ actors: ['bill'] }), 'OBSERVATION_PARTICIPATION_MISMATCH');
});
test('WORLD_ONLY can remain private world activity without inventing Cy awareness', () => {
  const x = setup(fixture(), sketch({ actors: ['bill'], target: null,
    occurrence: { eventType: 'humming', summary: 'Bill hums quietly.' },
    observation: { observerId: 'world', access: 'WORLD_ONLY', summary: 'Bill hums quietly.' },
    sourceRefs: ['state:current', 'actor:bill', 'channel:world'] }));
  assert.equal(x.selection.valid, true, x.selection.errors.join(','));
  const result = evaluateStage2(x.capture, x.packet, x.selection, JSON.stringify(encoded(x)), { nowMs });
  assert.equal(result.productionValidation.valid, true);
  assert.equal(result.productionValidation.cyObserved, false);
});
test('no new, confiscated, retired or wrong-location objects can be selected', () => {
  for (const state of ['CONFISCATED', 'RETIRED', 'MISSING', 'ACTIVE']) {
    const c = fixture(); c.worldSimulation.objects = [{ id: 'item:1', type: 'permitted_item',
      status: state, holderId: 'cy', ownerId: 'cy', location: state === 'ACTIVE' ? 'wing' : 'cell' }];
    rejects(c, sketch({ target: { kind: 'OBJECT', id: 'item:1', transition: 'TRANSFER', holderId: 'bill' } }), 'UNAVAILABLE_OBJECT');
  }
  rejects(fixture(), sketch({ target: { kind: 'OBJECT', id: 'new:item', transition: 'TRANSFER', holderId: 'bill' } }), 'UNAVAILABLE_OBJECT');
});
test('object transitions come from existing state and production validates the mechanically encoded transfer', () => {
  const c = fixture(); c.worldSimulation.objects = [{ id: 'item:1', type: 'permitted_item',
    status: 'ACTIVE', ownerId: 'cy', holderId: 'cy', location: 'cell' }];
  const s = sketch({ occurrence: { eventType: 'item_handover', summary: 'Cy hands the item to Bill.' },
    observation: { observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy hands the item to Bill.' },
    target: { kind: 'OBJECT', id: 'item:1', transition: 'TRANSFER', holderId: 'bill' },
    sourceRefs: [...sketch().sourceRefs, 'object:item:1'] });
  const x = setup(c, s); assert.equal(x.selection.valid, true, x.selection.errors.join(','));
  assert.deepEqual(x.packet.objects[0].transitions, [
    { action: 'TRANSFER', holderIds: ['bill', 'locke'] }, { action: 'CONFISCATE', holderIds: ['locke'] }]);
  assert.equal(evaluateStage2(c, x.packet, x.selection, JSON.stringify(encoded(x)), { nowMs }).productionValidation.valid, true);
  rejects(c, { ...s, target: { ...s.target, transition: 'CONFISCATE' } }, 'UNSUPPORTED_OBJECT_TRANSITION');
  rejects(c, { ...s, target: { ...s.target, transition: 'CREATE' } }, 'UNSUPPORTED_OBJECT_TRANSITION');
});
test('existing message transitions reuse canonical lifecycle and reject partial-heard reading', () => {
  const c = fixture(); c.worldSimulation.objects = [{ id: 'msg:1', type: 'message', status: 'DELIVERED',
    location: 'cell', ownerId: 'bill', holderId: 'cy', message: { senderId: 'bill', recipientId: 'cy',
      content: 'A synthetic test note.', contentTruthStatus: 'UNKNOWN', lifecycleState: 'DELIVERED', readState: 'UNREAD' } }];
  const s = sketch({ occurrence: { eventType: 'message_read', summary: 'Cy reads the message.' },
    observation: { observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy reads the message.' },
    target: { kind: 'OBJECT', id: 'msg:1', transition: 'READ', holderId: 'cy' },
    sourceRefs: [...sketch().sourceRefs, 'object:msg:1'] });
  const x = setup(c, s); assert.equal(x.selection.valid, true, x.selection.errors.join(','));
  assert.deepEqual(x.packet.objects[0].transitions.map(t => t.action), ['READ', 'RESOLVE', 'RETIRE']);
  assert.ok(!JSON.stringify(x.packet).includes('A synthetic test note.'));
  rejects(c, { ...s, target: { ...s.target, transition: 'DELIVER' } }, 'UNSUPPORTED_OBJECT_TRANSITION');
  rejects(c, { ...s, observation: { ...s.observation, access: 'CY_PARTIAL_HEARD' },
    sourceRefs: s.sourceRefs.map(r => r === 'channel:cy-direct' ? 'channel:cy-heard' : r) }, 'MESSAGE_READ_WITHOUT_OBSERVATION');
});
test('only current eligible threads can update/resolve; continuation family is downstream compatibility', () => {
  const c = fixture(); c.worldSimulation.threads = [{ id: 'thread:1', state: 'OPEN', type: 'SOCIAL_REQUEST',
    participants: ['cy', 'bill'], sourceEventIds: ['world:prior'], summary: 'An unanswered question.', nextEligibleAt: null }];
  const s = sketch({ occurrence: { eventType: 'question_answered', summary: "Bill answers Cy's question and closes the discussion." },
    observation: { observerId: 'cy', access: 'CY_DIRECT', summary: "Bill answers Cy's question and closes the discussion." },
    target: { kind: 'THREAD', id: 'thread:1', transition: 'RESOLVE', holderId: null },
    sourceRefs: [...sketch().sourceRefs, 'thread:thread:1'] });
  const x = setup(c, s); assert.equal(x.selection.valid, true, x.selection.errors.join(','));
  assert.deepEqual(x.selection.checked.compatibleFamilies, ['SOCIAL_REQUEST']);
  const result = evaluateStage2(c, x.packet, x.selection, JSON.stringify(encoded(x)), { nowMs });
  assert.equal(result.productionValidation.valid, true); assert.equal(result.proposal.decision, 'CONTINUATION');
  c.worldSimulation.threads[0].state = 'RESOLVED';
  rejects(c, s, 'UNAVAILABLE_THREAD_TRANSITION');
});
test('stage 1 has no family choice and stage 2 cannot be built before checking', () => {
  const x = setup();
  assert.ok(!JSON.stringify(selectionSchema(x.packet)).includes('eventFamily'));
  rejects(x.capture, { ...x.sketch, eventFamily: 'WING_ACTIVITY' }, 'INVALID_SELECTION_FIELDS');
  assert.throws(() => buildStage2Request(x.capture, x.packet, { valid: false }, { nowMs }), /SELECTION_NOT_CHECKED/);
  const req = buildStage2Request(x.capture, x.packet, x.selection, { nowMs });
  assert.ok(req.prompt.startsWith(x.capture.postBody.prompt));
  assert.equal(req.system, x.capture.postBody.system);
  assert.deepEqual(req.options, x.capture.postBody.options);
  assert.equal(req.model, x.capture.model);
});
test('stage 2 cannot substitute actors, actions, observation prose, objects, claims or thread effects', () => {
  const x = setup(); const original = encoded(x);
  const changes = [
    p => p.participants.push('locke'),
    p => p.objective.eventType = 'different_action',
    p => p.objective.summary = 'Bill takes an item away.',
    p => p.observations[0].summary = 'Bill takes an item away.',
    p => p.observations[0].access = 'CY_LEARNS_LATER',
    p => p.objects.push({ id: 'invented' }),
    p => p.informationClaims.push({ speakerId: 'bill', content: 'new invented action', truthStatus: 'UNKNOWN' }),
    p => p.thread.action = 'OPEN',
    p => p.unexpected = 'repair me',
  ];
  for (const change of changes) {
    const p = structuredClone(original); change(p);
    const result = evaluateStage2(x.capture, x.packet, x.selection, JSON.stringify(p), { nowMs });
    assert.equal(result.fidelity.valid, false); assert.equal(result.productionValidation, null);
    assert.ok(result.fidelity.errors.includes('REALISATION_DRIFT'));
  }
});
test('tampered packets/checked sketches and compatible-family injection cannot bypass a fresh check', () => {
  const x = setup();
  const wrong = structuredClone(x.packet); wrong.actors.push({ ref: 'actor:fake', id: 'fake' });
  assert.equal(checkSelection(x.capture, wrong, x.sketch, { nowMs }).valid, false);
  const changed = structuredClone(x.selection); changed.checked.sketch.occurrence.summary = 'Changed after selection.';
  assert.throws(() => buildStage2Request(x.capture, x.packet, changed, { nowMs }), /STALE_SELECTION/);
  const p = encoded(x); p.eventFamily = 'RUMOUR';
  x.selection.checked.compatibleFamilies.push('RUMOUR');
  assert.ok(evaluateStage2(x.capture, x.packet, x.selection, JSON.stringify(p), { nowMs }).fidelity.errors.includes('INCOMPATIBLE_FAMILY'));
});
test('telemetry keeps raw/parsed selection, references, checks, realisation and separate unmeasured inference timings', () => {
  const x = setup(); const p = encoded(x); const raw = JSON.stringify(p);
  const before = fingerprint(x.capture);
  const result = preparePrototype(x.capture, { nowMs, selectionRaw: JSON.stringify(x.sketch), proposalRaw: raw });
  assert.equal(result.trace.status, 'VALIDATED_NOT_APPLIED');
  assert.deepEqual(result.trace.sourceRefsUsed, x.sketch.sourceRefs);
  assert.equal(result.trace.stage2.raw, raw);
  assert.equal(result.trace.stage2.fidelity.classification, 'EXACT_SKETCH_BINDING');
  assert.equal(result.trace.latency.stage1InferenceMs, null); assert.equal(result.trace.latency.stage2InferenceMs, null);
  assert.equal(fingerprint(x.capture), before);
});
test('production functions are the original imports; runner has no prototype wiring or provider transport', () => {
  assert.equal(productionSemantics.parser, awg.parseAwgCandidate);
  assert.equal(productionSemantics.materialiser, awg.materialiseAwgProposal);
  assert.equal(productionSemantics.validator, awg.validateAwgCandidate);
  assert.equal(productionSemantics.timeoutMs, 420000);
  const here = path.dirname(fileURLToPath(import.meta.url));
  assert.ok(!/grounded-occurrence/.test(fs.readFileSync(path.join(here, '../../runner/run.js'), 'utf8')));
  const prototype = fs.readFileSync(path.join(here, 'grounded-occurrence.mjs'), 'utf8');
  assert.ok(!/\bfetch\s*\(|makeProviders|node:https?|node:net|applyAwgCandidate/.test(prototype));
});
test('CLI has no inference/host switch and documents offline-only use', () => {
  const cli = fileURLToPath(new URL('./prepare-grounded-occurrence.mjs', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /OFFLINE ONLY/);
  for (const forbidden of ['--host', '--infer', '--generate', '--provider', '--model']) {
    const attempt = spawnSync(process.execPath, [cli, forbidden, 'not-authorised'], { encoding: 'utf8' });
    assert.notEqual(attempt.status, 0); assert.match(attempt.stderr, /no inference mode exists/);
  }
});
test('packet bounds are deterministic and no host clock supplies a missing frozen time', () => {
  const c = fixture();
  assert.throws(() => buildAffordancePacket(c), /EXPLICIT_FROZEN_NOW_REQUIRED/);
  c.recentWorldHistory = Array.from({ length: 20 }, (_, i) => ({ id: `env:${i}`, eventFamily: 'custody',
    timestamp: new Date(nowMs - (20 - i) * 1000).toISOString(), summary: `Recorded fact ${i}` }));
  const p = buildAffordancePacket(c, { nowMs });
  assert.equal(p.recentFacts.length, 12);
  assert.equal(p.recentFacts[0].sourceId, 'env:8');
  assert.deepEqual(buildAffordancePacket(c, { nowMs }), p);
});
