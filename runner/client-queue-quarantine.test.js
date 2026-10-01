import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Client } from './client.js';

async function withClient(run) {
  const dir = await mkdtemp(join(tmpdir(), 'cy-queue-quarantine-'));
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  const delivered = [];
  const warnings = [];
  const errors = [];
  globalThis.fetch = async (_url, options) => {
    delivered.push(...JSON.parse(options.body).events.map((event) => event.id));
    return { ok: true };
  };
  console.warn = (...parts) => warnings.push(parts.join(' '));
  console.error = (...parts) => errors.push(parts.join(' '));
  try {
    const client = new Client({ dryRun: false, apiBase: 'http://example.invalid', ingestKey: 'test' }, dir);
    await run({ client, delivered, warnings, errors });
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
    await rm(dir, { recursive: true, force: true });
  }
}

async function quarantine(client) {
  return JSON.parse(await readFile(client.queueQuarantinePath, 'utf8'));
}

test('valid-malformed-valid drains in order, quarantines exact bytes, and later drains stay clean', async () => {
  await withClient(async ({ client, delivered, warnings }) => {
    const bad = Buffer.from('{broken json}\n');
    await writeFile(client.queuePath, Buffer.concat([
      Buffer.from('{"id":"first"}\n'), bad, Buffer.from('{"id":"third"}\n'),
    ]));
    await client._drainQueue();
    assert.deepEqual(delivered, ['first', 'third']);
    assert.equal(await readFile(client.queuePath, 'utf8'), '');
    const saved = await quarantine(client);
    assert.equal(saved.schema, 'cy.queue-quarantine.v1');
    assert.equal(saved.entries.length, 1);
    assert.deepEqual(Buffer.from(saved.entries[0].rawBase64, 'base64'), bad);
    assert.equal(saved.entries[0].reason, 'MALFORMED_JSON');
    assert.match(warnings[0], /quarantined 1 malformed record/);

    await client._queueEvents([{ id: 'fourth' }]);
    await client._drainQueue();
    assert.deepEqual(delivered, ['first', 'third', 'fourth']);
    assert.equal((await quarantine(client)).entries.length, 1);
    assert.equal(warnings.length, 1);
  });
});

test('an interrupted trailing JSON line is recoverable while preceding valid events drain', async () => {
  await withClient(async ({ client, delivered }) => {
    const partial = Buffer.from('{"id":"not-finished"');
    await writeFile(client.queuePath, Buffer.concat([Buffer.from('{"id":"first"}\n'), partial]));
    await client._drainQueue();
    assert.deepEqual(delivered, ['first']);
    assert.deepEqual(Buffer.from((await quarantine(client)).entries[0].rawBase64, 'base64'), partial);
    assert.equal(await readFile(client.queuePath, 'utf8'), '');
  });
});

test('invalid UTF-8 bytes are quarantined exactly rather than decoded with replacement characters', async () => {
  await withClient(async ({ client, delivered }) => {
    const invalid = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d, 0x0a]);
    await writeFile(client.queuePath, Buffer.concat([
      Buffer.from('{"id":"first"}\n'), invalid, Buffer.from('{"id":"third"}\n'),
    ]));
    await client._drainQueue();
    assert.deepEqual(delivered, ['first', 'third']);
    const saved = (await quarantine(client)).entries[0];
    assert.equal(saved.reason, 'INVALID_UTF8');
    assert.deepEqual(Buffer.from(saved.rawBase64, 'base64'), invalid);
  });
});

test('quarantine is a bounded rolling window with explicit eviction and oversize metadata', async () => {
  await withClient(async ({ client, warnings }) => {
    client._queueQuarantineMaxBytes = 1024;
    const lines = Array.from({ length: 30 }, (_, index) => `broken-${index}-${'x'.repeat(32)}\n`);
    await writeFile(client.queuePath, lines.join(''));
    await client._drainQueue();
    const saved = await quarantine(client);
    assert.ok((await stat(client.queueQuarantinePath)).size <= 1024);
    assert.ok(saved.evictedRecords > 0);
    assert.deepEqual(Buffer.from(saved.entries.at(-1).rawBase64, 'base64'), Buffer.from(lines.at(-1)));
    assert.match(warnings[0], /expired at the size limit/);

    await writeFile(client.queuePath, `${'z'.repeat(2000)}\n`);
    await client._drainQueue();
    const oversized = (await quarantine(client)).entries.at(-1);
    assert.equal(oversized.rawBytes, 2001);
    assert.equal(oversized.truncated, true);
    assert.ok((await stat(client.queueQuarantinePath)).size <= 1024);
    assert.match(warnings.at(-1), /oversized record/);
  });
});

test('interrupted quarantine write leaves the active valid queue intact', async () => {
  await withClient(async ({ client, delivered, errors }) => {
    const original = Buffer.from('{"id":"first"}\n{bad}\n{"id":"third"}\n');
    await writeFile(client.queuePath, original);
    const replace = client._atomicReplace.bind(client);
    client._atomicReplace = async (path, data) => {
      if (path === client.queueQuarantinePath) {
        await writeFile(`${path}.tmp`, data.slice(0, 10));
        throw new Error('interrupted quarantine write');
      }
      return replace(path, data);
    };
    await assert.rejects(client._drainQueue(), /interrupted quarantine write/);
    assert.deepEqual(await readFile(client.queuePath), original);
    assert.deepEqual(delivered, []);
    assert.match(errors[0], /active queue retained/);
    client._atomicReplace = replace;
    await client._drainQueue();
    assert.deepEqual(delivered, ['first', 'third']);
    assert.equal((await quarantine(client)).entries.length, 1);
  });
});

test('failed quarantine rotation keeps both the prior quarantine and active queue', async () => {
  await withClient(async ({ client, delivered }) => {
    await writeFile(client.queuePath, '{old-bad}\n');
    await client._drainQueue();
    const prior = await readFile(client.queueQuarantinePath);
    const active = Buffer.from('{"id":"first"}\n{new-bad}\n');
    await writeFile(client.queuePath, active);
    const replace = client._atomicReplace.bind(client);
    client._atomicReplace = async (path, data) => {
      if (path === client.queueQuarantinePath) {
        await writeFile(`${path}.tmp`, data);
        throw new Error('quarantine rename failed');
      }
      return replace(path, data);
    };
    await assert.rejects(client._drainQueue(), /quarantine rename failed/);
    assert.deepEqual(await readFile(client.queuePath), active);
    assert.deepEqual(await readFile(client.queueQuarantinePath), prior);
    assert.deepEqual(delivered, []);
    client._atomicReplace = replace;
    await client._drainQueue();
    assert.deepEqual(delivered, ['first']);
    assert.equal((await quarantine(client)).entries.length, 2);
  });
});

test('failure compacting the active queue cannot erase its valid records', async () => {
  await withClient(async ({ client, delivered }) => {
    const active = Buffer.from('{"id":"first"}\n{bad}\n{"id":"third"}\n');
    await writeFile(client.queuePath, active);
    const replace = client._atomicReplace.bind(client);
    client._atomicReplace = async (path, data) => {
      if (path === client.queuePath) {
        await writeFile(`${path}.tmp`, data.slice(0, 5));
        throw new Error('active queue rename failed');
      }
      return replace(path, data);
    };
    await assert.rejects(client._drainQueue(), /active queue rename failed/);
    assert.deepEqual(await readFile(client.queuePath), active);
    assert.deepEqual(delivered, []);
    client._atomicReplace = replace;
    await client._drainQueue();
    assert.deepEqual(delivered, ['first', 'third']);
  });
});

test('task-1 flush preserves a new batch after a failed quarantine without joining a partial line', async () => {
  await withClient(async ({ client, delivered }) => {
    const partial = '{"id":"partial"';
    await writeFile(client.queuePath, `{"id":"old"}\n${partial}`);
    const quarantineLines = client._quarantineQueueLines.bind(client);
    client._quarantineQueueLines = async () => { throw new Error('quarantine unavailable'); };
    client.enqueue({ id: 'new' });
    await client.flush();
    assert.equal(client.batch.length, 0);
    const lines = (await readFile(client.queuePath, 'utf8')).split('\n');
    assert.equal(lines[0], '{"id":"old"}');
    assert.equal(lines[1], partial);
    assert.equal(JSON.parse(lines[2]).id, 'new');
    client._quarantineQueueLines = quarantineLines;
    await client._drainQueue();
    assert.deepEqual(delivered, ['old', 'new']);
    assert.deepEqual(Buffer.from((await quarantine(client)).entries[0].rawBase64, 'base64'), Buffer.from(partial + '\n'));
  });
});
