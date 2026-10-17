import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareSemanticCore, evaluateSemanticCore, runSemanticAttempt, FIELD_ORDER } from './semantic-core.mjs';
import { fingerprint } from './grounded-occurrence.mjs';
import { TOKENIZER_METHOD, exactContextPreflight } from './one-call-context-budget.mjs';
import { readVerifiedCapture } from './prepare-grounded-occurrence.mjs';
import { spawnSync } from 'node:child_process';
import { replayLegacy } from './semantic-core-replay.mjs';
import { CAST, OFFICERS } from '../../runner/cast.js';

const nowMs = Date.parse('2026-10-13T20:58:28.359Z');
const capture = () => ({ model: 'FAKE_NO_PROVIDER', currentLocation: 'cell', plausibleCastIds: ['cy', 'bill', 'reg', 'locke'],
  locationRegime: { current: { id: 'CELL', regime_activity: 'CELL_TIME' } },
  worldSimulation: { objects: [], threads: [], recentAccepted: [], recentRuns: [] }, recentWorldHistory: [],
  postBody: { options: { temperature: 0.65, top_p: 0.9, repeat_penalty: 1.1, repeat_last_n: 128, num_ctx: 3072, num_predict: 420, num_thread: 4 } } });
const ordinary = () => ({ roles: [{ entityId: 'cy', role: 'ACTOR' }], occurrence: 'Cy taps his fingers against the cell wall.',
  accessFrameId: 'CURRENT_DIRECT', effectChoiceId: null });
const anonymous = () => ({ roles: [{ entityId: 'UNIDENTIFIED', role: 'ACTOR' }],
  occurrence: 'Cy hears footsteps on the landing outside his cell.', accessFrameId: 'ADJACENT_UNIDENTIFIED', effectChoiceId: null });
const named = () => ({ roles: [{ entityId: 'reg', role: 'ACTOR' }], occurrence: "Reg calls out 'Reg' on the landing.",
  accessFrameId: 'ADJACENT_SELF_IDENTIFIED', effectChoiceId: null });
const arrival = () => ({ roles: [{ entityId: 'locke', role: 'ACTOR' }], occurrence: 'Mr Locke approaches the cell door and knocks.',
  accessFrameId: 'CURRENT_DIRECT', effectChoiceId: null });
const evaluate = (p, c = capture(), extra = {}) => {
  const prepared = prepareSemanticCore(c, { nowMs });
  return evaluateSemanticCore(c, prepared.packet, JSON.stringify(p), { nowMs, ...extra });
};
const valid = (p, c) => { const r = evaluate(p, c); assert.equal(r.valid, true, r.reason); return r; };
const invalid = (p, re, c, extra) => { const r = evaluate(p, c, extra); assert.equal(r.valid, false); assert.match(r.reason, re); return r; };

test('exact four-field shape; no redundant bookkeeping or model family/abstention branch', () => {
  const c = capture(), prepared = prepareSemanticCore(c, { nowMs });
  assert.deepEqual(Object.keys(prepared.request.format.properties), FIELD_ORDER);
  assert.deepEqual(prepared.request.format.required, FIELD_ORDER);
  assert.ok(!/NO_EVENT|eventFamily|sourceRefs|observerId|presence/.test(JSON.stringify(prepared.request.format)));
  assert.equal(prepared.wire.truncate, false); assert.equal(prepared.wire.stream, false);
  assert.deepEqual(prepared.request.options, c.postBody.options);
  assert.deepEqual(Object.keys(prepared.request.format.properties.roles.items.properties), ['entityId', 'role']);
});

test('self presence, observers, references and classification are computed consistently without model copies', () => {
  const p = ordinary(), before = JSON.stringify(p), r = valid(p);
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(r.reconstructed.participants, ['cy']);
  assert.deepEqual(r.reconstructed.presence, [{ actorId: 'cy', mode: 'SELF', sourceRef: null }]);
  assert.deepEqual(r.reconstructed.sourceRefs, ['state:current', 'origin:current', 'channel:cy-direct', 'actor:cy']);
  assert.equal(r.candidate.eventFamily, 'WING_ACTIVITY'); assert.deepEqual(r.proposal.objects, []);
  assert.equal(r.candidate.objective.summary, p.occurrence); assert.equal(r.candidate.observations[0].summary, p.occurrence);
  for (const extra of ['actors', 'sourceRefs', 'presence', 'classification']) invalid({ ...p, [extra]: [] }, /INVALID_CORE_FIELDS/);
});

test('ordinary anonymous adjacent activity remains unidentified and does not create an actor/store', () => {
  const p = anonymous(), r = valid(p);
  assert.deepEqual(r.reconstructed.participants, ['cy']);
  assert.equal(r.reconstructed.access, 'CY_PARTIAL_HEARD'); assert.equal(r.reconstructed.originLocation, 'landing');
  assert.ok(r.reconstructed.sourceRefs.includes('actor:cy')); // Derived observer provenance, not model bookkeeping.
  assert.deepEqual(r.compatibilityExceptions.map(x => x.code), ['OBJECTIVE_LOCATION_CONTRADICTION']);
  assert.equal(r.proposal.eventFamily, 'OVERHEARD_ACTIVITY'); assert.equal(r.applied, false);
  p.occurrence = 'Cy hears a voice but cannot see anyone on the landing.'; valid(p);
});

test('calling Ping does not establish Ping or Root as the speaker/present actor', () => {
  const p = anonymous(); p.occurrence = "Cy hears an unidentified voice calling out 'Reg' on the landing.";
  p.roles.push({ entityId: 'reg', role: 'MENTIONED_ONLY' });
  const r = valid(p); assert.deepEqual(r.reconstructed.participants, ['cy']);
  assert.ok(r.compatibilityExceptions.some(e => e.rule === 'EXPLICIT_MENTION_IS_NOT_PRESENCE'));
  p.roles[1].role = 'ACTOR'; invalid(p, /UNREALIZED_ROLE|UNSUPPORTED_AUDIBLE_IDENTITY/);
});

test('quoted self-name and explicit self-introduction count without exact duplicated regex prose', () => {
  for (const text of ["Reg calls out 'Reg' on the landing.", 'Reg introduces himself on the landing.',
    'A voice says "I am Reg" on the landing.']) {
    const p = named(); p.occurrence = text; const r = valid(p);
    assert.deepEqual(r.reconstructed.participants.sort(), ['cy', 'reg']);
    assert.equal(r.reconstructed.presence.find(e => e.actorId === 'reg').mode, 'AUDIBLY_IDENTIFIES');
    assert.ok(r.reconstructed.sourceRefs.includes('actor:reg'));
    assert.ok(r.reconstructed.sourceRefs.includes('actor:cy'));
  }
});

test('name roster, familiar-sounding voice and footsteps are not voice-identity evidence', () => {
  for (const text of ['Reg hums on the landing.', "Cy hears Reg's voice on the landing.",
    "Cy recognises Reg's familiar voice on the landing.", 'Reg approaches the cell door.']) {
    const p = named(); p.occurrence = text; invalid(p, /SELF_IDENTIFICATION_REQUIRED|INMATE_ROUTE/);
  }
  const p = named(); p.roles[0].entityId = 'bill'; invalid(p, /UNDECLARED_ENTITY|UNREALIZED_ROLE/);
});

test('permitted officer arrival establishes new presence; eligibility does not supply standing presence', () => {
  const r = valid(arrival()); assert.equal(r.reconstructed.presence.find(e => e.actorId === 'locke').mode, 'ARRIVES');
  const p = arrival(); p.occurrence = 'Mr Locke is standing in the cell.'; invalid(p, /NEW_PRESENCE_NOT_ESTABLISHED/);
  p.roles[0].entityId = 'bill'; p.occurrence = 'Bill arrives in the cell.'; invalid(p, /ARRIVAL_NOT_AUTHORISED/);
});

test('inadmissible/ambiguous movement and visibility are rejected rather than repaired', () => {
  let p = named(); p.occurrence = "Reg calls out 'Reg' and approaches the cell door.";
  invalid(p, /INMATE_ROUTE|PRODUCTION_VALIDATION/); // Conjoined approach must not evade route checking.
  p = anonymous(); p.occurrence = 'Cy sees someone on the landing.'; invalid(p, /HEARING_CLAIMS_VISIBILITY/);
  p = anonymous(); p.occurrence = 'Cy hears footsteps in the library.'; invalid(p, /UNSUPPORTED_REMOTE_LOCATION/);
  p = ordinary(); p.occurrence = 'Cy leaves the cell.'; invalid(p, /CY_LOCATION_CHANGE/);
  p = arrival(); p.occurrence = 'Mr Locke approaches the cell door, but Cy cannot see him.'; invalid(p, /DIRECT_VISIBILITY_CONTRADICTION/);
  p = arrival(); p.occurrence = 'Mr Locke approaches the cell door and calls a lockdown.'; invalid(p, /UNAVAILABLE_REGIME_OR_CUSTODY_OPERATION/);
  p = ordinary(); p.occurrence = 'Cy hears nothing.'; invalid(p, /NO_CONCRETE_OCCURRENCE/);
});

test('role/prose disagreement, decorative actors, unknown actors and unlisted property fail closed', () => {
  const p = ordinary(); p.occurrence = 'Bill calls out his own name on the landing.'; invalid(p, /UNDECLARED_ENTITY/);
  const q = ordinary(); q.roles.push({ entityId: 'bill', role: 'ACTOR' }); invalid(q, /UNREALIZED_ROLE/);
  const r = arrival(); r.occurrence = 'Nigel approaches the cell door.'; invalid(r, /UNKNOWN_PROSE_ACTOR/);
  for (const text of ['Cy holds a guitar.', 'Cy reads a note.', 'Cy picks up a parcel.', 'Cy strums a xylophone.']) {
    const s = ordinary(); s.occurrence = text; invalid(s, /UNAVAILABLE_PROPERTY|UNLISTED_HANDLED|UNLISTED_INTRODUCED/);
  }
  const extra = ordinary(); extra.occurrence = 'Cy taps his fingers while an officer approaches.';
  invalid(extra, /UNDECLARED_ANONYMOUS_ACTOR/);
  const second = arrival(); second.occurrence += ' Another officer approaches.';
  invalid(second, /UNKNOWN_PROSE_ACTOR|UNDECLARED_ANONYMOUS_ACTOR/);
  const unavailable = ordinary(); unavailable.effectChoiceId = 'fx:invented'; invalid(unavailable, /UNAVAILABLE_EFFECT/);
  const contradictSelf = ordinary(); contradictSelf.roles[0].role = 'MENTIONED_ONLY';
  invalid(contradictSelf, /MENTION_AS_ACTOR:cy/);
  const wrongRole = named(); wrongRole.roles[0].role = 'ADDRESSEE';
  invalid(wrongRole, /NONACTING_ROLE_AS_ACTOR:reg/);
});

test('old source/identity observations cannot be discarded to manufacture acceptance', () => {
  const p = anonymous(); const text = p.occurrence;
  invalid(p, /HEARING_CLAIMS_VISIBILITY/, undefined, { constraints: ['Cy directly observes someone in the cell.'] });
  assert.equal(p.occurrence, text);
});

test('historical claims need actual evidence, not arbitrary source refs or model beliefs', () => {
  const c = capture(); c.recentWorldHistory.push({ id: 'old:1', timestamp: '2026-10-13T20:30:00Z',
    eventFamily: 'CUSTODY', summary: 'The lockdown was lifted.', cyObserved: true });
  let p = ordinary(); p.occurrence = 'The lockdown was lifted.'; invalid(p, /HISTORICAL_RECORD_REPLAY/, c);
  p = arrival(); p.occurrence = 'Mr Locke approaches the cell door and says he stole a photo yesterday.';
  invalid(p, /UNAVAILABLE_PROPERTY|UNSUPPORTED_HISTORY/, c);
  p = arrival(); p.occurrence = 'Mr Locke approaches the cell door and says the lockdown was lifted earlier.';
  invalid(p, /UNSUPPORTED_HISTORY/, c);
  p = arrival(); p.occurrence = 'Mr Locke approaches the cell door and recalls an earlier fact: "The lockdown was lifted."';
  const r = valid(p, c); assert.ok(r.reconstructed.sourceRefs.includes('event:old:1'));
  c.recentWorldHistory[0].cyObserved = false;
  invalid(p, /UNOBSERVED_HISTORY_CANNOT_ENTER_CY_KNOWLEDGE/, c);
});

test('available object operation uses a bounded choice; nonexistent/undeclared effects are not inferred', () => {
  const c = capture(); c.worldSimulation.objects.push({ id: 'note:1', type: 'note', name: 'paper note',
    ownerId: 'cy', holderId: 'cy', status: 'ACTIVE', location: 'cell' });
  const prepared = prepareSemanticCore(c, { nowMs });
  const fx = prepared.packet.effectChoices.find(e => e.objectId === 'note:1' && e.operation === 'TRANSFER' && e.holderId === 'locke');
  const p = arrival(); p.roles.push({ entityId: 'note:1', role: 'TARGET' });
  p.occurrence = 'Mr Locke approaches the cell door. Cy hands the note to Mr Locke.';
  p.effectChoiceId = fx.id;
  const r = valid(p, c); assert.equal(r.proposal.objects[0].holderId, 'locke');
  p.effectChoiceId = null; invalid(p, /UNDECLARED_PROPERTY_EFFECT/, c);
});

function receipt(req) { return { method: TOKENIZER_METHOD, model: req.model, requestFingerprint: fingerprint(req),
  inputTokens: 2000, effectiveContext: 3072, outputAllowance: 420 }; }
test('exact preflight is mandatory; one callback receives truncate:false and unchanged sampler', async () => {
  const c = capture(); let calls = 0;
  const r = await runSemanticAttempt({ capture: c, nowMs, admitted: true,
    preflight: req => receipt(req), generate: wire => {
      calls++; assert.equal(wire.truncate, false); assert.deepEqual(wire.options, c.postBody.options);
      return JSON.stringify(ordinary());
    } });
  assert.equal(calls, 1); assert.equal(r.evaluation.valid, true, r.reason); assert.equal(r.repairCalls, 0);
  for (const preflight of [undefined, req => ({ ...receipt(req), inputTokens: 3000 })]) {
    const fail = await runSemanticAttempt({ capture: c, nowMs, admitted: true, preflight,
      generate: () => { calls++; throw new Error('MUST_NOT_RUN'); } });
    assert.equal(fail.generateInvocations, 0); assert.match(fail.reason, /TOKEN_PREFLIGHT/);
  }
});

test('no repair/replacement after invalid output, timeout or cancellation; stale capture fails', async () => {
  let calls = 0; const c = capture();
  const bad = await runSemanticAttempt({ capture: c, nowMs, admitted: true, preflight: receipt,
    generate: () => { calls++; return '{bad'; } });
  assert.equal(bad.generateInvocations, 1); assert.equal(calls, 1); assert.equal(bad.evaluation.valid, false);
  const timed = await runSemanticAttempt({ capture: c, nowMs, admitted: true, preflight: receipt,
    timeoutMs: 5, generate: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('TIMEOUT')))) });
  assert.equal(timed.reason, 'TIMEOUT'); assert.equal(timed.generateInvocations, 1);
  const changed = structuredClone(c); changed.currentLocation = 'landing';
  const stale = await runSemanticAttempt({ capture: c, nowMs, admitted: true, preflight: receipt,
    getCurrentCapture: () => changed, generate: () => { throw new Error('MUST_NOT_RUN'); } });
  assert.equal(stale.reason, 'STALE_CAPTURE'); assert.equal(stale.generateInvocations, 0);
  let reads = 0;
  const duringPreflight = await runSemanticAttempt({ capture: c, nowMs, admitted: true, preflight: receipt,
    getCurrentCapture: () => ++reads === 1 ? c : changed,
    generate: () => { throw new Error('MUST_NOT_RUN'); } });
  assert.equal(duringPreflight.reason, 'STALE_CAPTURE'); assert.equal(duringPreflight.generateInvocations, 0);
  const cancel = new AbortController(); cancel.abort();
  const cancelled = await runSemanticAttempt({ capture: c, nowMs, admitted: true, signal: cancel.signal,
    preflight: receipt, generate: () => { throw new Error('MUST_NOT_RUN'); } });
  assert.equal(cancelled.reason, 'CANCELLED'); assert.equal(cancelled.generateInvocations, 0);
});

test('real nine-output fixture replay preserves both prose accounts and never chooses a winning identity', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/semantic-core-corrected-output-regression.json', import.meta.url), 'utf8'));
  const c = capture(); c.plausibleCastIds = ['cy', ...CAST, ...OFFICERS].map(a => typeof a === 'string' ? a : a.key);
  const rows = fixture.samples.map(s => ({ index: s.index, reason: s.previousReason, evaluation: { parsed: s.proposal } }));
  const before = JSON.stringify(rows);
  const replay = replayLegacy(c, nowMs, rows);
  assert.equal(JSON.stringify(rows), before); assert.equal(replay.length, 9);
  assert.ok(replay.every(r => r.evaluation.valid === false && r.textChanged === false));
  assert.ok(replay.every(r => r.reconstructionAttempted === true));
  assert.deepEqual(replay.map(r => r.index), [2,3,4,5,6,7,8,9,10]);
  for (const r of replay) {
    const old = rows.find(s => s.index === r.index).evaluation.parsed;
    assert.equal(r.unchangedOccurrence, old.occurrence.summary);
    assert.equal(r.unchangedObservation, old.observation.summary);
    assert.equal(r.core.occurrence, old.occurrence.summary);
    assert.ok(!/SOURCE_REFS|PRESENCE_RECORDS_REQUIRED/.test(r.evaluation.reason));
  }
  assert.match(replay.find(r => r.index === 2).evaluation.reason, /IDENTITY_CONFLICT:bill/);
  assert.match(replay.find(r => r.index === 8).evaluation.reason, /SELF_IDENTIFICATION_REQUIRED:bill/);
  assert.match(replay.find(r => r.index === 9).evaluation.reason, /UNDECLARED_ENTITY:keyes/);
});

test('drought only affects diagnostic capture state, never the semantic request', () => {
  const c = capture(), original = prepareSemanticCore(c, { nowMs });
  c.worldSimulation.recentAccepted = Array.from({ length: 12 }, (_, i) => ({
    id: `event:${i}`, occurredAt: new Date(nowMs - (i + 1) * 3600000).toISOString(),
    objects: [], thread: { action: 'NONE' } }));
  const next = prepareSemanticCore(c, { nowMs });
  // Packet fingerprint is expected to reflect different canonical input, not a demand for effects.
  assert.equal(next.request.format.properties.effectChoiceId.enum.length, 1);
  assert.deepEqual(next.request.format, original.request.format);
  assert.ok(!/must.*durable|require.*object effect|drought/i.test(next.request.prompt));
});

const bundle = process.env.CY_REHEARSAL_CAPTURE || 'C:/cy-rehearsal/leno-awg-capture-20261013';
test('real frozen request retains sampler/code, fits exact token budget, and cannot run inference', {
  skip: !fs.existsSync(bundle) ? 'Requires local verified metadata/capture only' : false,
}, () => {
  const { capture: c, nowMs: when } = readVerifiedCapture(bundle);
  const prepared = prepareSemanticCore(c, { nowMs: when });
  assert.deepEqual(prepared.request.format, JSON.parse(fs.readFileSync(new URL('../../docs/rehearsal/semantic-core-schema.json', import.meta.url), 'utf8')));
  const count = exactContextPreflight(prepared.request);
  assert.equal(count.initialTruncation, false); assert.ok(count.spareAfterFullOutput >= 300);
  assert.deepEqual(prepared.request.options, c.postBody.options);
  const production = fs.readFileSync(fileURLToPath(new URL('../../runner/run.js', import.meta.url)), 'utf8');
  assert.ok(!production.includes('semantic-core.mjs'));
  assert.equal(count.inferenceExecuted, false); assert.equal(count.serverStarted, false);
});

test('preparation CLI has no send mode and refuses unapproved network/host arguments offline', () => {
  const cli = fileURLToPath(new URL('./prepare-semantic-core.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--run', 'http://127.0.0.1:11434'], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /no inference mode exists/);
});
