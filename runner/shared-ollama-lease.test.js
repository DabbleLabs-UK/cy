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

console.log('shared Ollama lease: 8 checks passed');
