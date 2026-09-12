import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Client } from './client.js';

test('memory source remains on disk across an enqueue failure and retries idempotently', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'cy-memory-source-'));
  try {
    const client = new Client({ dryRun: false }, stateDir);
    let fail = true;
    const received = [];
    client._memoryRequest = async (action, payload) => {
      assert.equal(action, 'enqueue_source');
      if (fail) throw new Error('temporary server failure');
      received.push(payload.source.sourceId);
      return { queued: true };
    };
    await assert.rejects(
      client.enqueueMemorySource({ sourceType: 'POSTCARD', sourceId: 'postcard:durable' }),
      /temporary server failure/,
    );
    assert.match(await readFile(client.memorySourcesPath, 'utf8'), /postcard:durable/);
    fail = false;
    await client.drainMemorySourceQueue();
    assert.deepEqual(received, ['postcard:durable']);
    assert.equal(await readFile(client.memorySourcesPath, 'utf8'), '');
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
