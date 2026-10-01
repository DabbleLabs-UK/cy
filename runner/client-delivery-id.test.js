import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Client } from './client.js';

async function withClient(run) {
  const dir = await mkdtemp(join(tmpdir(), 'cy-delivery-id-'));
  const originalFetch = globalThis.fetch;
  try {
    const client = new Client({ dryRun: false, apiBase: 'http://example.invalid', ingestKey: 'test' }, dir);
    await run(client);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
}

function queued(raw) {
  return raw.trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('every enqueue gets a distinct identity even when the caller reuses the same object', async () => {
  await withClient(async (client) => {
    const event = { ts: '2026-10-01 03:00:00.000', kind: 'journal', payload: { text: 'same' } };
    client.enqueue(event);
    client.enqueue(event);
    assert.equal(client.batch.length, 2);
    assert.notEqual(client.batch[0].delivery_id, client.batch[1].delivery_id);
    assert.equal(client.batch[0].ts, client.batch[1].ts);
    assert.deepEqual(client.batch[0].payload, client.batch[1].payload);
  });
});

test('failed send queues the original delivery ID and retry resends that ID', async () => {
  await withClient(async (client) => {
    client.enqueue({ kind: 'journal', payload: { text: 'retry me' } });
    const id = client.batch[0].delivery_id;
    client._send = async () => { throw new Error('response lost'); };
    await client.flush();
    assert.equal(queued(await readFile(client.queuePath, 'utf8'))[0].delivery_id, id);
    const sent = [];
    globalThis.fetch = async (_url, options) => {
      sent.push(...JSON.parse(options.body).events);
      return { ok: true };
    };
    await client.flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].delivery_id, id);
    assert.equal(await readFile(client.queuePath, 'utf8'), '');
  });
});

test('old durable queue records acquire identities before any network send', async () => {
  await withClient(async (client) => {
    await writeFile(client.queuePath, '{"kind":"journal","ts":"2026-10-01 03:00:00.000","payload":{"text":"old"}}\n');
    const ids = [];
    globalThis.fetch = async (_url, options) => {
      ids.push(JSON.parse(options.body).events[0].delivery_id);
      if (ids.length === 1) throw new Error('lost response');
      return { ok: true };
    };
    await assert.rejects(client._drainQueue(), /lost response/);
    const saved = queued(await readFile(client.queuePath, 'utf8'));
    assert.equal(saved.length, 1);
    assert.match(saved[0].delivery_id, /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
    assert.equal(ids[0], saved[0].delivery_id);
    await client._drainQueue();
    assert.deepEqual(ids, [saved[0].delivery_id, saved[0].delivery_id]);
  });
});

test('failed identity upgrade sends nothing and retains the old queue bytes', async () => {
  await withClient(async (client) => {
    const old = Buffer.from('{"kind":"journal","ts":"2026-10-01 03:00:00.000","payload":{"text":"old"}}\n');
    await writeFile(client.queuePath, old);
    client._atomicReplace = async () => { throw new Error('upgrade failed'); };
    globalThis.fetch = async () => { throw new Error('network should not be reached'); };
    await assert.rejects(client._drainQueue(), /upgrade failed/);
    assert.deepEqual(await readFile(client.queuePath), old);
  });
});
