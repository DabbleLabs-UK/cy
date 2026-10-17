import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  FIELD_ORDER, buildOneCallPacket, buildOneCallRequest, evaluateOneCall,
  oneCallFormat, prepareOneCall, runOneCallAttempt as unguardedAttempt,
  compactModelPacket, expandModelPacket,
} from './one-call-grounded-proposal.mjs';
import { fingerprint } from './grounded-occurrence.mjs';
import { TOKENIZER_METHOD } from './one-call-context-budget.mjs';

// Fake receipt for FAKE generator tests only. Exact real-tokenizer tests are separate.
const fakePreflight = request => ({ requestFingerprint: fingerprint(request), method: TOKENIZER_METHOD,
  model: request.model, inputTokens: 100, effectiveContext: 3072, outputAllowance: 420 });
const runOneCallAttempt = options => unguardedAttempt({ preflight: fakePreflight, ...options });

const nowMs = Date.parse('2026-10-13T20:58:28.359Z');
function capture() {
  return { schema: 'cy.awg-capture.v1', model: 'SYNTHETIC_NO_PROVIDER', currentLocation: 'cell',
    plausibleCastIds: ['bill', 'locke'], contextRendering: 'NOT USED: personality is not activity.',
    locationRegime: { current: { id: 'CELL', regime_activity: 'CELL_TIME',
      entered_at: '2026-10-13T18:00:00Z', source_event_id: 'env:location' } },
    recentWorldHistory: [], worldSimulation: { objects: [], threads: [], recentAccepted: [], recentRuns: [] },
    postBody: { options: { temperature: 0.65, top_p: 0.9, repeat_penalty: 1.1, repeat_last_n: 128,
      num_predict: 420, num_ctx: 3072, num_thread: 4, stop: ['<|im_end|>', "Here's an attempt"] } } };
}
function ordinary() {
  return { actors: ['cy'], occurrence: { eventType: 'finger_tapping',
    summary: 'Cy taps his fingers against the cell wall.', originLocation: 'cell',
    presence: [{ actorId: 'cy', mode: 'SELF', sourceRef: null }] }, target: null,
  observation: { observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy sees his fingers tapping against the cell wall.' },
  sourceRefs: ['state:current', 'actor:cy', 'origin:current', 'channel:cy-direct'], effects: [],
  classification: { eventFamily: 'WING_ACTIVITY' } };
}
function officerArrival() {
  const p = ordinary();
  p.actors.push('locke'); p.occurrence.eventType = 'officer_arrival';
  p.occurrence.summary = 'Mr Locke approaches the cell door and knocks.';
  p.occurrence.presence.push({ actorId: 'locke', mode: 'ARRIVES', sourceRef: null });
  p.observation.summary = 'Cy sees Mr Locke approach the cell door.';
  p.sourceRefs.push('actor:locke'); p.target = { kind: 'ACTOR', id: 'locke' };
  p.classification.eventFamily = 'OFFICER_ACTIVITY'; return p;
}
function heard() {
  const p = ordinary(); p.occurrence.eventType = 'adjacent_footsteps';
  p.occurrence.summary = "Footsteps sound on the landing outside Cy's cell.";
  p.occurrence.originLocation = 'landing';
  p.observation = { observerId: 'cy', access: 'CY_PARTIAL_HEARD',
    summary: 'Cy hears footsteps on the landing outside his cell.' };
  p.sourceRefs = ['state:current', 'actor:cy', 'origin:cell-landing', 'channel:cy-heard'];
  p.classification.eventFamily = 'OVERHEARD_ACTIVITY'; return p;
}
function audibleIdentity() {
  const p = heard(); p.actors.push('bill');
  p.occurrence.summary = 'Bill calls out his own name on the landing outside the cell.';
  p.occurrence.presence.push({ actorId: 'bill', mode: 'AUDIBLY_IDENTIFIES', sourceRef: null });
  p.observation.summary = 'Cy hears Bill call out his own name on the landing.';
  p.sourceRefs.push('actor:bill'); p.target = { kind: 'ACTOR', id: 'bill' }; return p;
}
function evaluate(c = capture(), p = ordinary(), opts = {}) {
  return evaluateOneCall(c, buildOneCallPacket(c, { nowMs }), JSON.stringify(p), { nowMs, ...opts });
}
function valid(c = capture(), p = ordinary()) {
  const r = evaluate(c, p); assert.equal(r.valid, true, r.reason); return r;
}
function invalid(c, p, expected) {
  const r = evaluate(c, p); assert.equal(r.valid, false);
  assert.match(r.reason, expected); assert.equal(r.outcome, 'NO_WORLD_EVENT'); return r;
}

test('model contract has no abstention branch and classification is last', () => {
  const c = capture(), packet = buildOneCallPacket(c, { nowMs });
  const request = buildOneCallRequest(c, packet);
  assert.deepEqual(Object.keys(request.format.properties), FIELD_ORDER);
  assert.deepEqual(request.format.required, FIELD_ORDER);
  assert.equal(Object.keys(request.format.properties).at(-1), 'classification');
  assert.ok(!/NO_EVENT|OCCURRENCE/.test(JSON.stringify(request)));
  assert.ok(!Object.hasOwn(request.format.properties, 'decision'));
  assert.equal(request.format.properties.effects.minItems, 0);
  assert.equal(request.format.properties.effects.maxItems, 0);
  assert.deepEqual(request.format.properties.target.oneOf.map(b => b.properties?.kind?.const || 'NULL'), ['NULL', 'ACTOR']);
});

test('model-facing compaction is lossless, including all grounding fields and source IDs', () => {
  const c = capture();
  c.recentWorldHistory.push({ id: 'old:1', timestamp: '2026-10-13T20:40:00Z', eventFamily: 'CUSTODY',
    participants: ['locke'], summary: 'Mr Locke approached the cell door.', cyObserved: true });
  const packet = buildOneCallPacket(c, { nowMs });
  const compact = compactModelPacket(packet);
  assert.deepEqual(expandModelPacket(compact), packet);
  const request = buildOneCallRequest(c, packet);
  assert.deepEqual(JSON.parse(request.prompt.split('\n\n').at(-1)), compact);
  assert.ok(request.prompt.includes('eligibility alone is not co-presence'));
  assert.ok(request.prompt.includes('Historical facts are context, not incidents to repeat'));
  assert.deepEqual(request.format, oneCallFormat(packet));
  assert.deepEqual(request.options, c.postBody.options);
});

test('unrecognised future actor/fact fields fail compaction rather than silently losing information', () => {
  const packet = buildOneCallPacket(capture(), { nowMs });
  packet.actors[0].newGroundingField = 'must not disappear';
  assert.throws(() => compactModelPacket(packet), /UNSUPPORTED_ACTOR_COMPACTION/);
});

test('missing, overflowed or stale exact-token preflight prevents any generator call', async () => {
  for (const preflight of [undefined,
    request => ({ ...fakePreflight(request), inputTokens: 3120 }),
    request => ({ ...fakePreflight(request), inputTokens: 2719 }),
    request => ({ ...fakePreflight(request), requestFingerprint: 'stale' })]) {
    let calls = 0;
    const result = await unguardedAttempt({ capture: capture(), nowMs, admitted: true, preflight,
      generate: async () => { calls++; return JSON.stringify(ordinary()); } });
    assert.equal(calls, 0); assert.equal(result.generateInvocations, 0);
    assert.match(result.reason, /TOKEN_PREFLIGHT/);
  }
});

test('sparse world allows ordinary non-durable occurrence with empty effects', () => {
  const c = capture(), before = fingerprint(c), r = valid(c);
  assert.deepEqual(r.proposal.objects, []); assert.equal(r.proposal.thread.action, 'NONE');
  assert.equal(r.legacyValidation.valid, true); assert.deepEqual(r.compatibilityExceptions, []);
  assert.equal(r.applied, false); assert.equal(fingerprint(c), before);
});

test('drought is diagnostic only and cannot change packet/schema/request or force effects', () => {
  const c = capture(); const req = prepareOneCall(c, { nowMs }).request;
  c.worldSimulation.recentRuns = Array.from({ length: 4 }, () => ({ validationStatus: 'ACCEPTED',
    candidateOutput: { objects: [] }, threadChanges: [] }));
  const prepared = prepareOneCall(c, { nowMs, raw: JSON.stringify(ordinary()) });
  assert.equal(prepared.trace.droughtDiagnosticOnly.active, true);
  assert.equal(prepared.trace.evaluation.valid, true);
  // The input fingerprint changes honestly; the request carries no drought instruction.
  const a = structuredClone(req), b = structuredClone(prepared.request);
  const scrubFingerprint = r => {
    const parts = r.prompt.split('\n\n'), p = JSON.parse(parts.at(-1));
    delete p.inputFingerprint; parts[parts.length - 1] = JSON.stringify(p); r.prompt = parts.join('\n\n');
  };
  scrubFingerprint(a); scrubFingerprint(b); assert.deepEqual(a, b);
  assert.ok(!/drought|prefer to open|leaves nothing behind/i.test(req.prompt));
});

test('same model, stochastic sampler, context, output limit and stops are copied untouched', () => {
  const c = capture(), before = fingerprint(c), p = prepareOneCall(c, { nowMs });
  assert.equal(p.request.model, c.model); assert.deepEqual(p.request.options, c.postBody.options);
  assert.equal(p.request.options.num_predict, 420); assert.equal(p.request.options.temperature, 0.65);
  assert.equal(fingerprint(c), before); assert.equal(p.trace.inferenceExecuted, false);
});

test('unavailable structured actor and undeclared known person in prose both fail', () => {
  let p = ordinary(); p.actors.push('invented'); invalid(capture(), p, /UNAVAILABLE_ACTOR/);
  p = ordinary(); p.occurrence.summary = 'Fisher says something to Cy.';
  invalid(capture(), p, /UNDECLARED_OR_UNAVAILABLE_ACTOR:fisher/);
  p = ordinary(); p.observation.summary = 'Cy hears Bill call out.';
  invalid(capture(), p, /UNDECLARED_OR_UNAVAILABLE_ACTOR:bill/);
});

test('unknown named actor cannot bypass the structured roster', () => {
  const p = ordinary(); p.occurrence.summary = 'Nigel approaches the cell door.';
  invalid(capture(), p, /UNKNOWN_NAMED_ACTOR:Nigel/);
});

test('an undeclared anonymous visible actor is not smuggled in as an unnamed officer', () => {
  const p = ordinary(); p.occurrence.summary = 'An officer approaches the cell door.';
  p.observation.summary = 'Cy sees an officer approach.'; invalid(capture(), p, /UNDECLARED_ACTOR_ROLE/);
  const q = heard(); q.occurrence.summary = 'Someone calls out on the landing.';
  q.observation.summary = 'Cy hears someone calling out on the landing.'; valid(capture(), q);
});

test('ordinary mark and bodily activity are not cast or possessions', () => {
  const p = ordinary(); p.occurrence.summary = 'Cy studies a mark on the cell wall and holds his breath.';
  p.observation.summary = 'Cy sees a mark on the wall.'; valid(capture(), p);
});

test('unlisted physical objects fail even when target and effects are empty', () => {
  for (const summary of ['Cy finds a spoon.', 'Cy reads a letter.', 'Cy holds a widget.', 'Cy sees a stone.']) {
    const p = ordinary(); p.occurrence.summary = summary;
    invalid(capture(), p, /UNLISTED_(?:OBJECT_MENTION|HANDLED_OBJECT)/);
  }
});

test('target must exist, be usable and have prerequisite reference', () => {
  const c = capture(); let p = ordinary(); p.target = { kind: 'OBJECT', id: 'missing' };
  invalid(c, p, /UNAVAILABLE_TARGET/);
  c.worldSimulation.objects.push({ id: 'note:1', type: 'note', status: 'CONFISCATED', location: 'cell', ownerId: 'cy', holderId: 'locke' });
  p.target.id = 'note:1'; invalid(c, p, /UNAVAILABLE_TARGET/);
  c.worldSimulation.objects[0].status = 'ACTIVE'; c.worldSimulation.objects[0].holderId = 'cy';
  p.occurrence.summary = 'Cy looks at the note.'; p.observation.summary = 'Cy sees the note.';
  invalid(c, p, /INVALID_SOURCE_REFS/); p.sourceRefs.push('object:note:1'); valid(c, p);
});

test('unknown refs, missing origin/channel refs and duplicate refs fail closed', () => {
  for (const refs of [['actor:cy'], [...ordinary().sourceRefs, 'event:invented'],
    [...ordinary().sourceRefs, 'actor:cy'], ordinary().sourceRefs.filter(r => !r.startsWith('origin:'))]) {
    const p = ordinary(); p.sourceRefs = refs; invalid(capture(), p, /INVALID_SOURCE_REFS/);
  }
});

test('a directly observed officer arrival establishes presence within the new event', () => {
  const r = valid(capture(), officerArrival());
  assert.deepEqual(r.proposal.participants, ['cy', 'locke']); assert.equal(r.legacyValidation.valid, true);
});

test('conversation remains legitimate without property, threads or an existing incident', () => {
  const p = officerArrival();
  p.occurrence.summary = 'Mr Locke approaches the cell door and asks Cy how his morning is going.';
  p.observation.summary = 'Cy sees Mr Locke approach and hears him ask about his morning.';
  p.classification.eventFamily = 'SOCIAL_REQUEST'; const r = valid(capture(), p);
  assert.deepEqual(r.proposal.objects, []); assert.equal(r.proposal.thread.action, 'NONE');
});

test('world-only arrival can remain outside Cy knowledge', () => {
  const c = capture(); c.currentLocation = 'wing'; c.locationRegime.current.id = 'WING_OR_LANDING';
  const p = ordinary(); p.actors = ['bill'];
  p.occurrence = { eventType: 'quiet_arrival', summary: 'Bill arrives on the wing and pauses.', originLocation: 'wing',
    presence: [{ actorId: 'bill', mode: 'ARRIVES', sourceRef: null }] };
  p.observation = { observerId: 'world', access: 'WORLD_ONLY', summary: 'Bill arrives on the wing and pauses.' };
  p.sourceRefs = ['state:current', 'actor:bill', 'origin:current', 'channel:world'];
  const r = valid(c, p); assert.equal(r.legacyValidation.cyObserved, false);
  assert.equal(r.candidate.publicTimeline.eligible, false);
});

test('schema does not advertise unsupported episode presence or inmate cell arrival', () => {
  const f = oneCallFormat(buildOneCallPacket(capture(), { nowMs }));
  const branches = f.properties.occurrence.properties.presence.items.oneOf;
  assert.ok(!JSON.stringify(branches).includes('CURRENT_EPISODE'));
  assert.deepEqual(branches.find(b => b.properties.mode.const === 'ARRIVES').properties.actorId.enum, ['locke']);
});

test('roster eligibility cannot establish co-presence or certify an unobserved arrival', () => {
  let p = officerArrival(); p.occurrence.presence[1].mode = 'CURRENT_EPISODE';
  invalid(capture(), p, /UNSUPPORTED_COPRESENCE/);
  p = officerArrival(); p.occurrence.summary = 'Mr Locke is standing in the cell.';
  invalid(capture(), p, /ARRIVAL_NOT_IN_OCCURRENCE/);
  p = officerArrival(); p.observation.summary = 'Cy hears knocking.';
  invalid(capture(), p, /ARRIVAL_NOT_IN_OBSERVATION/);
});

test('historical event references cannot serve as current presence evidence', () => {
  const c = capture(); c.recentWorldHistory.push({ id: 'old:1', timestamp: '2026-10-13T20:40:00Z',
    eventFamily: 'CUSTODY', participants: ['locke'], summary: 'Mr Locke approached the cell door.' });
  const p = officerArrival(); p.occurrence.presence[1] = { actorId: 'locke', mode: 'CURRENT_EPISODE', sourceRef: 'event:old:1' };
  p.sourceRefs.push('event:old:1'); invalid(c, p, /UNSUPPORTED_COPRESENCE/);
});

test('a live directly observed search episode can support current presence; an offscreen one cannot', () => {
  const c = capture(); c.locationRegime.searchEpisode = { id: 'search:1', status: 'ACTIVE', actor_id: 'locke',
    cy_present_at_start: true, cy_knowledge: 'CY_DIRECTLY_OBSERVED' };
  const p = officerArrival(); p.occurrence.presence[1] = { actorId: 'locke', mode: 'CURRENT_EPISODE', sourceRef: 'episode:search:1' };
  p.sourceRefs.push('episode:search:1'); p.occurrence.summary = 'Mr Locke asks Cy a question.';
  p.observation.summary = 'Cy hears Mr Locke ask a question.'; valid(c, p);
  c.locationRegime.searchEpisode.cy_present_at_start = false; invalid(c, p, /UNSUPPORTED_COPRESENCE/);
  // Validity of a sketch does not grant scheduling admission during a search.
});

test('inmate arrival into the cell is not invented from eligibility', () => {
  const p = officerArrival(); p.actors[1] = 'bill'; p.target.id = 'bill';
  p.occurrence.presence[1].actorId = 'bill'; p.sourceRefs = p.sourceRefs.map(r => r === 'actor:locke' ? 'actor:bill' : r);
  p.occurrence.summary = 'Bill arrives in the cell.'; p.observation.summary = 'Cy sees Bill arrive in the cell.';
  invalid(capture(), p, /UNSUPPORTED_INMATE_CELL_ENTRY/);
});

test('anonymous adjacent sound is valid without fabricating actor identity or Cy movement', () => {
  const p = heard(), original = JSON.stringify(p), r = valid(capture(), p);
  assert.equal(r.candidate.location, 'cell'); assert.equal(r.parsed.occurrence.originLocation, 'landing');
  assert.equal(r.legacyValidation.valid, false);
  assert.deepEqual(r.compatibilityExceptions.map(e => e.code), ['OBJECTIVE_LOCATION_CONTRADICTION']);
  assert.equal(r.candidate.objective.summary, p.occurrence.summary);
  assert.equal(r.candidate.observations[0].summary, p.observation.summary);
  assert.equal(r.raw, original); // No stripping, relocation or text repair to obtain validity.
});

test('named audible arrival requires identity established within the new occurrence', () => {
  valid(capture(), audibleIdentity());
  const p = audibleIdentity(); p.occurrence.summary = 'Bill hums quietly on the landing.';
  p.observation.summary = 'Cy hears Bill humming on the landing.';
  invalid(capture(), p, /IDENTITY_NOT_ESTABLISHED/);
});

test('adjacent hearing cannot smuggle sight, other locations, Cy movement or physical effects', () => {
  let p = heard(); p.observation.summary = 'Cy sees someone on the landing.';
  invalid(capture(), p, /HEARING_NOT_DESCRIBED|HEARING_CLAIMS_VISUAL_DETAIL/);
  p = heard(); p.occurrence.summary = 'Footsteps sound in the library.';
  invalid(capture(), p, /UNSUPPORTED_PROSE_LOCATION:library/);
  p = heard(); p.observation.summary = 'Cy hears footsteps and walks onto the landing.';
  invalid(capture(), p, /AMBIGUOUS_ADJACENT_MOVEMENT/);
  p = heard(); p.occurrence.summary = 'Cy stands on the landing and listens.';
  invalid(capture(), p, /CY_MOVED_OR_ACTED_AT_ADJACENT_ORIGIN/);
});

test('family label cannot evade physical grounding or turn hearing into direct access', () => {
  const p = ordinary(); p.occurrence.summary = 'Cy sits in the library.';
  p.classification.eventFamily = 'RUMOUR'; invalid(capture(), p, /UNSUPPORTED_PROSE_LOCATION/);
  const q = heard(); q.observation.access = 'CY_DIRECT'; q.sourceRefs.push('channel:cy-direct');
  invalid(capture(), q, /UNSUPPORTED_ADJACENT_OBSERVATION/);
});

test('typed object transfer reuses canonical operations and cannot add a hidden effect', () => {
  const c = capture(); c.worldSimulation.objects.push({ id: 'note:1', type: 'note', status: 'ACTIVE',
    location: 'cell', ownerId: 'cy', holderId: 'cy' });
  const p = officerArrival(); p.target = { kind: 'OBJECT', id: 'note:1' }; p.sourceRefs.push('object:note:1');
  p.occurrence.summary = 'Mr Locke approaches the cell door. Cy hands the note to Mr Locke.';
  p.observation.summary = 'Cy sees Mr Locke approach the cell door and accept the note.';
  p.effects = [{ kind: 'OBJECT_TRANSITION', objectId: 'note:1', operation: 'TRANSFER', holderId: 'locke' }];
  p.classification.eventFamily = 'OBJECT_TRANSFER'; valid(c, p);
  p.effects[0].operation = 'CREATE'; invalid(c, p, /UNSUPPORTED_OBJECT_TRANSITION/);
  p.effects[0].operation = 'TRANSFER'; p.occurrence.summary = 'Mr Locke approaches the cell door.';
  invalid(c, p, /EFFECT_NOT_IN_OCCURRENCE/);
});

test('message reading/transfer cannot be claimed as an empty-effect observation', () => {
  const c = capture(); c.worldSimulation.objects.push({ id: 'note:1', type: 'note', status: 'ACTIVE',
    location: 'cell', ownerId: 'cy', holderId: 'cy' });
  const p = ordinary(); p.target = { kind: 'OBJECT', id: 'note:1' }; p.sourceRefs.push('object:note:1');
  p.occurrence.summary = 'Cy reads the note.'; p.observation.summary = 'Cy reads the note.';
  invalid(c, p, /OBJECT_OPERATION_WITHOUT_EFFECT/);
});

test('existing thread resolution has explicit typed effect and preserves canonical thread type', () => {
  const c = capture(); c.worldSimulation.threads.push({ id: 'thread:1', state: 'OPEN', type: 'SOCIAL_REQUEST',
    participants: ['cy', 'locke'], sourceEventIds: ['old:event'], nextEligibleAt: null, summary: 'An unanswered question.' });
  const p = officerArrival(); p.target = { kind: 'THREAD', id: 'thread:1' }; p.sourceRefs.push('thread:thread:1');
  p.occurrence.summary = 'Mr Locke approaches the cell door and answers the question.';
  p.effects = [{ kind: 'THREAD_TRANSITION', threadId: 'thread:1', operation: 'RESOLVE', summary: p.occurrence.summary }];
  p.classification.eventFamily = 'SOCIAL_REQUEST'; const r = valid(c, p);
  assert.equal(r.proposal.decision, 'CONTINUATION'); assert.equal(r.candidate.thread.type, 'SOCIAL_REQUEST');
  c.worldSimulation.threads[0].state = 'RESOLVED'; invalid(c, p, /UNAVAILABLE_TARGET/);
});

test('exact historical replay and production duplicates still become no event', () => {
  const c = capture(), p = ordinary();
  c.recentWorldHistory.push({ id: 'event:1', timestamp: '2026-10-13T20:40:00Z', eventFamily: 'CUSTODY', summary: p.occurrence.summary });
  invalid(c, p, /HISTORICAL_RECORD_REPLAY/);
  c.recentWorldHistory = []; c.worldSimulation.recentAccepted.push({ occurredAt: '2026-10-13T20:00:00Z',
    signature: p.occurrence.summary.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() });
  invalid(c, p, /PRODUCTION_VALIDATION:DUPLICATE_EVENT/);
});

test('stale capture and tampered packet fail without applying or rewriting anything', () => {
  const c = capture(), p = ordinary(), packet = buildOneCallPacket(c, { nowMs });
  const changed = structuredClone(c); changed.locationRegime.current.source_event_id = 'new:event';
  assert.equal(evaluateOneCall(c, packet, JSON.stringify(p), { nowMs, currentCapture: changed }).reason, 'STALE_CAPTURE');
  packet.origins.push({ ref: 'invented', location: 'library' });
  assert.equal(evaluateOneCall(c, packet, JSON.stringify(p), { nowMs }).reason, 'STALE_OR_TAMPERED_PACKET');
});

test('one admitted attempt invokes exactly one generator; invalid output has no repair or replacement', async () => {
  for (const raw of [JSON.stringify(ordinary()), '{bad JSON', '{"decision":"NO_EVENT"}']) {
    let calls = 0;
    const r = await runOneCallAttempt({ capture: capture(), nowMs, admitted: true,
      generate: async () => { calls++; return raw; } });
    assert.equal(calls, 1); assert.equal(r.generateInvocations, 1);
    assert.equal(r.repairCalls, 0); assert.equal(r.replacementCalls, 0); assert.equal(r.applied, false);
    assert.equal(r.status, raw === JSON.stringify(ordinary()) ? 'VALIDATED_NOT_APPLIED' : 'NO_WORLD_EVENT');
  }
});

test('classification-first JSON and prose/fence wrappers are not extracted or silently reordered', () => {
  const c = capture(), packet = buildOneCallPacket(c, { nowMs }), p = ordinary();
  const changed = { classification: p.classification, ...p };
  assert.equal(evaluateOneCall(c, packet, JSON.stringify(changed), { nowMs }).reason, 'INVALID_PROPERTY_ORDER');
  for (const raw of ['Here is JSON: ' + JSON.stringify(p), '```json\n' + JSON.stringify(p) + '\n```'])
    assert.equal(evaluateOneCall(c, packet, raw, { nowMs }).valid, false);
});

test('provider cannot change the verified request or invoke a hidden replacement', async () => {
  const r = await runOneCallAttempt({ capture: capture(), nowMs, admitted: true,
    generate: async request => { request.options.temperature = 0; return JSON.stringify(ordinary()); } });
  assert.equal(r.reason, 'REQUEST_MUTATED'); assert.equal(r.generateInvocations, 1); assert.ok(r.requestFingerprint);
});

test('failure retains raw transport evidence and precise cancellation cause', async () => {
  const error = new Error('HTTP_503'); error.responseText = 'synthetic error body';
  const r = await runOneCallAttempt({ capture: capture(), nowMs, admitted: true, generate: async () => { throw error; } });
  assert.equal(r.raw, 'synthetic error body'); assert.equal(r.reason, 'HTTP_503');
  const ac = new AbortController();
  const cancelled = await runOneCallAttempt({ capture: capture(), nowMs, admitted: true, signal: ac.signal,
    generate: async () => { ac.abort('INTERACTIVE_PREEMPTION'); return JSON.stringify(ordinary()); } });
  assert.equal(cancelled.abortReason, 'INTERACTIVE_PREEMPTION'); assert.equal(cancelled.reason, 'CANCELLED');
});

test('provider failure, timeout and cancellation fail closed after at most one call', async () => {
  const failed = await runOneCallAttempt({ capture: capture(), nowMs, admitted: true,
    generate: async () => { throw new Error('TRANSPORT_FAILURE'); } });
  assert.equal(failed.reason, 'TRANSPORT_FAILURE'); assert.equal(failed.generateInvocations, 1);
  let aborted = false;
  const timed = await runOneCallAttempt({ capture: capture(), nowMs, admitted: true, timeoutMs: 10,
    generate: (_, { signal }) => new Promise(() => signal.addEventListener('abort', () => { aborted = true; })) });
  assert.equal(timed.reason, 'TIMEOUT'); assert.equal(aborted, true); assert.equal(timed.generateInvocations, 1);
  const ac = new AbortController();
  const cancelled = await runOneCallAttempt({ capture: capture(), nowMs, admitted: true, signal: ac.signal,
    generate: async () => { ac.abort(); return JSON.stringify(ordinary()); } });
  assert.equal(cancelled.reason, 'CANCELLED'); assert.equal(cancelled.generateInvocations, 1);
});

test('lack of admission and pre-cancellation make no model call', async () => {
  const generate = () => { throw new Error('MUST_NOT_CALL'); }, ac = new AbortController(); ac.abort();
  for (const options of [{ admitted: false }, { admitted: true, signal: ac.signal }]) {
    const r = await runOneCallAttempt({ capture: capture(), nowMs, generate, ...options });
    assert.equal(r.generateInvocations, 0);
  }
});

test('state change during inference discards the completed result without a second call', async () => {
  const c = capture(), changed = structuredClone(c); changed.worldSimulation.lastRunAt = 'changed'; let reads = 0;
  const r = await runOneCallAttempt({ capture: c, nowMs, admitted: true,
    getCurrentCapture: () => ++reads === 1 ? c : changed, generate: async () => JSON.stringify(ordinary()) });
  assert.equal(r.status, 'NO_WORLD_EVENT'); assert.equal(r.reason, 'STALE_CAPTURE'); assert.equal(r.generateInvocations, 1);
});

test('private sources and personality prose remain absent from mechanically derived packet', () => {
  const c = capture(); c.contextRendering = 'PRIVATE_SENTINEL / Daemon runs in the background';
  c.recentWorldHistory = [{ id: 'private:1', timestamp: '2026-10-13T20:40:00Z', eventFamily: 'SOCIAL',
    privacyScope: 'SENDER_RECALLABLE', summary: 'PRIVATE_SENTINEL' }];
  const p = buildOneCallPacket(c, { nowMs });
  assert.ok(!/PRIVATE_SENTINEL|runs in the background/.test(JSON.stringify(p)));
});

test('production code path has no one-call prototype wiring, and CLI cannot send requests', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const run = fs.readFileSync(path.join(here, '../../runner/run.js'), 'utf8');
  assert.ok(!/one-call-grounded/.test(run));
  const module = fs.readFileSync(path.join(here, 'one-call-grounded-proposal.mjs'), 'utf8');
  assert.ok(!/\bfetch\s*\(|node:https?|node:net|makeProviders|applyAwgCandidate/.test(module));
  const cli = path.join(here, 'prepare-one-call-grounded-proposal.mjs');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /OFFLINE ONLY/);
  for (const flag of ['--run', '--host', '--provider', '--model', '--stage2']) {
    const r = spawnSync(process.execPath, [cli, flag, 'forbidden'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /no inference mode exists/);
  }
});
