// Run against an isolated disposable MariaDB instance, never a CY database.
// Set CY_TEST_DB_ISOLATED=1, CY_TEST_DB_DEFAULTS, CY_TEST_DB_PORT,
// CY_TEST_MARIADB_BIN and CY_TEST_PHP_BIN to opt in.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { Client } from '../runner/client.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const enabled = process.env.CY_TEST_DB_ISOLATED === '1';
const dbName = `cy_ingest_replay_${randomBytes(6).toString('hex')}`;
const dbPort = Number(process.env.CY_TEST_DB_PORT || 0);
const mysqlBin = process.env.CY_TEST_MARIADB_BIN;
const phpBin = process.env.CY_TEST_PHP_BIN;
const defaults = process.env.CY_TEST_DB_DEFAULTS;

function mysql(sql, database = null) {
  const args = [
    `--defaults-file=${defaults}`, '-h', '127.0.0.1', '-P', String(dbPort),
    '-u', 'root', '--batch', '--skip-column-names', '--raw',
  ];
  if (database) args.push(database);
  const result = spawnSync(mysqlBin, args, { input: sql, encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) {
    throw new Error(`MariaDB test command failed: ${result.error || result.stderr}`);
  }
  return result.stdout.trim();
}

function scalar(sql) {
  return mysql(sql, dbName);
}

function event(kind, payload, ts = '2026-10-01 03:00:00.000') {
  return { ts, kind, payload };
}

function mixedBatch() {
  const visitorId = '1234567890abcdef1234567890abcdef';
  const worldId = 'world:ingest-replay-test';
  return [
    event('journal', { text: 'the wing went quiet' }),
    event('postcard_out', { reply_to: 1, text: 'got your card' }),
    event('postcard_in', { id: 4, text: 'hello' }),
    event('postcard_deferred', { id: 2 }),
    event('postcard_blocked', { id: 3, reason: 'screened' }),
    event('visitor_seen', { visitor_id: visitorId, notes: 'asked about the wing', warmth: 0.6 }),
    event('world_event_record', {
      schema: 'cy.environment-record', version: 1,
      world_event: {
        schema: 'cy.environment-event', version: 1, id: worldId,
        timestamp: '2026-10-01 03:00:00.000', event_type: 'cell_search',
        event_family: 'custody', world: { situation: { possible_harm: 'possible' } },
      },
      observation: { modality: 'direct', certainty: 'certain' },
      soma_input: { schema: 'cy.soma-input', version: 1, event_id: worldId, possible_harm: 'possible' },
      consumed_by: ['soma-input-staging-v1'],
    }),
    event('context_inspection', {
      generation_ref: 'test:context',
      packet: { schema: 'cy.shared-context-packet', consumer: 'AWG',
        generatedAt: '2026-10-01T03:00:00.000Z', metrics: { sourceCount: 1 } },
      rendering: '<SHARED_CONTEXT>test</SHARED_CONTEXT>',
    }),
    event('awg_run_record', {
      runId: 'test:awg', ranAt: '2026-10-01T03:00:00.000Z', candidateType: 'NO_EVENT',
      contextPacketSummary: { selectedCount: 1 }, candidateOutput: { decision: 'NO_EVENT' },
      validationStatus: 'ACCEPTED_NO_EVENT', createdWorldEventIds: [], threadChanges: [],
    }),
    event('world_thread_record', {
      id: 'thread:ingest-replay', type: 'note_delivery', state: 'OPEN', summary: 'Note awaiting delivery',
      participants: ['cy', 'fisher'], sourceEventIds: [worldId], nextEligibleAt: null,
      resolution: null, visibility: [{ observerId: 'cy', access: 'CY_DIRECT' }],
      createdAt: '2026-10-01T03:00:00.000Z', updatedAt: '2026-10-01T03:00:00.000Z',
    }),
    event('world_object_record', {
      id: 'object:ingest-replay', type: 'note', ownerId: 'fisher', holderId: 'cy',
      location: 'cell', status: 'ACTIVE', visibility: [{ observerId: 'cy', access: 'CY_DIRECT' }],
      sourceEventId: worldId, updatedAt: '2026-10-01T03:00:00.000Z',
    }),
    event('soma_diagnostic', { source: 'test', reading: 1 }),
    event('vitals', { soma: { experienced: { metrics: { arousal: { value: 20 } } } } }),
    event('draw_saved', { id: 'draw:ingest-replay', strokes: [[0, 0], [1, 1]], stroke_count: 2 }),
    event('capability', { deepseek: true }),
  ];
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function startPhp(webRoot, port) {
  const child = spawn(phpBin, ['-d', 'extension=pdo_mysql', '-S', `127.0.0.1:${port}`, '-t', join(webRoot, 'public')],
    { cwd: webRoot, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`PHP test server exited: ${stderr}`);
    try {
      await fetch(`http://127.0.0.1:${port}/api/ingest.php`, { signal: AbortSignal.timeout(500) });
      return { child, getStderr: () => stderr };
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  child.kill();
  throw new Error(`PHP test server did not start: ${stderr}`);
}

function snapshot() {
  return {
    publicEvents: Number(scalar('SELECT COUNT(*) FROM events')),
    journal: Number(scalar("SELECT COUNT(*) FROM events WHERE kind = 'journal'")),
    postcardOut: Number(scalar("SELECT COUNT(*) FROM events WHERE kind = 'postcard_out'")),
    postcardIn: Number(scalar("SELECT COUNT(*) FROM events WHERE kind = 'postcard_in'")),
    replied: scalar('SELECT replied_at IS NOT NULL FROM postcards WHERE id = 1'),
    deferredAttempts: Number(scalar('SELECT reply_attempts FROM postcards WHERE id = 2')),
    blocked: scalar('SELECT blocked FROM postcards WHERE id = 3'),
    visitorNotes: scalar("SELECT notes FROM visitors WHERE visitor_id = '1234567890abcdef1234567890abcdef'"),
    environment: Number(scalar('SELECT COUNT(*) FROM environment_events')),
    inspections: Number(scalar('SELECT COUNT(*) FROM context_broker_inspections')),
    awgRuns: Number(scalar('SELECT COUNT(*) FROM ambient_world_runs')),
    threads: Number(scalar('SELECT COUNT(*) FROM world_threads')),
    objects: Number(scalar('SELECT COUNT(*) FROM world_objects')),
    diagnostics: Number(scalar('SELECT COUNT(*) FROM soma_diagnostic_latest')),
    liveVitals: Number(scalar('SELECT COUNT(*) FROM live_vitals_latest')),
    historicalVitals: Number(scalar('SELECT COUNT(*) FROM vitals_history')),
    drawings: Number(scalar('SELECT COUNT(*) FROM drawings')),
    tempoDeepseek: scalar('SELECT deepseek_available FROM tempo WHERE id = 1'),
  };
}

test('committed mixed ingest and a lost response replay every category independently',
  { skip: !enabled }, async () => {
    assert.ok(defaults && mysqlBin && phpBin && dbPort > 0, 'isolated test DB settings required');
    const webRoot = await mkdtemp(join(tmpdir(), 'cy-ingest-web-'));
    let server;
    let createdDb = false;
    const priorFetch = globalThis.fetch;
    try {
      mysql(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      createdDb = true;
      mysql(await readFile(join(root, 'sql/schema.sql'), 'utf8'), dbName);
      mysql('DROP TABLE ingest_delivery_receipts', dbName);
      const migration = await readFile(join(root, 'sql/024_ingest_delivery_receipts.sql'), 'utf8');
      mysql(migration, dbName);
      mysql(migration, dbName); // additive and safe to rerun during rollout
      // The current ingest endpoint also uses migration 025's durable mirror
      // conflict result on receipts; restore that additive column after the
      // migration-024 idempotency rehearsal above.
      mysql('ALTER TABLE ingest_delivery_receipts ADD COLUMN world_mirror_conflict TINYINT(1) NOT NULL DEFAULT 0 AFTER kind', dbName);
      mysql(`INSERT INTO visitors (visitor_id, first_seen, last_seen) VALUES
        ('1234567890abcdef1234567890abcdef', NOW(), NOW());
        INSERT INTO postcards (id, posted_at, delivered_at, mail_class) VALUES
        (1, NOW(), NOW(), 'reply'), (2, NOW(), NOW(), 'reply'),
        (3, NOW(), NOW(), 'reply'), (4, NOW(), NOW(), 'reply');`, dbName);
      await cp(join(root, 'lib'), join(webRoot, 'lib'), { recursive: true });
      await mkdir(join(webRoot, 'public/api'), { recursive: true });
      await mkdir(join(webRoot, 'config'), { recursive: true });
      await cp(join(root, 'public/api/ingest.php'), join(webRoot, 'public/api/ingest.php'));
      await writeFile(join(webRoot, 'config/config.php'), `<?php return [
        'db' => ['host' => '127.0.0.1;port=${dbPort}', 'name' => '${dbName}',
          'user' => 'root', 'pass' => '', 'charset' => 'utf8mb4'],
        'ingest_key' => 'disposable-test-key', 'cookie_secret' => 'disposable-test-cookie'
      ];`);
      const port = await freePort();
      server = await startPhp(webRoot, port);
      const client = new Client({ dryRun: false, apiBase: `http://127.0.0.1:${port}`,
        ingestKey: 'disposable-test-key' }, join(webRoot, 'state'));
      const mixed = mixedBatch();
      for (const item of mixed) client.enqueue(item);
      let lost = false;
      globalThis.fetch = async (...args) => {
        const response = await priorFetch(...args);
        if (!lost && String(args[0]).endsWith('/api/ingest.php')) {
          lost = true;
          assert.equal(response.status, 200, await response.text());
          throw new Error('simulated lost acknowledgement after commit');
        }
        return response;
      };
      await client.flush();
      assert.equal(lost, true);
      assert.ok((await readFile(client.queuePath, 'utf8')).length > 0);
      const first = snapshot();
      assert.equal(Number(scalar('SELECT COUNT(*) FROM ingest_delivery_receipts')), mixed.length);
      globalThis.fetch = priorFetch;
      await client.flush();
      const second = snapshot();
      console.log('MIXED_FIRST', JSON.stringify(first));
      console.log('MIXED_REPLAY', JSON.stringify(second));
      assert.deepEqual(second, first, 'one lost acknowledgement must not repeat any ingest side effect');
      assert.equal(Number(scalar('SELECT COUNT(*) FROM ingest_delivery_receipts')), mixed.length);
      assert.equal(await readFile(client.queuePath, 'utf8'), '');

      const chunkClient = new Client({ dryRun: false, apiBase: `http://127.0.0.1:${port}`,
        ingestKey: 'disposable-test-key' }, join(webRoot, 'chunk-state'));
      for (let index = 0; index < 501; index += 1) {
        chunkClient.enqueue(event('event', { marker: 'chunk', index }));
      }
      await chunkClient._queuePendingBatch();
      chunkClient.backoff = 2000;
      let firstChunkLost = false;
      globalThis.fetch = async (...args) => {
        const response = await priorFetch(...args);
        if (!firstChunkLost && String(args[0]).endsWith('/api/ingest.php')) {
          firstChunkLost = true;
          assert.equal(JSON.parse(args[1].body).events.length, 500);
          assert.equal(response.status, 200, await response.text());
          throw new Error('simulated lost acknowledgement for first chunk');
        }
        return response;
      };
      await chunkClient.flush();
      assert.equal(firstChunkLost, true);
      const firstChunkCount = Number(scalar("SELECT COUNT(*) FROM events WHERE kind = 'event'"));
      globalThis.fetch = priorFetch;
      await chunkClient.flush();
      const replayedChunkCount = Number(scalar("SELECT COUNT(*) FROM events WHERE kind = 'event'"));
      console.log('CHUNK_REPLAY', JSON.stringify({ firstChunkCount, replayedChunkCount }));
      assert.equal(firstChunkCount, 500);
      assert.equal(replayedChunkCount, 501, 'replayed first chunk must not duplicate committed rows');
      assert.equal(await readFile(chunkClient.queuePath, 'utf8'), '');

      const same = event('journal', { text: 'the same words can happen twice' },
        '2026-10-01 03:01:00.000');
      client.enqueue(structuredClone(same));
      client.enqueue(structuredClone(same));
      await client.flush();
      const sameContentCount = Number(scalar(
        "SELECT COUNT(*) FROM events WHERE kind = 'journal' AND ts = '2026-10-01 03:01:00.000'"
      ));
      console.log('SAME_CONTENT_DISTINCT', sameContentCount);
      assert.equal(sameContentCount, 2, 'identical content in separate enqueues remains separate');

      client.enqueue(event('visitor_seen', {
        visitor_id: '1234567890abcdef1234567890abcdef', notes: 'newer standing', warmth: 0.8,
      }, '2026-10-01 03:02:00.000'));
      client.enqueue(event('world_thread_record', {
        id: 'thread:ingest-replay', type: 'note_delivery', state: 'RESOLVED', summary: 'Note delivered',
        participants: ['cy', 'fisher'], sourceEventIds: ['world:ingest-replay-test'],
        resolution: { outcome: 'delivered' }, visibility: [{ observerId: 'cy', access: 'CY_DIRECT' }],
        createdAt: '2026-10-01T03:00:00.000Z', updatedAt: '2026-10-01T03:02:00.000Z',
      }, '2026-10-01 03:02:00.000'));
      client.enqueue(event('world_object_record', {
        id: 'object:ingest-replay', type: 'note', ownerId: 'fisher', holderId: 'cy',
        location: 'cell', status: 'RETIRED', visibility: [{ observerId: 'cy', access: 'CY_DIRECT' }],
        sourceEventId: 'world:ingest-replay-test', updatedAt: '2026-10-01T03:02:00.000Z',
      }, '2026-10-01 03:02:00.000'));
      client.enqueue(event('vitals', { soma: { experienced: { metrics: { arousal: { value: 90 } } } } },
        '2026-10-01 03:02:00.000'));
      await client.flush();
      const stateBeforeLateReplay = {
        notes: scalar("SELECT notes FROM visitors WHERE visitor_id = '1234567890abcdef1234567890abcdef'"),
        thread: scalar("SELECT state FROM world_threads WHERE thread_id = 'thread:ingest-replay'"),
        object: scalar("SELECT status FROM world_objects WHERE object_id = 'object:ingest-replay'"),
        vitalsAt: scalar('SELECT updated_at FROM live_vitals_latest WHERE id = 1'),
      };
      const late = await priorFetch(`http://127.0.0.1:${port}/api/ingest.php`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'disposable-test-key' },
        body: JSON.stringify({ events: mixed }),
      });
      assert.equal(late.status, 200);
      assert.equal((await late.json()).inserted, 0);
      const stateAfterLateReplay = {
        notes: scalar("SELECT notes FROM visitors WHERE visitor_id = '1234567890abcdef1234567890abcdef'"),
        thread: scalar("SELECT state FROM world_threads WHERE thread_id = 'thread:ingest-replay'"),
        object: scalar("SELECT status FROM world_objects WHERE object_id = 'object:ingest-replay'"),
        vitalsAt: scalar('SELECT updated_at FROM live_vitals_latest WHERE id = 1'),
      };
      console.log('LATE_REPLAY', JSON.stringify({ stateBeforeLateReplay, stateAfterLateReplay }));
      assert.deepEqual(stateAfterLateReplay, stateBeforeLateReplay,
        'late replay must not restore stale private, world or live state');

      const rollbackEvent = event('journal', { text: 'rollback proof' });
      rollbackEvent.delivery_id = randomUUID();
      const rejected = await priorFetch(`http://127.0.0.1:${port}/api/ingest.php`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'disposable-test-key' },
        body: JSON.stringify({ events: [rollbackEvent, { ts: rollbackEvent.ts, kind: 'journal' }] }),
      });
      assert.equal(rejected.status, 422);
      assert.equal(Number(scalar("SELECT COUNT(*) FROM events WHERE JSON_VALUE(payload, '$.text') = 'rollback proof'")), 0);
      const retryAfterRollback = await priorFetch(`http://127.0.0.1:${port}/api/ingest.php`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'disposable-test-key' },
        body: JSON.stringify({ events: [rollbackEvent] }),
      });
      assert.equal(retryAfterRollback.status, 200, await retryAfterRollback.text());
      assert.equal(Number(scalar("SELECT COUNT(*) FROM events WHERE JSON_VALUE(payload, '$.text') = 'rollback proof'")), 1);

      // A rolling deployment may still have an old runner without IDs. It must
      // remain accepted, while only identified deliveries receive replay safety.
      const legacy = event('event', { marker: 'legacy-no-id' });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await priorFetch(`http://127.0.0.1:${port}/api/ingest.php`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'disposable-test-key' },
          body: JSON.stringify({ events: [legacy] }),
        });
        assert.equal(response.status, 200, await response.text());
      }
      assert.equal(Number(scalar("SELECT COUNT(*) FROM events WHERE JSON_VALUE(payload, '$.marker') = 'legacy-no-id'")), 2);
    } finally {
      globalThis.fetch = priorFetch;
      if (server) {
        if (server.child.exitCode === null && server.child.signalCode === null) {
          server.child.kill();
          await new Promise((resolveExit) => server.child.once('exit', resolveExit));
        }
      }
      if (createdDb) mysql(`DROP DATABASE \`${dbName}\``);
      await rm(webRoot, { recursive: true, force: true });
    }
  });
