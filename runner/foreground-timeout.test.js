// foreground-timeout.test.js - the 2026-09-18 05:20 outage was a foreground
// generation (dream-waking) that never received a response and never
// recovered, because the mode-aware stall watchdog (WATCHDOG_MS) explicitly
// excludes 'dream' mode and asleep periods, and no foreground call site set
// a hard per-request ceiling. This exercises the extracted, dependency-free
// withAbortTimeout (used by every foreground rawGenerate/streamGenerate call
// site) directly - no live model, no live process - plus structural checks
// that every foreground call site is actually wired to it and that the
// background AWG call site is untouched.
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/foreground-timeout.test.js

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withAbortTimeout } from './run.js';
import { cancellationReason } from './inference-cancellation.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

function within(ms, promise) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`did not settle within ${ms}ms`)), ms)),
  ]);
}

// ---- 1. foreground timeout propagation: a stuck fn is aborted after timeoutMs ----
await (async () => {
  const ac = new AbortController();
  let aborted = false;
  ac.signal.addEventListener('abort', () => { aborted = true; });
  const stuckForever = () => new Promise(() => {}); // never resolves on its own - the exact original failure shape
  const p = withAbortTimeout(ac, 30, stuckForever);
  // the wrapper itself never settles (fn never settles) - only the abort side effect fires
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(aborted, true, 'a request stuck longer than timeoutMs is aborted');
  assert.equal(cancellationReason(ac.signal), 'TIMEOUT');
  ok('foreground timeout propagation: a genuinely stuck request is aborted after timeoutMs');
  void p; // intentionally left pending, matches the real caller: the abort makes fn's own promise reject/settle
})();

// ---- 2. graceful recovery: fn settling before the timeout leaves it uncalled ----
await (async () => {
  const ac = new AbortController();
  let aborted = false;
  ac.signal.addEventListener('abort', () => { aborted = true; });
  const fastResult = await within(500, withAbortTimeout(ac, 10000, async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return 'done';
  }));
  assert.equal(fastResult, 'done', 'a request that completes well within timeoutMs returns normally');
  assert.equal(aborted, false, 'the abort never fires for a request that completes in time');
  ok('graceful recovery: a normal (non-stuck) request is unaffected by the timeout');
})();

// ---- 3. no timeout configured: behaves exactly as before (opt-in only) ----
await (async () => {
  const ac = new AbortController();
  const result = await within(500, withAbortTimeout(ac, null, async () => 'unbounded'));
  assert.equal(result, 'unbounded', 'timeoutMs=null (the default) never aborts - opt-in only');
  ok('no timeout configured (null/0/negative) never fires - background call sites are unaffected');
})();

// ---- 4. the timer is cleared on success (no dangling abort after settle) ----
await (async () => {
  const ac = new AbortController();
  let abortedAfterSettle = false;
  await withAbortTimeout(ac, 20, async () => 'ok');
  ac.signal.addEventListener('abort', () => { abortedAfterSettle = true; });
  await new Promise((resolve) => setTimeout(resolve, 60)); // past the original timeoutMs
  assert.equal(abortedAfterSettle, false, 'the timer is cleared once fn settles - no stray abort later');
  ok('the timeout is cleared on settle, not left dangling');
})();

// ---- 5. every foreground call site is wired to the shared timeout ----
// (structural: confirms the wiring exists in source, matching runner/launcher.test.js's style)
const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
assert.match(source, /const FOREGROUND_INFERENCE_TIMEOUT_MS = 600000/,
  'the foreground timeout constant is defined and finite');
const foregroundPurposes = [
  'purpose: .drawing., attempt: .drawing-intent.', // draw decision (streamGenerate)
  'purpose: .drawing., attempt: .drawing-base.', // draw DSL base pass (rawGenerate)
  'attempt: `drawing-\\$\\{pass\\}`', // draw DSL detail/shade passes (rawGenerate)
  'purpose: .dream., returnMeta: true, attempt: .dream-waking.', // the exact original failure shape
  'purpose: .dream., returnMeta: true, attempt: .dream-murmur.',
  "mode: 'warden', attempt: 'warden-initial'",
  "mode: 'letter', purpose: 'postcard', attempt: 'postcard-initial'",
  "accountingMode: 'expressive_choice',\\s*\\n\\s*attempt: 'expressive-choice'",
];
for (const pattern of foregroundPurposes) {
  const re = new RegExp(pattern + '[\\s\\S]{0,80}?timeoutMs: FOREGROUND_INFERENCE_TIMEOUT_MS', 'm');
  assert.match(source, re, `foreground call site matching /${pattern}/ passes the foreground timeout`);
}
assert.match(source, /generate: \(call\) => rawGenerate\(\{[\s\S]{0,700}?timeoutMs: call\.background \? null : FOREGROUND_INFERENCE_TIMEOUT_MS/,
  'the shared AutobiographicalMemoryRuntime generate callback applies the foreground timeout only when NOT background');
ok('every known foreground call site is wired to FOREGROUND_INFERENCE_TIMEOUT_MS');

assert.match(source,
  /hostLease = await provider\.acquireSharedLease\([\s\S]{0,500}?cancelTimeout = startAbortTimeout\(ac, timeoutMs\)[\s\S]{0,300}?provider\.openStream/,
  'stream timeout starts only after shared-host ownership is granted');
assert.match(source,
  /hostLease = await provider\.acquireSharedLease\([\s\S]{0,500}?startedAtMs = lease\.begin\(\)[\s\S]{0,200}?withAbortTimeout\(ac, timeoutMs/,
  'raw timeout starts only after shared-host ownership is granted');
ok('shared-host queueing is excluded from provider timeout accounting');

// ---- 6. AWG keeps a finite purpose-specific provider timeout ----
assert.match(source, /generate: \(call\) => rawGenerate\(\{[\s\S]{0,700}?timeoutMs: AWG_TIMEOUT_MS,[\s\S]{0,160}?admittedAwgSlot: true/,
  'AWG receives its finite background timeout after explicit reserved-slot admission');
assert.doesNotMatch(source, /timeoutMs: AWG_TIMEOUT_MS[\s\S]{0,40}FOREGROUND_INFERENCE_TIMEOUT_MS/,
  'AWG is never given the foreground timeout in addition to its own');
ok('background AWG call site uses its own finite provider timeout, not the foreground constant');

assert.match(source,
  /mid = Math\.random\(\) < 0\.5 && generationCancellation\.has\('visible'\)[\s\S]{0,180}?generationCancellation\.abort\('visible', 'WING_NOISE_MID'\)/,
  'wing noise targets visible prose only');
assert.match(source,
  /if \(interrupt\) generationCancellation\.abortAll\(interruptReason\)/,
  'postcard and warden work can still preempt AWG');
assert.match(source,
  /async function streamGenerate[\s\S]{0,700}?generationCancellation\.abort\('awg', 'FOREGROUND_INFERENCE'\)/,
  'foreground prose can preempt active AWG work');
for (const cause of ['PAUSE', 'SHUTDOWN', 'PROVIDER_CHANGE']) {
  assert.match(source, new RegExp(`generationCancellation\\.abortAll\\('${cause}'\\)`),
    `${cause} still cancels active AWG work`);
}
assert.match(source,
  /onLost: \(\) => abortWithReason\(ac, 'LEASE_LOSS'\)/,
  'shared lease loss cancels the owning request with a reason');
assert.match(source,
  /const cancellationScope = awgInReservedIdle \? 'awg'[\s\S]{0,1000}?generationCancellation\.register\(cancellationScope, ac, \{ purpose \}\)/,
  'an admitted AWG request owns a separate cancellation scope');
assert.match(source,
  /abort_reason: cancellationReason\(ac\.signal\)/,
  'inference telemetry preserves the structured abort reason');
assert.match(source,
  /if \(awgInReservedIdle && ac\.signal\.aborted\) throw cancellationError\(ac\.signal\)/,
  'AWG cancellation bypasses candidate parsing');
ok('AWG and visible prose use purpose-aware, reason-tagged cancellation paths');

console.log(`\nforeground-timeout.test.js: all ${n} checks passed`);
