import assert from 'node:assert/strict';
import { applySharedOllamaProfile, createSharedOllamaClient } from './shared-ollama-lease.js';

const calls = [];
const fetchImpl = async (url, options = {}) => {
  calls.push({ url, options });
  if (url.endsWith('/v1/acquire')) {
    return {
      ok: true,
      async json() {
        return {
          id: 'lease-1',
          waitMs: 123,
          heartbeatMs: 60_000,
          profile: { num_ctx: 3072, num_thread: 4 },
        };
      },
    };
  }
  return { ok: true, async json() { return {}; } };
};

const client = createSharedOllamaClient('http://127.0.0.1:11435/', { fetchImpl });
const lease = await client.acquire({ purpose: 'journal' });
assert.equal(lease.waitMs, 123);
assert.deepEqual(lease.profile, { num_ctx: 3072, num_thread: 4 });
const acquireBody = JSON.parse(calls[0].options.body);
assert.deepEqual(acquireBody, { client: 'cy', priorityClass: 'cy', purpose: 'journal' });
assert.deepEqual(
  applySharedOllamaProfile({ temperature: 0.7, num_ctx: 4096, num_thread: 8 }, lease),
  { temperature: 0.7, num_ctx: 3072, num_thread: 4 },
);
await lease.release();
await lease.release();
assert.equal(calls.filter((call) => call.options.method === 'DELETE').length, 1, 'release is idempotent');
assert.equal(createSharedOllamaClient('', { fetchImpl }), null, 'blank URL leaves coordination disabled');

const ac = new AbortController();
ac.abort();
await assert.rejects(
  () => client.acquire({ signal: ac.signal }),
  (error) => error && error.name === 'AbortError',
);

// Owner provenance is one optional health snapshot. It neither changes the
// lease request body nor makes an unavailable health endpoint fail acquisition.
{
  const observed = [];
  const observedClient = createSharedOllamaClient('http://127.0.0.1:11435', {
    fetchImpl: async (url, options = {}) => {
      observed.push({ url, options });
      if (url.endsWith('/health')) return {
        ok: true, async json() { return { active: { client: 'feddit', purpose: 'user_turn' } }; },
      };
      if (url.endsWith('/v1/acquire')) return {
        ok: true, async json() { return { id: 'lease-observed', waitMs: 4200,
          heartbeatMs: 60000, profile: { num_ctx: 3072, num_thread: 4 } }; },
      };
      return { ok: true, async json() { return {}; } };
    },
  });
  const observedLease = await observedClient.acquire({ purpose: 'journal', observeOwner: true });
  assert.deepEqual(observedLease.ownerAtRequest, { client: 'feddit', purpose: 'user_turn' });
  assert.equal(observedLease.waitMs, 4200);
  assert.equal(observed[0].url.endsWith('/health'), true);
  assert.deepEqual(JSON.parse(observed[1].options.body),
    { client: 'cy', priorityClass: 'cy', purpose: 'journal' });
  await observedLease.release();

  const unavailableClient = createSharedOllamaClient('http://127.0.0.1:11435', {
    fetchImpl: async (url) => {
      if (url.endsWith('/health')) throw new Error('diagnostic endpoint unavailable');
      if (url.endsWith('/v1/acquire')) return {
        ok: true, async json() { return { id: 'lease-no-health', waitMs: 0,
          heartbeatMs: 60000, profile: { num_ctx: 3072, num_thread: 4 } }; },
      };
      return { ok: true, async json() { return {}; } };
    },
  });
  const unavailableLease = await unavailableClient.acquire({ purpose: 'journal', observeOwner: true });
  assert.equal(unavailableLease.ownerAtRequest, null);
  await unavailableLease.release();
}

// A preemptible lease (CY's AWG reserved-idle slot) aborts once the arbiter's
// heartbeat response reports an interactive request queued behind it. Note:
// the client clamps heartbeatMs to a 1000ms floor regardless of what the
// arbiter grants, so this waits past that floor for one real heartbeat tick.
{
  const preemptFetch = async (url) => {
    if (url.endsWith('/v1/acquire')) {
      return { ok: true, async json() { return { id: 'lease-awg', waitMs: 0, heartbeatMs: 1000, profile: { num_ctx: 3072, num_thread: 4 } }; } };
    }
    if (url.includes('/heartbeat')) {
      return { ok: true, async json() { return { expiresAt: Date.now() + 5000, interactiveWaiting: true }; } };
    }
    return { ok: true, async json() { return {}; } };
  };
  let lostReason = null;
  const preemptClient = createSharedOllamaClient('http://127.0.0.1:11435/', { fetchImpl: preemptFetch });
  const preemptLease = await preemptClient.acquire({
    purpose: 'ambient_world_generation', preemptible: true, onLost: (reason) => { lostReason = reason; },
  });
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(lostReason, 'LEASE_PREEMPTED', 'a preemptible lease releases once interactive contention is reported');
  await preemptLease.release();
}

// A non-preemptible lease ignores interactiveWaiting entirely, even if the
// arbiter reports it on every heartbeat (past the 1000ms client-side floor).
{
  const alwaysWaitingFetch = async (url) => {
    if (url.endsWith('/v1/acquire')) {
      return { ok: true, async json() { return { id: 'lease-journal', waitMs: 0, heartbeatMs: 1000, profile: { num_ctx: 3072, num_thread: 4 } }; } };
    }
    if (url.includes('/heartbeat')) {
      return { ok: true, async json() { return { expiresAt: Date.now() + 5000, interactiveWaiting: true }; } };
    }
    return { ok: true, async json() { return {}; } };
  };
  let lost = false;
  const notPreemptClient = createSharedOllamaClient('http://127.0.0.1:11435/', { fetchImpl: alwaysWaitingFetch });
  const notPreemptLease = await notPreemptClient.acquire({ purpose: 'journal', onLost: () => { lost = true; } });
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(lost, false, 'a non-preemptible lease is never aborted by interactive contention');
  await notPreemptLease.release();
}

// Heartbeat-failure loss still reports the original LEASE_LOSS reason (two
// consecutive failed heartbeat ticks past the 1000ms floor).
{
  const failingFetch = async (url) => {
    if (url.endsWith('/v1/acquire')) {
      return { ok: true, async json() { return { id: 'lease-fail', waitMs: 0, heartbeatMs: 1000, profile: { num_ctx: 3072, num_thread: 4 } }; } };
    }
    if (url.includes('/heartbeat')) return { ok: false };
    return { ok: true, async json() { return {}; } };
  };
  let lostReason = null;
  const failClient = createSharedOllamaClient('http://127.0.0.1:11435/', { fetchImpl: failingFetch });
  const failLease = await failClient.acquire({ purpose: 'journal', preemptible: true, onLost: (reason) => { lostReason = reason; } });
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(lostReason, 'LEASE_LOSS', 'a genuine heartbeat failure still reports LEASE_LOSS, distinct from LEASE_PREEMPTED');
  await failLease.release();
}

// Meal transactions cannot hang in their final release after the model has
// finished. Other existing callers retain their original release semantics.
{
  let released = 0;
  const bounded = createSharedOllamaClient('http://127.0.0.1:11435/', {
    fetchImpl: async (url, options) => {
      if (url.endsWith('/v1/acquire')) return {
        ok: true, json: async () => ({ id: 'bounded-meal', profile: { num_ctx: 3072, num_thread: 4 }, heartbeatMs: 60_000 }),
      };
      released++;
      assert.equal(options.method, 'DELETE');
      assert.ok(options.signal instanceof AbortSignal);
      await new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        // Keep this disposable mock alive until the unref'd abort timer fires.
        setTimeout(resolve, 100);
      });
      return { ok: true };
    },
  });
  const boundedLease = await bounded.acquire({ purpose: 'meal_choice' });
  await boundedLease.release({ timeoutMs: 10 });
  await boundedLease.release({ timeoutMs: 10 });
  assert.equal(released, 1);
}

console.log('shared Ollama lease: 12 checks passed');
