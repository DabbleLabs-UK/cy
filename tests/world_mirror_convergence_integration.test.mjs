// Opt-in only: use an isolated, disposable MariaDB instance, never a CY database.
// CY_TEST_DB_ISOLATED=1 requires CY_TEST_DB_DEFAULTS, CY_TEST_DB_PORT,
// CY_TEST_MARIADB_BIN and CY_TEST_PHP_BIN.
// Intentionally red on current lineage; do not merge until a convergence fix exists.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { reconcileWorldSimulationState } from '../runner/ambient-world-generator.js';
import { Client } from '../runner/client.js';
import { loadVitals, saveVitals } from '../runner/vitals.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const enabled = process.env.CY_TEST_DB_ISOLATED === '1';
const dbName = `cy_world_mirror_${randomBytes(6).toString('hex')}`;
const dbPort = Number(process.env.CY_TEST_DB_PORT || 0);
const mysqlBin = process.env.CY_TEST_MARIADB_BIN;
const phpBin = process.env.CY_TEST_PHP_BIN;
const defaults = process.env.CY_TEST_DB_DEFAULTS;

function mysql(sql, database = null) {
  const args = [`--defaults-file=${defaults}`, '-h', '127.0.0.1', '-P', String(dbPort),
    '-u', 'root', '--batch', '--skip-column-names', '--raw'];
  if (database) args.push(database);
  const result = spawnSync(mysqlBin, args, { input: sql, encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) throw new Error(`MariaDB test failure: ${result.error || result.stderr}`);
  return result.stdout.trim();
}

function sql(sqlText) { return mysql(sqlText, dbName); }

async function freePort() {
  const server = createServer();
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const port = server.address().port;
  await new Promise((closed) => server.close(closed));
  return port;
}

async function startPhp(webRoot, port) {
  const child = spawn(phpBin, ['-d', 'extension=pdo_mysql', '-S', `127.0.0.1:${port}`,
    '-t', join(webRoot, 'public')], { cwd: webRoot, windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`PHP test server exited: ${stderr}`);
    try {
      await fetch(`http://127.0.0.1:${port}/api/ingest.php`, { signal: AbortSignal.timeout(500) });
      return child;
    } catch {
      await new Promise((wait) => setTimeout(wait, 100));
    }
  }
  child.kill();
  throw new Error(`PHP test server did not start: ${stderr}`);
}

function world(suffix, terminal) {
  const updatedAt = terminal ? '2026-10-01T04:02:00.000Z' : '2026-10-01T04:00:00.000Z';
  return reconcileWorldSimulationState({
    objects: [{
      id: `object:mirror-${suffix}`, type: 'permitted_item', ownerId: 'cy',
      holderId: terminal ? 'officer' : 'cy', location: terminal ? 'property_store' : 'cell',
      status: terminal ? 'RETIRED' : 'ACTIVE', visibility: [],
      sourceEventId: `world:mirror-${suffix}`, updatedAt,
    }],
    threads: [{
      id: `thread:mirror-${suffix}`, type: 'OBJECT_TRANSFER',
      state: terminal ? 'RESOLVED' : 'OPEN',
      summary: terminal ? 'Item removed and matter closed' : 'Item awaiting disposition',
      participants: ['cy', 'officer'], sourceEventIds: terminal
        ? [`world:mirror-${suffix}`, `world:mirror-${suffix}-closed`]
        : [`world:mirror-${suffix}`],
      nextEligibleAt: null,
      resolution: terminal ? { at: updatedAt, eventId: `world:mirror-${suffix}-closed` } : null,
      visibility: [], createdAt: '2026-10-01T04:00:00.000Z', updatedAt,
    }],
  });
}

function clientFor(base, stateDir) {
  return new Client({ dryRun: false, apiBase: base, ingestKey: 'disposable-test-key' }, stateDir);
}

function enqueueMirror(client, state) {
  client.enqueue({ ts: '2026-10-01 04:02:00.000', kind: 'world_object_record', payload: state.objects[0] });
  client.enqueue({ ts: '2026-10-01 04:02:00.000', kind: 'world_thread_record', payload: state.threads[0] });
}

function mirrorStatus(suffix) {
  return {
    object: sql(`SELECT status FROM world_objects WHERE object_id = 'object:mirror-${suffix}'`),
    thread: sql(`SELECT state FROM world_threads WHERE thread_id = 'thread:mirror-${suffix}'`),
  };
}

async function checkpoint(stateDir, state) {
  const path = join(stateDir, 'vitals.json');
  const vitals = await loadVitals(path);
  vitals.worldSimulation = state;
  await saveVitals(path, vitals);
  return vitals;
}

async function recoveredStatus(stateDir) {
  const vitals = await loadVitals(join(stateDir, 'vitals.json'));
  const state = reconcileWorldSimulationState(vitals.worldSimulation);
  return { object: state.objects[0].status, thread: state.threads[0].state };
}

test('checkpoint and SQL world mirrors reconverge across both crash orders and lost acknowledgement',
  { skip: !enabled }, async () => {
    assert.ok(defaults && mysqlBin && phpBin && dbPort > 0, 'isolated test DB settings required');
    const webRoot = await mkdtemp(join(tmpdir(), 'cy-world-mirror-web-'));
    let server;
    let createdDb = false;
    const realFetch = globalThis.fetch;
    try {
      mysql(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      createdDb = true;
      mysql(await readFile(join(root, 'sql/schema.sql'), 'utf8'), dbName);
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
      const base = `http://127.0.0.1:${port}`;
      const observed = {};

      for (const suffix of ['checkpoint-ahead', 'sql-ahead', 'sql-ahead-fallback', 'lost-ack']) {
        const stateDir = join(webRoot, `state-${suffix}`);
        const initial = world(suffix, false);
        const terminal = world(suffix, true);
        await checkpoint(stateDir, initial);
        const client = clientFor(base, stateDir);
        enqueueMirror(client, initial);
        await client.flush();
        assert.deepEqual(mirrorStatus(suffix), { object: 'ACTIVE', thread: 'OPEN' });

        if (suffix === 'checkpoint-ahead') {
          await checkpoint(stateDir, terminal);
          // AWG saves accepted state before emitting mirrors. An enqueued but
          // unflushed transition lives only in process memory at this point.
          enqueueMirror(client, terminal);
          // Hard crash: do not call stop(), which would flush the memory batch.
          const restarted = clientFor(base, stateDir);
          await restarted.flush();
        } else if (suffix === 'sql-ahead') {
          // An emitted object change can reach SQL before the next urgent tick.
          // A previous-generation checkpoint fallback creates the same order.
          enqueueMirror(client, terminal);
          await client.flush();
          // Crash before the new checkpoint is committed.
          const restarted = clientFor(base, stateDir);
          await restarted.flush();
        } else if (suffix === 'sql-ahead-fallback') {
          await checkpoint(stateDir, terminal);
          enqueueMirror(client, terminal);
          await client.flush();
          // A damaged current generation makes loadVitals use the valid previous
          // generation, even though SQL has already committed the newer state.
          await writeFile(join(stateDir, 'vitals-v2', 'current.json'), '{broken');
          const restarted = clientFor(base, stateDir);
          await restarted.flush();
        } else {
          await checkpoint(stateDir, terminal);
          enqueueMirror(client, terminal);
          let lost = false;
          globalThis.fetch = async (...args) => {
            const response = await realFetch(...args);
            if (!lost && String(args[0]).endsWith('/api/ingest.php')) {
              lost = true;
              assert.equal(response.status, 200, await response.text());
              throw new Error('simulated lost acknowledgement after SQL commit');
            }
            return response;
          };
          await client.flush();
          globalThis.fetch = realFetch;
          assert.equal(lost, true);
          observed.lostAckReceiptsBefore = sql(
            "SELECT COUNT(*) FROM ingest_delivery_receipts WHERE kind IN ('world_object_record', 'world_thread_record')"
          );
          const restarted = clientFor(base, stateDir);
          restarted.enqueue({ ts: '2026-10-01 04:03:00.000', kind: 'capability',
            payload: { deepseek: false } });
          await restarted.flush();
          observed.lostAckReceiptsAfter = sql(
            "SELECT COUNT(*) FROM ingest_delivery_receipts WHERE kind IN ('world_object_record', 'world_thread_record')"
          );
        }
        observed[suffix] = {
          checkpoint: await recoveredStatus(stateDir), sql: mirrorStatus(suffix),
        };
      }
      console.log('WORLD_MIRROR_CRASH_ORDERS', JSON.stringify(observed));
      const terminal = { object: 'RETIRED', thread: 'RESOLVED' };
      assert.deepEqual(observed['lost-ack'], { checkpoint: terminal, sql: terminal });
      assert.equal(observed.lostAckReceiptsAfter, observed.lostAckReceiptsBefore,
        'same-delivery retries must not add receipts');
      const divergent = ['checkpoint-ahead', 'sql-ahead', 'sql-ahead-fallback']
        .filter((order) => JSON.stringify(observed[order]) !== JSON.stringify({ checkpoint: terminal, sql: terminal }));
      assert.deepEqual(divergent, [], 'both committed stores must converge after bounded recovery');
    } finally {
      globalThis.fetch = realFetch;
      if (server && server.exitCode === null && server.signalCode === null) {
        server.kill();
        await new Promise((exit) => server.once('exit', exit));
      }
      if (createdDb) mysql(`DROP DATABASE \`${dbName}\``);
      await rm(webRoot, { recursive: true, force: true });
    }
  });
