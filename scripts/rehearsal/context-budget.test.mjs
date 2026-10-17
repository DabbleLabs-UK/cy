import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fingerprint } from './grounded-occurrence.mjs';
import { exactContextPreflight, validateContextReceipt, TOKENIZER_METHOD } from './one-call-context-budget.mjs';
import { readVerifiedCapture } from './prepare-grounded-occurrence.mjs';
import { prepareOneCall, expandModelPacket, runOneCallAttempt } from './one-call-grounded-proposal.mjs';

const request = { model: 'FAKE_NO_PROVIDER', options: { num_ctx: 3072, num_predict: 420 } };
const receipt = count => ({ method: TOKENIZER_METHOD, model: request.model,
  requestFingerprint: fingerprint(request), inputTokens: count, effectiveContext: 3072, outputAllowance: 420 });

test('initial truncation and full-output headroom are distinct checks', () => {
  assert.equal(validateContextReceipt(request, receipt(2651)).inputTokens, 2651);
  assert.throws(() => validateContextReceipt(request, receipt(2652)), /OUTPUT_HEADROOM/);
  assert.throws(() => validateContextReceipt(request, receipt(2719)), /OUTPUT_HEADROOM/);
  assert.throws(() => validateContextReceipt(request, receipt(3071)), /OUTPUT_HEADROOM/);
  assert.throws(() => validateContextReceipt(request, receipt(3072)), /INPUT_TRUNCATION/);
  assert.throws(() => validateContextReceipt(request, receipt(3120)), /INPUT_TRUNCATION/);
});

test('stale requests, altered profile, fake tokenizer and invalid counts fail closed', () => {
  for (const patch of [{ requestFingerprint: 'different' }, { method: 'rough-character-estimate' },
    { effectiveContext: 4096 }, { outputAllowance: 12 }, { inputTokens: 1.5 }, { inputTokens: NaN }])
    assert.throws(() => validateContextReceipt(request, { ...receipt(2129), ...patch }), /TOKEN_PREFLIGHT/);
});

test('missing Python, failed helper and invalid receipts never fall back to estimates', () => {
  for (const result of [{ error: new Error('not installed') }, { status: 2, stderr: 'bad template' },
    { status: 0, stdout: '{bad' }, { status: 0, stdout: '{}' }])
    assert.throws(() => exactContextPreflight(request, { run: () => result }), /TOKEN_PREFLIGHT/);
});

test('helper invocation is local metadata-only and hashes the exact request bytes', () => {
  const result = exactContextPreflight(request, { run: (program, args, options) => {
    assert.ok(args.includes('-I')); assert.ok(args.includes('-B')); assert.ok(args.includes('--model-store'));
    assert.equal(options.input, JSON.stringify(request)); assert.equal(options.windowsHide, true);
    assert.equal(options.env.PYTHONDONTWRITEBYTECODE, '1');
    return { status: 0, stdout: JSON.stringify(receipt(2129)) };
  } });
  assert.equal(result.inputTokens, 2129);
});

const store = process.env.CY_REHEARSAL_MODEL_STORE || 'C:/cy-rehearsal/models';
const blob = path.join(store, 'blobs/sha256-7afb333a43c3cd660e0a9720828ae963336796377dbf189c6a33a403527c6785');
const workspace = 'C:/Users/jodyf/Documents/Codex/2026-09-03/som';
const capturePath = process.env.CY_REHEARSAL_CAPTURE || 'C:/cy-rehearsal/leno-awg-capture-20261013';
const helper = fileURLToPath(new URL('./cy-context-preflight.py', import.meta.url));
const inspect = (req, ...flags) => {
  const result = spawnSync('python', ['-B', helper, '--model-store', store, '--inspect-only', ...flags],
    { input: JSON.stringify(req), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test('exact GGUF tokenizer reproduces retained old/neutral counts and proves lossless correction fits', {
  skip: !fs.existsSync(blob) || !fs.existsSync(capturePath) ? 'Requires the verified local rehearsal metadata/capture, never inference' : false,
}, async () => {
  const oldPath = `${workspace}/awg-one-call-preparation-20261017-ready/one-call-request.json`;
  const old = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const initial = inspect(old, '--include-tokens');
  assert.equal(initial.inputTokens, 3120); assert.equal(initial.initialTruncationLimit, 1538);
  assert.equal(initial.spareAfterFullOutput, -469); assert.equal(initial.fits, false);
  assert.ok(!initial.retainedPrompt.includes(old.system));
  assert.ok(!initial.retainedPrompt.includes('eligibility alone is not co-presence'));
  assert.ok(!initial.retainedPrompt.includes('state:current'));
  assert.ok(!initial.retainedPrompt.includes('actor:cy'));
  assert.ok(initial.retainedPrompt.includes('no eggs'));
  assert.equal(initial.tokenIds.length, 3120);
  for (const arm of ['A', 'B']) {
    const neutral = JSON.parse(fs.readFileSync(`${workspace}/awg-neutral-gate-prep-20261016/arm-${arm}-request.json`, 'utf8'));
    const count = inspect(neutral);
    assert.equal(count.inputTokens, 2719); assert.equal(count.initialTruncation, false);
    // The gate only emitted a few tokens, but its declared 420-token worst case
    // would not meet the new conservative full-output preflight policy.
    assert.equal(count.spareAfterFullOutput, -68);
  }
  const { capture, nowMs } = readVerifiedCapture(capturePath);
  const current = prepareOneCall(capture, { nowMs });
  assert.deepEqual(expandModelPacket(JSON.parse(current.request.prompt.split('\n\n').at(-1))), current.packet);
  assert.deepEqual(current.request.format, old.format);
  assert.deepEqual(current.request.options, old.options); assert.equal(current.request.system, old.system);
  assert.deepEqual(current.request.prompt.split('\n\n').slice(0, 8), old.prompt.split('\n\n').slice(0, 8));
  const result = exactContextPreflight(current.request, { modelStore: store });
  assert.equal(result.inputTokens, 2129); assert.equal(result.spareAfterFullOutput, 522);
  assert.equal(result.weightsLoaded, false); assert.equal(result.inferenceExecuted, false);
  const optimized = spawnSync('python', ['-O', '-B', helper, '--model-store', store],
    { input: JSON.stringify(current.request), encoding: 'utf8', windowsHide: true });
  assert.notEqual(optimized.status, 0); assert.match(optimized.stderr, /OPTIMIZED_PYTHON_UNSUPPORTED/);
  const huge = structuredClone(capture);
  huge.recentWorldHistory = Array.from({ length: 12 }, (_, index) => ({ id: `synthetic:${index}`,
    timestamp: '2026-10-13T20:40:00Z', eventFamily: 'CUSTODY', participants: [],
    summary: 'A synthetic fixture description with distinct words. '.repeat(12) }));
  // Real tokenizer, fake generator: an oversized future packet is rejected
  // before the callback, not silently trimmed, retried or sent to a model.
  const oversized = prepareOneCall(huge, { nowMs });
  assert.throws(() => exactContextPreflight(oversized.request, { modelStore: store }), /TOKEN_PREFLIGHT/);
  let generatorCalls = 0;
  const blocked = await runOneCallAttempt({ capture: huge, nowMs, admitted: true,
    preflight: req => exactContextPreflight(req, { modelStore: store }),
    generate: async () => { generatorCalls++; throw new Error('MUST_NOT_REACH_MODEL'); } });
  assert.equal(generatorCalls, 0); assert.equal(blocked.generateInvocations, 0);
  assert.match(blocked.reason, /TOKEN_PREFLIGHT_FAILED/);
  for (const patch of [{ system: old.system + '\u00e9' }, { system: old.system + '\u0000' },
    { system: old.system + '<|eot_id|>' }, { raw: true }, { template: 'different' }, { context: [1] }])
    assert.throws(() => exactContextPreflight({ ...current.request, ...patch }, { modelStore: store }), /TOKEN_PREFLIGHT/);
});
