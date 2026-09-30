import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Client } from './client.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function withClient(run) {
  const dir = await mkdtemp(join(tmpdir(), 'cy-client-flush-'));
  try {
    const client = new Client({ dryRun: false, apiBase: 'http://example.invalid', ingestKey: 'test' }, dir);
    await run(client);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function queued(client) {
  try {
    return (await readFile(client.queuePath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

test('failed old queue drain durably appends the new batch after old events', async () => {
  await withClient(async (client) => {
    await writeFile(client.queuePath, `${JSON.stringify({ id: 'old' })}\n`);
    client.enqueue({ id: 'new' });
    client._drainQueue = async () => { throw new Error('queue drain failed'); };
    await client.flush();
    assert.deepEqual((await queued(client)).map((event) => event.id), ['old', 'new']);
    assert.equal(client.batch.length, 0);
    assert.equal(client.lastError, 'queue drain failed');
  });
});

test('stop waits for an active flush and then sends events added during it', async () => {
  await withClient(async (client) => {
    const entered = deferred();
    const release = deferred();
    const sent = [];
    client._drainQueue = async () => {};
    client._send = async (events) => {
      sent.push(events.map((event) => event.id));
      if (sent.length === 1) {
        entered.resolve();
        await release.promise;
      }
    };
    client.enqueue({ id: 'first' });
    const active = client.flush();
    await entered.promise;
    client.enqueue({ id: 'second' });
    let stopped = false;
    const stopping = client.stop().then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(stopped, false);
    release.resolve();
    await Promise.all([active, stopping]);
    assert.equal(stopped, true);
    assert.deepEqual(sent, [['first'], ['second']]);
    assert.deepEqual(client.batch, []);
  });
});

test('concurrent flush callers await one in-flight operation; later batches retain ownership', async () => {
  await withClient(async (client) => {
    const entered = deferred();
    const release = deferred();
    const sent = [];
    client._drainQueue = async () => {};
    client._send = async (events) => {
      sent.push(events.map((event) => event.id));
      entered.resolve();
      await release.promise;
    };
    client.enqueue({ id: 'first' });
    const first = client.flush();
    await entered.promise;
    client.enqueue({ id: 'second' });
    const concurrent = client.flush();
    client.enqueue({ id: 'third' });
    assert.strictEqual(concurrent, first);
    assert.deepEqual(client.batch.map((event) => event.id), ['second', 'third']);
    release.resolve();
    await Promise.all([first, concurrent]);
    assert.deepEqual(sent, [['first']]);
    await client.flush();
    assert.deepEqual(sent, [['first'], ['second', 'third']]);
    assert.deepEqual(client.batch, []);
  });
});

test('shutdown bounds continuous new work and queues the last batch without duplication', async () => {
  await withClient(async (client) => {
    const sent = [];
    client._drainQueue = async () => {};
    client._send = async (events) => {
      sent.push(events[0].id);
      client.enqueue({ id: `next-${sent.length}` });
    };
    client.enqueue({ id: 'first' });
    await client.stop();
    assert.deepEqual(sent, ['first', 'next-1', 'next-2']);
    assert.deepEqual((await queued(client)).map((event) => event.id), ['next-3']);
    assert.deepEqual(client.batch, []);
  });
});

test('failed send queues durably and retry sends old events before new ones', async () => {
  await withClient(async (client) => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    let fail = true;
    globalThis.fetch = async (_url, options) => {
      const ids = JSON.parse(options.body).events.map((event) => event.id);
      calls.push(ids);
      if (fail) {
        fail = false;
        throw new Error('temporary network failure');
      }
      return { ok: true };
    };
    try {
      client.enqueue({ id: 'first' });
      await client.flush();
      assert.deepEqual((await queued(client)).map((event) => event.id), ['first']);
      client.enqueue({ id: 'second' });
      await client.flush();
      assert.deepEqual(calls, [['first'], ['first'], ['second']]);
      assert.deepEqual(await queued(client), []);
      assert.deepEqual(client.batch, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('shutdown after failed send leaves the event durably queued', async () => {
  await withClient(async (client) => {
    client._drainQueue = async () => {};
    client._send = async () => { throw new Error('ingest unavailable'); };
    client.enqueue({ id: 'pending' });
    await client.stop();
    assert.deepEqual((await queued(client)).map((event) => event.id), ['pending']);
    assert.deepEqual(client.batch, []);
  });
});

test('queue write failure restores memory ownership and stop reports the failure', async () => {
  await withClient(async (client) => {
    client._drainQueue = async () => {};
    client._send = async () => { throw new Error('ingest unavailable'); };
    const append = client._appendEvents.bind(client);
    client._appendEvents = async () => { throw new Error('disk unavailable'); };
    client.enqueue({ id: 'pending' });
    await assert.rejects(client.stop(), /disk unavailable/);
    assert.deepEqual(client.batch.map((event) => event.id), ['pending']);
    assert.deepEqual(await queued(client), []);
    client._appendEvents = append;
    await client.flush();
    assert.deepEqual((await queued(client)).map((event) => event.id), ['pending']);
    assert.deepEqual(client.batch, []);
  });
});
