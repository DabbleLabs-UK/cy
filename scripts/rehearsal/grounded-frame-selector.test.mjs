import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildGroundedFrames, prepareFrameSelector, evaluateFrameSelection, runFrameSelectorAttempt,
  DOMAINS, FIELD_ORDER, UTTERANCE_PATTERN } from './grounded-frame-selector.mjs';
import { fingerprint } from './grounded-occurrence.mjs';
import { readVerifiedCapture } from './prepare-grounded-occurrence.mjs';
import { TOKENIZER_METHOD, exactContextPreflight } from './one-call-context-budget.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const nowMs = Date.parse('2026-10-13T20:58:28.359Z');
const fixture = () => ({ model: 'FAKE_NO_PROVIDER', currentLocation: 'cell', plausibleCastIds: ['cy', 'bill', 'reg', 'locke'],
  locationRegime: { current: { id: 'CELL', regime_activity: 'CELL_TIME', source_event_id: 'location:1' } },
  worldSimulation: { objects: [], threads: [], recentAccepted: [], recentRuns: [] }, recentWorldHistory: [],
  postBody: { options: { temperature: 0.65, top_p: 0.9, repeat_penalty: 1.1, repeat_last_n: 128,
    num_ctx: 3072, num_predict: 420, num_thread: 4 } } });
function select(capture, domain, content) {
  const bound = buildGroundedFrames(capture, { nowMs });
  return { bound, raw: JSON.stringify({ frameId: bound.frames.find(f => f.operationDomain === domain).frameId, content }) };
}
function evaluate(content, domain = DOMAINS[0], c = fixture(), extra = {}) {
  const { bound, raw } = select(c, domain, content);
  return evaluateFrameSelection(c, bound, raw, { nowMs, ...extra });
}
const expectValid = (...args) => { const result = evaluate(...args); assert.equal(result.valid, true, result.reason); return result; };
const expectInvalid = (content, domain, reason, c) => {
  const result = evaluate(content, domain, c); assert.equal(result.valid, false); assert.match(result.reason, reason); return result;
};

test('exact three domains; eligible roster never creates a named NPC, object or thread frame', () => {
  const c = fixture(), b = buildGroundedFrames(c, { nowMs });
  assert.deepEqual(b.frames.map(f => f.operationDomain), DOMAINS);
  assert.ok(Object.isFrozen(b) && Object.isFrozen(b.frames) && Object.isFrozen(b.frames[0].semanticRoles));
  assert.throws(() => { b.frames[0].identity.status = 'BILL'; }, TypeError);
  for (const f of b.frames) {
    assert.equal(f.stateFingerprint, b.stateFingerprint); assert.ok(f.frameId.includes(b.stateFingerprint.slice(0, 16)));
    assert.deepEqual(f.relevantRevisions, b.relevantRevisions); assert.deepEqual(f.permittedEffects, []);
    assert.equal(f.permittedPresenceTransition.relocateCy, false); assert.equal(f.permittedPresenceTransition.others, 'NONE');
    assert.ok(f.prerequisiteRefs.includes('state:current') && f.prerequisiteRefs.includes('actor:cy'));
    assert.ok(!JSON.stringify(f).includes('actor:bill'));
  }
  const before = JSON.stringify(c); prepareFrameSelector(c, { nowMs }); assert.equal(JSON.stringify(c), before);
});

test('stable bindings and frame IDs change on authoritative revision, location, history or time changes', () => {
  const c = fixture(), b = buildGroundedFrames(c, { nowMs });
  assert.deepEqual(b, buildGroundedFrames(structuredClone(c), { nowMs }));
  for (const mutate of [
    d => { d.locationRegime.current.source_event_id = 'location:2'; },
    d => { d.worldSimulation.objects.push({ id: 'object:1', status: 'CONFISCATED', revision: 2, transitionId: '11111111-1111-4111-8111-111111111111' }); },
    d => { d.worldSimulation.threads.push({ id: 'thread:1', state: 'RESOLVED', revision: 3, transitionId: '22222222-2222-4222-8222-222222222222' }); },
    d => { d.recentWorldHistory.push({ id: 'historical:1', summary: 'Old record' }); },
  ]) {
    const changed = structuredClone(c); mutate(changed);
    const next = buildGroundedFrames(changed, { nowMs });
    assert.notEqual(next.stateFingerprint, b.stateFingerprint);
    assert.ok(next.frames.every(f => !b.frames.some(old => old.frameId === f.frameId)));
  }
  assert.notEqual(buildGroundedFrames(c, { nowMs: nowMs + 1 }).stateFingerprint, b.stateFingerprint);
});

test('dynamic geometry removes adjacent frames outside cell; unavailable regimes make zero frames', () => {
  const c = fixture(); c.currentLocation = 'exercise_yard'; c.locationRegime.current.id = 'EXERCISE_YARD';
  assert.deepEqual(buildGroundedFrames(c, { nowMs }).frames.map(f => f.operationDomain), ['CY_IN_PLACE']);
  expectValid({ operationId: 'SHIFT_WEIGHT' }, 'CY_IN_PLACE', c);
  for (const key of ['searchEpisode', 'lockdownEpisode']) {
    const d = fixture(); d.locationRegime[key] = { id: key, status: 'ACTIVE' };
    assert.equal(buildGroundedFrames(d, { nowMs }).frames.length, 0);
    assert.equal(prepareFrameSelector(d, { nowMs }).request, null);
  }
});

test('schema is frameId -> content, with exact frame-specific slots, no occurrence or abstention branch', () => {
  const p = prepareFrameSelector(fixture(), { nowMs });
  assert.equal(p.request.format.oneOf.length, 3);
  for (const branch of p.request.format.oneOf) {
    assert.deepEqual(Object.keys(branch.properties), FIELD_ORDER);
    assert.deepEqual(branch.required, FIELD_ORDER); assert.equal(branch.additionalProperties, false);
    assert.equal(branch.properties.content.additionalProperties, false);
  }
  assert.deepEqual(Object.keys(p.request.format.oneOf[0].properties.content.properties), ['operationId', 'modifier']);
  assert.deepEqual(Object.keys(p.request.format.oneOf[1].properties.content.properties), ['operationId', 'detail']);
  assert.deepEqual(Object.keys(p.request.format.oneOf[2].properties.content.properties), ['utterance']);
  assert.equal(p.request.format.oneOf[2].properties.content.properties.utterance.pattern, UTTERANCE_PATTERN);
  assert.ok(!/NO_EVENT|eventFamily|sourceRefs|observerId|occurrence/.test(JSON.stringify(p.request.format)));
  assert.equal(p.wire.truncate, false); assert.equal(p.wire.stream, false);
  assert.deepEqual(p.request.options, fixture().postBody.options);
});

test('bodily operations compile from bounded choices without relocating Cy or inventing property', () => {
  for (const operationId of ['SHIFT_WEIGHT', 'STRETCH_HANDS', 'TAP_FINGERS']) {
    for (const modifier of [undefined, null, 'SLOWLY', 'BRIEFLY']) {
      const r = expectValid({ operationId, ...(modifier === undefined ? {} : { modifier }) });
      assert.deepEqual(r.reconstructed.participants, ['cy']); assert.equal(r.reconstructed.identity.status, 'KNOWN_SELF');
      assert.equal(r.reconstructed.access, 'CY_DIRECT'); assert.equal(r.reconstructed.originLocation, 'cell');
      assert.equal(r.candidate.location, 'cell'); assert.deepEqual(r.proposal.objects, []);
      assert.deepEqual(r.proposal.informationClaims, []); assert.equal(r.proposal.thread.action, 'NONE');
      assert.deepEqual(r.compatibilityExceptions, []); assert.equal(r.legacyValidation.valid, true);
    }
  }
  const r = expectValid({ operationId: 'TAP_FINGERS', modifier: 'BRIEFLY' });
  assert.equal(r.reconstructed.occurrence, 'Cy briefly taps his fingers against his palm in the cell.');
  for (const operationId of ['LEAVE_CELL', 'APPROACH_BILL', 'OPEN_DOOR', 'READ_PHOTO', 'CONFISCATE', 'SHIFT_WEIGHT; Cy leaves'])
    expectInvalid({ operationId }, DOMAINS[0], /UNAVAILABLE_BODILY_OPERATION/);
});

test('non-verbal activity remains unidentified, audible only, with no NPC movement/presence assertion', () => {
  for (const operationId of ['FOOTSTEPS', 'KNOCKING', 'COUGHING']) for (const detail of [undefined, null, 'FAINT', 'BRIEF', 'IRREGULAR']) {
    const r = expectValid({ operationId, ...(detail === undefined ? {} : { detail }) }, DOMAINS[1]);
    assert.deepEqual(r.reconstructed.participants, ['cy']); assert.equal(r.reconstructed.identity.status, 'UNIDENTIFIED');
    assert.equal(r.reconstructed.originLocation, 'landing'); assert.equal(r.reconstructed.observerLocation, 'cell');
    assert.equal(r.reconstructed.access, 'CY_PARTIAL_HEARD');
    assert.deepEqual(r.reconstructed.presence, [{ actorId: 'cy', mode: 'SELF' }]);
    assert.equal(r.legacyValidation.valid, true); assert.deepEqual(r.legacyValidation.errors, []);
    assert.deepEqual(r.compatibilityExceptions, []);
  }
  expectInvalid({ operationId: 'BILLS_FOOTSTEPS' }, DOMAINS[1], /UNAVAILABLE_ACOUSTIC/);
  expectInvalid({ operationId: 'FOOTSTEPS', detail: 'FAMILIAR_REG' }, DOMAINS[1], /UNAVAILABLE_ACOUSTIC_DETAIL/);
});

test('compositional anonymous utterances preserve exact text and are not world facts or named participants', () => {
  for (const utterance of ['hello', 'hello there!', 'anyone still awake?', 'is anybody else there?',
    'hello, anyone still awake?', 'oi! can someone out there answer me?', "i'm still here.", "who's there?",
    'could you hear me please?', 'is somebody listening out there?']) {
    const r = expectValid({ utterance }, DOMAINS[2]);
    assert.equal(r.reconstructed.heardUtterance, utterance); assert.equal(r.reconstructed.utteranceIsWorldFact, false);
    assert.equal(r.reconstructed.identity.status, 'UNIDENTIFIED'); assert.deepEqual(r.reconstructed.participants, ['cy']);
    assert.equal(r.reconstructed.semanticRoles.speaker.entityId, null); assert.equal(r.reconstructed.semanticRoles.addressee, null);
    assert.deepEqual(r.proposal.informationClaims, []); assert.deepEqual(r.proposal.objects, []);
    assert.equal(r.reconstructed.occurrence, `Cy hears an unidentified voice say "${utterance}" from the landing.`);
    assert.ok(!r.compatibilityExceptions.some(e => e.rule === 'EXPLICIT_MENTION_IS_NOT_PRESENCE'));
  }
});

test('whole utterance is rejected for identity, property, history, instructions or hidden/contradictory actions', () => {
  for (const utterance of ["i'm bill", 'i am reg', 'root is here', 'mr keyes took the item',
    'i recognise that familiar voice', 'i have a photo', 'i took it yesterday', 'someone is hiding something',
    'root approaches the cell', 'open the door', 'hello, unlock the cell', 'hello! anyone still awake? cy leaves',
    'cy spoke to me earlier', 'there are 47 tiles', 'hello | im end >', 'hello &amp;', 'hello\nanyone there?',
    'hello "can anyone hear me?"', 'can anyone hear me? then leave the cell', 'hello, i am nigel',
    'hello. i am here. i stole a knife', 'Hello', 'i can see bill on the landing']) {
    const r = expectInvalid({ utterance }, DOMAINS[2], /UTTERANCE/);
    assert.equal(r.parsed.content.utterance, utterance); assert.equal(r.reconstructed, null);
  }
});

test('no free summary, roles, observer, source refs, effects or family accepted in any content/top-level field', () => {
  const c = fixture(), { bound, raw } = select(c, DOMAINS[0], { operationId: 'SHIFT_WEIGHT' });
  for (const key of ['occurrence', 'participants', 'speakerId', 'addressee', 'origin', 'access', 'sourceRefs', 'presence', 'effects', 'classification']) {
    const p = JSON.parse(raw); p[key] = 'Bill approaches';
    assert.equal(evaluateFrameSelection(c, bound, JSON.stringify(p), { nowMs }).valid, false);
    const q = JSON.parse(raw); q.content[key] = 'Bill approaches';
    assert.match(evaluateFrameSelection(c, bound, JSON.stringify(q), { nowMs }).reason, /CONTENT_FIELDS/);
  }
  expectInvalid({ operationId: 'SHIFT_WEIGHT', modifier: 'quickly and leave the cell' }, DOMAINS[0], /UNAVAILABLE_BODILY_MODIFIER/);
  expectInvalid({ modifier: 'SLOWLY', operationId: 'SHIFT_WEIGHT' }, DOMAINS[0], /PROPERTY_ORDER/);
});

test('unknown/stale frame, altered bound fields, and duplicate JSON keys fail without discarded contradictions', () => {
  const c = fixture(), { bound, raw } = select(c, DOMAINS[0], { operationId: 'SHIFT_WEIGHT' });
  const p = JSON.parse(raw); p.frameId += ':stale';
  assert.match(evaluateFrameSelection(c, bound, JSON.stringify(p), { nowMs }).reason, /UNKNOWN_OR_STALE_FRAME_ID/);
  const duplicate = raw.replace('"operationId":"SHIFT_WEIGHT"', '"operationId":"LEAVE_CELL","operationId":"SHIFT_WEIGHT"');
  assert.match(evaluateFrameSelection(c, bound, duplicate, { nowMs }).reason, /DUPLICATE_JSON_KEY/);
  for (const mutate of [b => { b.frames[0].permittedEffects.push('TRANSFER'); }, b => { b.frames[0].identity.status = 'BILL'; },
    b => { b.frames[0].observationChannel.access = 'WORLD_ONLY'; }, b => { b.frames[0].contentSlotSchema.additionalProperties = true; }]) {
    const changed = structuredClone(bound); mutate(changed);
    assert.match(evaluateFrameSelection(c, changed, raw, { nowMs }).reason, /TAMPERED_FRAME_SET/);
  }
  const changed = structuredClone(c); changed.worldSimulation.objects.push({ id: 'o:1', revision: 2 });
  assert.match(evaluateFrameSelection(c, bound, raw, { nowMs, currentCapture: changed }).reason, /STALE_STATE_OR_REVISIONS/);
  assert.match(evaluateFrameSelection(c, bound, raw, { nowMs: nowMs + 1 }).reason, /STALE_STATE_OR_REVISIONS/);
});

test('historical material remains excluded from candidate inspiration and model text', () => {
  const c = fixture(); c.recentWorldHistory.push({ id: 'old:1', timestamp: '2026-10-13T20:30:00Z',
    eventFamily: 'CUSTODY', summary: 'Mr Sweep removed a photo.', cyObserved: true });
  const p = prepareFrameSelector(c, { nowMs });
  assert.equal(p.bound.historyPolicy.retainedFacts, 1);
  assert.equal(p.bound.historyPolicy.candidatePrerequisitesFromHistory, 0);
  assert.ok(!/Mr Sweep|removed a photo|old:1/.test(p.request.prompt));
  assert.ok(p.bound.frames.every(f => !f.prerequisiteRefs.some(r => r.startsWith('event:'))));
  expectInvalid({ utterance: 'mr sweep removed a photo' }, DOMAINS[2], /UTTERANCE/, c);
});

test('exact and near-repeat guards still execute downstream; no frame rotation/durability policy added', () => {
  const c = fixture(); const first = expectValid({ operationId: 'TAP_FINGERS' }, DOMAINS[0], c);
  const repeated = structuredClone(c);
  repeated.worldSimulation.recentAccepted.push({ id: 'old:1', occurredAt: new Date(nowMs - 3600000).toISOString(),
    signature: first.candidate.objective.summary.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() });
  expectInvalid({ operationId: 'TAP_FINGERS' }, DOMAINS[0], /DUPLICATE_EVENT/, repeated);
  const recent = structuredClone(c); recent.recentWorldHistory.push({ id: 'world:1', eventFamily: 'WING_ACTIVITY',
    timestamp: new Date(nowMs - 3600000).toISOString(), summary: first.candidate.objective.summary, participants: ['cy'] });
  expectInvalid({ operationId: 'TAP_FINGERS' }, DOMAINS[0], /RECENT_NEAR_DUPLICATE/, recent);
  c.worldSimulation.recentAccepted = Array.from({ length: 10 }, (_, i) => ({ occurredAt: new Date(nowMs - (i + 8) * 3600000).toISOString(), objects: [], thread: { action: 'NONE' } }));
  assert.deepEqual(prepareFrameSelector(c, { nowMs }).request.format.oneOf.map(b => Object.keys(b.properties.content.properties)),
    prepareFrameSelector(fixture(), { nowMs }).request.format.oneOf.map(b => Object.keys(b.properties.content.properties)));
  expectValid({ operationId: 'SHIFT_WEIGHT' }, DOMAINS[0], c);
});

const receipt = req => ({ method: TOKENIZER_METHOD, model: req.model, requestFingerprint: fingerprint(req),
  inputTokens: 1600, effectiveContext: 3072, outputAllowance: req.options.num_predict });
test('mandatory preflight before single complete wire callback; options, truncate:false and no repair unchanged', async () => {
  const c = fixture(), prepared = prepareFrameSelector(c, { nowMs }); let calls = 0;
  const r = await runFrameSelectorAttempt({ capture: c, nowMs, admitted: true, preflight: receipt,
    generate: wire => { calls++; assert.deepEqual(wire, prepared.wire); assert.equal(wire.truncate, false);
      return select(c, DOMAINS[0], { operationId: 'SHIFT_WEIGHT' }).raw; } });
  assert.equal(calls, 1); assert.equal(r.evaluation.valid, true, r.reason);
  assert.equal(r.generateInvocations, 1); assert.equal(r.repairCalls, 0); assert.equal(r.replacementCalls, 0);
  for (const preflight of [undefined, req => ({ ...receipt(req), inputTokens: 3000 }), () => { throw new Error('TRUNCATION'); }]) {
    const failure = await runFrameSelectorAttempt({ capture: c, nowMs, admitted: true, preflight,
      generate: () => { throw new Error('MUST_NOT_SEND'); } });
    assert.equal(failure.generateInvocations, 0);
  }
});

test('no admission/no frames, stale state at waits, invalid output, cancellation and timeout make no replacement', async () => {
  const c = fixture(); let calls = 0; const generate = () => { calls++; return '{bad'; };
  const denied = await runFrameSelectorAttempt({ capture: c, nowMs, admitted: false, preflight: receipt, generate });
  assert.equal(denied.generateInvocations, 0);
  const unavailable = fixture(); unavailable.locationRegime.lockdownEpisode = { status: 'ACTIVE' };
  const empty = await runFrameSelectorAttempt({ capture: unavailable, nowMs, admitted: true, preflight: receipt, generate });
  assert.equal(empty.reason, 'NO_AVAILABLE_FRAMES'); assert.equal(empty.generateInvocations, 0);
  const invalid = await runFrameSelectorAttempt({ capture: c, nowMs, admitted: true, preflight: receipt, generate });
  assert.equal(invalid.generateInvocations, 1); assert.equal(invalid.evaluation.valid, false); assert.equal(calls, 1);
  const changed = fixture(); changed.locationRegime.current.source_event_id = 'new:1'; let reads = 0;
  for (const changedAt of [1, 2, 3]) {
    reads = 0;
    const stale = await runFrameSelectorAttempt({ capture: c, nowMs, admitted: true, preflight: receipt,
      getCurrentCapture: () => ++reads >= changedAt ? changed : c,
      generate: () => select(c, DOMAINS[0], { operationId: 'SHIFT_WEIGHT' }).raw });
    assert.match(stale.reason, /STALE/); assert.equal(stale.generateInvocations, changedAt === 3 ? 1 : 0);
  }
  const controller = new AbortController(); controller.abort();
  const cancelled = await runFrameSelectorAttempt({ capture: c, nowMs, admitted: true, preflight: receipt, generate, signal: controller.signal });
  assert.equal(cancelled.generateInvocations, 0);
  const timed = await runFrameSelectorAttempt({ capture: c, nowMs, admitted: true, preflight: receipt, timeoutMs: 5,
    generate: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('TIMEOUT')))) });
  assert.equal(timed.reason, 'TIMEOUT'); assert.equal(timed.generateInvocations, 1);
  assert.equal(timed.repairCalls, 0); assert.equal(timed.replacementCalls, 0);
});

const capturePath = process.env.CY_AWG_CAPTURE || 'C:/cy-rehearsal/leno-awg-capture-20261013';
test('verified real frozen capture has EXACT three frames, preserved records, and all test-only renderer fixtures compile',
  { skip: !fs.existsSync(path.join(capturePath, 'SHA256SUMS.txt')) }, () => {
    const { capture, nowMs: capturedNow, proof } = readVerifiedCapture(capturePath);
    const p = prepareFrameSelector(capture, { nowMs: capturedNow });
    assert.deepEqual(p.bound.frames.map(f => f.operationDomain), DOMAINS);
    assert.equal(p.bound.historyPolicy.retainedFacts, 11); assert.equal(proof.productionCodeModified, false);
    assert.ok(!p.request.prompt.includes('no eggs') && !p.request.prompt.includes('Keyes demanded'));
    const examples = JSON.parse(fs.readFileSync(new URL('./fixtures/frame-selector-renderer-examples.json', import.meta.url), 'utf8'));
    assert.equal(examples.inferenceExecuted, false);
    for (const example of examples.samples) {
      const frame = p.bound.frames.find(f => f.operationDomain === example.domain);
      const r = evaluateFrameSelection(capture, p.bound, JSON.stringify({ frameId: frame.frameId, content: example.content }), { nowMs: capturedNow });
      assert.equal(r.valid, true, r.reason); assert.equal(r.reconstructed.occurrence, example.expectedOccurrence);
    }
  });

test('exact tokenizer/template real preflight remains offline with unchanged profile and output reserve',
  { skip: !fs.existsSync(path.join(capturePath, 'SHA256SUMS.txt')) || !fs.existsSync('C:/cy-rehearsal/models') }, () => {
    const { capture, nowMs: capturedNow } = readVerifiedCapture(capturePath);
    const p = prepareFrameSelector(capture, { nowMs: capturedNow });
    const r = exactContextPreflight(p.request);
    assert.equal(r.fits, true); assert.equal(r.initialTruncation, false); assert.equal(r.effectiveContext, 3072);
    assert.equal(r.outputAllowance, 420); assert.ok(r.spareAfterFullOutput >= 400);
    assert.equal(r.inferenceExecuted, false); assert.equal(r.weightsLoaded, false); assert.equal(r.serverStarted, false);
  });

test('production directories and earlier prototype paths remain byte-identical to the pinned base', () => {
  const result = spawnSync('git', ['diff', '--exit-code', 'aaf8f5a07ca6c955ca7d5f1a62155f0336cdd500', '--',
    'runner', 'public', 'lib', 'config', 'migrations', 'scripts/rehearsal/semantic-core.mjs',
    'scripts/rehearsal/one-call-grounded-proposal.mjs', 'scripts/rehearsal/one-call-context-budget.mjs'],
  { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const files = fs.readdirSync(path.join(root, 'runner')).filter(f => /\.(?:js|mjs)$/.test(f));
  assert.ok(files.every(f => !/grounded-frame-selector/.test(fs.readFileSync(path.join(root, 'runner', f), 'utf8'))));
});
