import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSequentialFrameSession, runTenSequentialAttempts, projectShadowEnvironment } from './sequential-frame-selector.mjs';
import { prepareFrameSelector } from './grounded-frame-selector.mjs';
import { fingerprint } from './grounded-occurrence.mjs';
import { TOKENIZER_METHOD, exactContextPreflight } from './one-call-context-budget.mjs';
import { readVerifiedCapture } from './prepare-grounded-occurrence.mjs';
import { runAmbientWorldCycle, applyAwgCandidate, awgEventToEnvironment } from '../../runner/ambient-world-generator.js';
import { createEnvironmentEvent } from '../../runner/environment-schema.js';

const nowMs = Date.parse('2026-10-13T20:58:28.359Z');
const fixture = () => ({ model: 'FAKE_OFFLINE_ONLY', currentLocation: 'cell', plausibleCastIds: ['cy', 'bill'],
  locationRegime: { current: { id: 'CELL', regime_activity: 'CELL_TIME' } },
  worldSimulation: { objects: [], terminalObjects: [], threads: [], terminalThreads: [], recentAccepted: [], recentRuns: [] },
  recentWorldHistory: [], postBody: { options: { num_ctx: 3072, num_predict: 420,
    temperature: 0.65, top_p: 0.9, repeat_penalty: 1.1, repeat_last_n: 128, num_thread: 4 } } });
const receipt = req => ({ method: TOKENIZER_METHOD, model: req.model, requestFingerprint: fingerprint(req),
  inputTokens: 748, effectiveContext: 3072, outputAllowance: 420 });
const generator = (session, domain, content) => wire => {
  const ticket = session.prepareNext();
  assert.deepEqual(wire, ticket.prepared.wire); assert.equal(wire.truncate, false);
  return JSON.stringify({ frameId: ticket.prepared.bound.frames.find(f => f.operationDomain === domain).frameId, content });
};
const step = (s, domain, content) => s.attempt({ preflight: receipt, generate: generator(s, domain, content) });

test('first request equals untouched frozen prototype; original and returned state cannot be mutated through session', async () => {
  const c = fixture(), before = fingerprint(c), session = createSequentialFrameSession(c, { nowMs });
  assert.deepEqual(session.prepareNext().prepared, prepareFrameSelector(c, { nowMs }));
  session.snapshot().currentLocation = 'landing';
  const ticket = session.prepareNext(); ticket.prepared.request.prompt = 'tampered';
  const r = await step(session, 'CY_IN_PLACE', { operationId: 'TAP_FINGERS' });
  assert.equal(r.wouldAccept, true, r.result.reason);
  assert.equal(fingerprint(c), before);
  r.shadowAfter.worldSimulation.objects.push({ id: 'invented' });
  assert.deepEqual(session.snapshot().worldSimulation.objects, []);
  assert.equal(session.progress().productionApplied, false);
});

test('accepted shadow state uses production apply and exact environment projection, not an invented family', async () => {
  const c = fixture(), session = createSequentialFrameSession(c, { nowMs });
  const r = await step(session, 'ADJACENT_NONVERBAL', { operationId: 'COUGHING' });
  const production = await runAmbientWorldCycle({ state: c.worldSimulation, nowMs,
    currentLocation: 'cell', plausibleCastIds: c.plausibleCastIds, recentEvents: [],
    makeId: prefix => `shadow-${prefix}-01`, generate: () => JSON.stringify(r.result.evaluation.proposal) });
  assert.equal(production.status, 'ACCEPTED');
  const expected = applyAwgCandidate({ ...c.worldSimulation, lastRunAt: new Date(nowMs).toISOString() },
    r.result.evaluation.legacyValidation, { makeId: prefix => `shadow-${prefix}-01`, acceptedAt: new Date(nowMs).toISOString() });
  expected.validationCandidate = r.result.evaluation.candidate;
  const environment = projectShadowEnvironment(expected, { id: 'shadow-env-01', nowMs });
  assert.equal(environment.eventFamily, 'ambient_world');
  assert.equal(expected.event.eventFamily, 'OVERHEARD_ACTIVITY');
  assert.equal(environment.timestamp, '2026-10-13 21:58:28.359');
  const env = awgEventToEnvironment(expected);
  const pureEvent = createEnvironmentEvent(env.archetypeId, { id: environment.id, timestamp: environment.timestamp,
    eventType: env.eventType, world: env.world, observation: { summary: env.summary, ...env.observation } });
  assert.deepEqual(environment.participants, pureEvent.world.context.associated_entities);
  assert.deepEqual(r.shadowUpdate.environment, environment);
  expected.event.environmentEventId = environment.id;
  assert.deepEqual(r.shadowAfter.worldSimulation.recentAccepted, expected.state.recentAccepted);
  assert.deepEqual(r.shadowAfter.worldSimulation.recentAccepted.map(e => ({ ...e, environmentEventId: undefined })),
    production.state.recentAccepted.map(e => ({ ...e, environmentEventId: undefined })));
  assert.deepEqual(r.shadowAfter.worldSimulation.threads, c.worldSimulation.threads);
  assert.equal(r.shadowUpdate.worldEntityRevisionsChanged, false);
});

test('accepted tap/cough feeds exact and near-duplicate checks before the next acceptance, never prompt inspiration', async () => {
  const c = fixture(), s = createSequentialFrameSession(c, { nowMs });
  const first = await step(s, 'CY_IN_PLACE', { operationId: 'TAP_FINGERS' });
  const next = s.prepareNext();
  assert.equal(next.nowMs - first.nowMs, 45 * 60000);
  assert.deepEqual(next.prepared.bound.frames.map(f => f.operationDomain), ['CY_IN_PLACE', 'ADJACENT_NONVERBAL', 'ADJACENT_SPEECH']);
  assert.notEqual(next.prepared.bound.stateFingerprint, first.prepared.bound.stateFingerprint);
  assert.ok(next.prepared.bound.frames.every(f => !first.prepared.bound.frames.some(old => f.frameId === old.frameId)));
  assert.deepEqual(next.feedback.modelVisible.historyMaterial, []);
  assert.ok(!next.prepared.request.prompt.includes(first.result.evaluation.reconstructed.occurrence));
  assert.ok(next.feedback.oldProductionNegativeGuidanceNotSent.includes('AMBIENT_OCCURRENCE'));
  assert.ok(next.requestChanges.reason.includes('ACCEPTED_HISTORY_CHANGED'));
  const repeat = await step(s, 'CY_IN_PLACE', { operationId: 'TAP_FINGERS' });
  assert.equal(repeat.wouldAccept, false);
  assert.ok(repeat.duplicateDecision.errors.includes('DUPLICATE_EVENT'));
  assert.ok(repeat.duplicateDecision.errors.includes('RECENT_NEAR_DUPLICATE'));
  assert.deepEqual(repeat.shadowAfter.recentWorldHistory, first.shadowAfter.recentWorldHistory);
  const varied = await step(s, 'CY_IN_PLACE', { operationId: 'TAP_FINGERS', modifier: 'BRIEFLY' });
  assert.equal(varied.wouldAccept, false); assert.ok(varied.duplicateDecision.errors.includes('RECENT_NEAR_DUPLICATE'));
  assert.equal(varied.shadowAfter.worldSimulation.recentRuns.length, 3);
});

test('speech stays selectable with unchanged grammar; production near-repeat may reject later utterances', async () => {
  const s = createSequentialFrameSession(fixture(), { nowMs });
  await step(s, 'ADJACENT_NONVERBAL', { operationId: 'COUGHING' });
  const speech = await step(s, 'ADJACENT_SPEECH', { utterance: 'hello' });
  assert.equal(speech.wouldAccept, true, speech.result.reason);
  assert.equal(speech.result.evaluation.reconstructed.identity.status, 'UNIDENTIFIED');
  assert.equal(speech.result.evaluation.reconstructed.utteranceIsWorldFact, false);
  const next = s.prepareNext();
  assert.equal(next.prepared.request.format.oneOf.length, 3);
  assert.equal(next.prepared.bound.frames[2].operationDomain, 'ADJACENT_SPEECH');
  const repeat = await step(s, 'ADJACENT_SPEECH', { utterance: 'who is there?' });
  assert.equal(repeat.wouldAccept, false); assert.ok(repeat.duplicateDecision.errors.includes('RECENT_NEAR_DUPLICATE'));
  const invalid = await step(s, 'ADJACENT_SPEECH', { utterance: 'bill took it yesterday' });
  assert.equal(invalid.wouldAccept, false); assert.match(invalid.result.reason, /UTTERANCE/);
  assert.equal(invalid.shadowUpdate.environment, null);
});

test('four accepted per six hours causes logical admission wait, without clearing history or forcing durability', async () => {
  const s = createSequentialFrameSession(fixture(), { nowMs });
  for (const operationId of ['SHIFT_WEIGHT', 'STRETCH_HANDS', 'TAP_FINGERS']) {
    const r = await step(s, 'CY_IN_PLACE', { operationId }); assert.equal(r.wouldAccept, true, r.result.reason);
  }
  const fourth = await step(s, 'ADJACENT_NONVERBAL', { operationId: 'COUGHING' });
  assert.equal(fourth.wouldAccept, true, fourth.result.reason);
  const next = s.prepareNext();
  assert.ok(next.nowMs - nowMs > 6 * 3600000);
  assert.ok(next.logicalWaitMs > 45 * 60000);
  assert.equal(next.feedback.drought.streak, 4); assert.equal(next.feedback.drought.diagnosticOnly, true);
  assert.ok(!next.prepared.request.prompt.includes('RECENT WORLD DROUGHT'));
  assert.ok(next.prepared.bound.frames.every(f => f.permittedEffects.length === 0));
  const fifth = await step(s, 'ADJACENT_NONVERBAL', { operationId: 'FOOTSTEPS' });
  assert.equal(fifth.wouldAccept, true, fifth.result.reason);
});

test('preflight failure stops before send and leaves both world and operational history untouched', async () => {
  const s = createSequentialFrameSession(fixture(), { nowMs }); const before = s.snapshot(); let calls = 0;
  await assert.rejects(s.attempt({ preflight: () => { throw new Error('TOKEN_TRUNCATION'); },
    generate: () => { calls++; } }), /ABORT_BEFORE_SEND/);
  assert.equal(calls, 0); assert.equal(s.progress().completed, 0); assert.deepEqual(s.snapshot(), before);
});

test('malformed, timeout, stale selection and failed calls cannot append world history or replace inference', async () => {
  const s = createSequentialFrameSession(fixture(), { nowMs });
  const old = s.prepareNext().prepared.bound.frames[0].frameId;
  for (const generate of [() => '{bad', () => { throw new Error('TRANSPORT_FAILURE'); },
    () => JSON.stringify({ frameId: old, content: { operationId: 'SHIFT_WEIGHT' } })]) {
    const before = s.snapshot(); const row = await s.attempt({ preflight: receipt, generate });
    assert.equal(row.wouldAccept, false); assert.deepEqual(row.shadowAfter.recentWorldHistory, before.recentWorldHistory);
    assert.deepEqual(row.shadowAfter.worldSimulation.recentAccepted, before.worldSimulation.recentAccepted);
    assert.equal(row.result.generateInvocations, 1); assert.equal(row.result.repairCalls, 0);
    assert.equal(row.result.replacementCalls, 0);
  }
  const row = await s.attempt({ preflight: receipt, timeoutMs: 5,
    generate: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('TIMEOUT')))) });
  assert.equal(row.result.reason, 'TIMEOUT'); assert.equal(row.shadowUpdate.environment, null);
  assert.equal(s.progress().completed, 4);
});

test('exactly ten attempts maximum, one generate callback per step; no automatic resume', async () => {
  const s = createSequentialFrameSession(fixture(), { nowMs }); let calls = 0;
  const rows = await runTenSequentialAttempts(s, { preflight: receipt, generate: wire => {
    calls++; const ticket = s.prepareNext(); assert.deepEqual(wire, ticket.prepared.wire);
    return JSON.stringify({ frameId: ticket.prepared.bound.frames[0].frameId, content: { operationId: 'TAP_FINGERS' } });
  } });
  assert.equal(rows.length, 10); assert.equal(calls, 10); assert.equal(rows.filter(r => r.wouldAccept).length, 1);
  assert.throws(() => s.prepareNext(), /TEN_ATTEMPT_LIMIT/);
  await assert.rejects(runTenSequentialAttempts(s, {}), /NEVER_RESUME/);
  assert.deepEqual(s.snapshot().postBody, fixture().postBody);
});

test('bounded ledgers roll at production limits; failure records retain no accepted side effect', async () => {
  const c = fixture();
  c.worldSimulation.recentRuns = Array.from({ length: 20 }, (_, i) => ({ runId: `old-${i}`, validationStatus: 'FAILED' }));
  c.recentWorldHistory = Array.from({ length: 24 }, (_, i) => ({ id: `env-old-${i}`,
    timestamp: new Date(nowMs - (25 + i) * 3600000).toISOString(), summary: 'Old unrelated context.', participants: [] }));
  const s = createSequentialFrameSession(c, { nowMs });
  const first = await step(s, 'CY_IN_PLACE', { operationId: 'SHIFT_WEIGHT' });
  assert.equal(first.shadowAfter.recentWorldHistory.length, 24);
  assert.equal(first.shadowAfter.recentWorldHistory[0].id, 'env-old-1');
  assert.equal(first.shadowAfter.worldSimulation.recentRuns.length, 20);
  assert.equal(first.shadowAfter.worldSimulation.recentRuns[0].runId, 'old-1');
  const rejected = await step(s, 'CY_IN_PLACE', { operationId: 'SHIFT_WEIGHT' });
  assert.equal(rejected.shadowAfter.worldSimulation.recentRuns.length, 20);
  assert.deepEqual(rejected.shadowAfter.recentWorldHistory, first.shadowAfter.recentWorldHistory);
  assert.equal(rejected.shadowUpdate.run.candidateType, 'EVENT');
});

test('protocol/preflight abort is recordable and aborts batch without a replacement or shadow transition', async () => {
  const s = createSequentialFrameSession(fixture(), { nowMs }); let calls = 0; const records = [];
  await assert.rejects(runTenSequentialAttempts(s, { preflight: receipt,
    generate: () => { calls++; throw new Error('TOKEN_ACCOUNTING_MISMATCH'); },
    record: row => records.push(row) }), /ABORT_TOKEN_ACCOUNTING/);
  assert.equal(calls, 1); assert.equal(records.length, 1); assert.equal(records[0].batchAborted, true);
  assert.equal(records[0].result.generateInvocations, 1); assert.equal(s.progress().completed, 0);
  assert.equal(records[0].shadowUpdate.beforeHash, records[0].shadowUpdate.afterHash);
});

test('offline preparer has no inference mode or network transport', () => {
  const cli = fileURLToPath(new URL('./prepare-sequential-frame-selector.mjs', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /OFFLINE ONLY/);
  const run = spawnSync(process.execPath, [cli, '--run', '10'], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(run.status, 0); assert.match(run.stderr, /NO_INFERENCE_MODE/);
  assert.ok(!/fetch\(|http\.request\(|https\.request\(|net\.connect\(/.test(fs.readFileSync(cli, 'utf8')));
});

const capturePath = process.env.CY_AWG_CAPTURE || 'C:/cy-rehearsal/leno-awg-capture-20261013';
test('real frozen first request stays 748 tokens; repeated offline selections change ID budget, not history instructions',
  { skip: !fs.existsSync(`${capturePath}/SHA256SUMS.txt`) }, async () => {
    const { capture, nowMs: capturedNow } = readVerifiedCapture(capturePath);
    const before = fingerprint(capture), s = createSequentialFrameSession(capture, { nowMs: capturedNow });
    const initial = exactContextPreflight(s.prepareNext().prepared.request);
    assert.equal(initial.inputTokens, 748); assert.equal(initial.spareAfterFullOutput, 1903);
    for (let i = 0; i < 3; i++) {
      const row = await s.attempt({ preflight: exactContextPreflight,
        generate: generator(s, 'ADJACENT_NONVERBAL', { operationId: 'COUGHING' }) });
      assert.equal(row.wouldAccept, i === 0);
      assert.equal(row.result.contextPreflight.initialTruncation, false);
      assert.ok(row.result.contextPreflight.spareAfterFullOutput > 1800);
      assert.equal(row.prepared.wire.truncate, false);
    }
    assert.equal(fingerprint(capture), before);
  });

test('production, pinned prototype, tokenizer, schema and settings remain untouched', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const diff = spawnSync('git', ['diff', '--exit-code', '626133b', '--', 'runner', 'public', 'lib', 'config', 'sql',
    'scripts/rehearsal/grounded-frame-selector.mjs', 'scripts/rehearsal/one-call-context-budget.mjs',
    'scripts/rehearsal/cy-context-preflight.py', 'docs/rehearsal/grounded-frame-selector-schema.json'],
  { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(diff.status, 0, diff.stdout || diff.stderr);
});
