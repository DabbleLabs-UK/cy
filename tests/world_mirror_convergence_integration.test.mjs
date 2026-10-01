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
import { baselineLegacyWorldMirror, synchronizeWorldMirror } from '../runner/world-mirror.js';

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
  const revision = terminal ? 2 : 1;
  const caseId = { 'checkpoint-ahead': '1', 'sql-ahead': '2',
    'sql-ahead-fallback': '3', 'lost-ack': '4' }[suffix];
  const transitionId = `00000000-0000-4000-8000-000000000${caseId}0${revision}`;
  return reconcileWorldSimulationState({
    objects: [{
      id: `object:mirror-${suffix}`, type: 'permitted_item', ownerId: 'cy',
      holderId: terminal ? 'officer' : 'cy', location: terminal ? 'property_store' : 'cell',
      status: terminal ? 'RETIRED' : 'ACTIVE', visibility: [],
      sourceEventId: `world:mirror-${suffix}`, updatedAt,
      revision, transitionId,
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
      revision, transitionId: `00000000-0000-4000-8000-000000000${caseId}1${revision}`,
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
  return { object: (state.objects[0] || state.terminalObjects[0]).status,
    thread: (state.threads[0] || state.terminalThreads[0]).state };
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
      await cp(join(root, 'public/api/world-mirror.php'), join(webRoot, 'public/api/world-mirror.php'));
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
          await synchronizeWorldMirror((await loadVitals(join(stateDir, 'vitals.json'))).worldSimulation,
            restarted, (next) => checkpoint(stateDir, next));
        } else if (suffix === 'sql-ahead') {
          // An emitted object change can reach SQL before the next urgent tick.
          // A previous-generation checkpoint fallback creates the same order.
          enqueueMirror(client, terminal);
          await client.flush();
          // Crash before the new checkpoint is committed.
          const restarted = clientFor(base, stateDir);
          await synchronizeWorldMirror((await loadVitals(join(stateDir, 'vitals.json'))).worldSimulation,
            restarted, (next) => checkpoint(stateDir, next));
        } else if (suffix === 'sql-ahead-fallback') {
          await checkpoint(stateDir, terminal);
          enqueueMirror(client, terminal);
          await client.flush();
          // A damaged current generation makes loadVitals use the valid previous
          // generation, even though SQL has already committed the newer state.
          await writeFile(join(stateDir, 'vitals-v2', 'current.json'), '{broken');
          const restarted = clientFor(base, stateDir);
          await synchronizeWorldMirror((await loadVitals(join(stateDir, 'vitals.json'))).worldSimulation,
            restarted, (next) => checkpoint(stateDir, next));
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

      // A new delivery of an older logical state is not the same delivery-ID
      // replay. Entity revisions, not receipts, must protect the mirror.
      const replayDir = join(webRoot, 'state-checkpoint-ahead');
      const staleClient = clientFor(base, replayDir);
      enqueueMirror(staleClient, world('checkpoint-ahead', false));
      await staleClient.flush();
      assert.deepEqual(mirrorStatus('checkpoint-ahead'), terminal);
      assert.equal(sql("SELECT revision FROM world_objects WHERE object_id = 'object:mirror-checkpoint-ahead'"), '2');

      const legacy = world('checkpoint-ahead', false);
      for (const entity of [...legacy.objects, ...legacy.threads]) {
        delete entity.revision;
        delete entity.transitionId;
      }
      const legacyClient = clientFor(base, replayDir);
      enqueueMirror(legacyClient, legacy);
      await legacyClient.flush();
      assert.deepEqual(mirrorStatus('checkpoint-ahead'), terminal,
        'unversioned queued records must not overwrite versioned rows');

      const conflicting = world('checkpoint-ahead', true);
      conflicting.objects[0].transitionId = '00000000-0000-4000-8000-000000000099';
      const conflictClient = clientFor(base, replayDir);
      const conflicts = [];
      conflictClient.onWorldMirrorConflict = (items) => conflicts.push(...items);
      conflictClient.enqueue({ kind: 'world_object_record', payload: conflicting.objects[0] });
      await conflictClient.flush();
      assert.deepEqual(conflicts, [{ kind: 'object', id: 'object:mirror-checkpoint-ahead' }]);
      assert.deepEqual(mirrorStatus('checkpoint-ahead'), terminal);

      const later = world('checkpoint-ahead', true).objects[0];
      later.revision = 3;
      later.transitionId = '00000000-0000-4000-8000-000000000093';
      const laterClient = clientFor(base, replayDir);
      laterClient.enqueue({ kind: 'world_object_record', payload: later });
      await laterClient.flush();
      assert.equal(sql("SELECT revision FROM world_objects WHERE object_id = 'object:mirror-checkpoint-ahead'"), '3',
        'a genuinely later same-content transition must not be collapsed');

      const reopenedObject = { ...later, revision: 4, status: 'ACTIVE',
        transitionId: '00000000-0000-4000-8000-000000000094' };
      const reopenedThread = { ...world('checkpoint-ahead', true).threads[0],
        revision: 3, state: 'OPEN',
        transitionId: '00000000-0000-4000-8000-000000000193' };
      const resurrectionClient = clientFor(base, replayDir);
      const resurrectionConflicts = [];
      resurrectionClient.onWorldMirrorConflict = (items) => resurrectionConflicts.push(...items);
      resurrectionClient.enqueue({ kind: 'world_object_record', payload: reopenedObject });
      resurrectionClient.enqueue({ kind: 'world_thread_record', payload: reopenedThread });
      await resurrectionClient.flush();
      assert.deepEqual(resurrectionConflicts, [
        { kind: 'object', id: 'object:mirror-checkpoint-ahead' },
        { kind: 'thread', id: 'thread:mirror-checkpoint-ahead' },
      ], 'a newer but impossible terminal reversal must be reported');
      assert.deepEqual(mirrorStatus('checkpoint-ahead'), terminal);

      const privateApi = await fetch(`${base}/api/world-mirror.php`);
      assert.equal(privateApi.status, 401, 'complete world mirror must require runner authentication');
      const allowedApi = await fetch(`${base}/api/world-mirror.php`, {
        headers: { 'X-Cy-Key': 'disposable-test-key' },
      });
      assert.equal(allowedApi.status, 200);
      const completeMirror = await allowedApi.json();
      assert.equal(completeMirror.objects.length, 4);
      assert.equal(completeMirror.threads.length, 4);

      // Rehearse the legacy cutover only in this disposable database. A
      // disagreement must be reported and explicitly selected before either
      // store is assigned matching baseline transition identities.
      const migrationDir = join(webRoot, 'state-legacy-rehearsal');
      const legacyInitial = world('checkpoint-ahead', false);
      legacyInitial.objects[0].id = 'object:legacy-rehearsal';
      legacyInitial.threads[0].id = 'thread:legacy-rehearsal';
      for (const entity of [...legacyInitial.objects, ...legacyInitial.threads]) {
        delete entity.revision;
        delete entity.transitionId;
      }
      await checkpoint(migrationDir, legacyInitial);
      const migrationClient = clientFor(base, migrationDir);
      enqueueMirror(migrationClient, legacyInitial);
      await migrationClient.flush();
      assert.equal(migrationClient.lastError, null, 'legacy fixture must reach disposable SQL');
      const legacyTerminal = structuredClone(legacyInitial);
      legacyTerminal.objects[0].status = 'RETIRED';
      legacyTerminal.threads[0].state = 'RESOLVED';
      legacyTerminal.threads[0].resolution = { at: '2026-10-01T04:02:00.000Z' };
      await checkpoint(migrationDir, legacyTerminal);
      const remoteLegacy = await migrationClient.fetchWorldMirror();
      const matchingRemote = {
        objects: remoteLegacy.objects.filter((item) => item.id === 'object:legacy-rehearsal'),
        threads: remoteLegacy.threads.filter((item) => item.id === 'thread:legacy-rehearsal'),
      };
      const rehearsal = baselineLegacyWorldMirror(legacyTerminal, matchingRemote);
      assert.equal(rehearsal.baseline, null);
      assert.equal(rehearsal.disagreements.length, 2);
      let seed = 1;
      const approved = baselineLegacyWorldMirror(legacyTerminal, matchingRemote, {
        'object:object:legacy-rehearsal': 'LOCAL',
        'thread:thread:legacy-rehearsal': 'LOCAL',
      }, () => `00000000-0000-4000-8000-${String(seed++).padStart(12, '0')}`);
      await checkpoint(migrationDir, approved.baseline);
      enqueueMirror(migrationClient, approved.baseline);
      await migrationClient.flush();
      assert.equal(migrationClient.lastError, null, 'approved baseline must reach disposable SQL');
      const afterBaseline = await migrationClient.fetchWorldMirror();
      assert.equal(afterBaseline.objects.find((item) => item.id === 'object:legacy-rehearsal').revision, 1);
      assert.equal(afterBaseline.threads.find((item) => item.id === 'thread:legacy-rehearsal').revision, 1);
      const staleLegacyClient = clientFor(base, migrationDir);
      enqueueMirror(staleLegacyClient, legacyInitial);
      await staleLegacyClient.flush();
      const afterOldReplay = await migrationClient.fetchWorldMirror();
      assert.equal(afterOldReplay.objects.find((item) => item.id === 'object:legacy-rehearsal').status, 'RETIRED');
      assert.equal(afterOldReplay.threads.find((item) => item.id === 'thread:legacy-rehearsal').state, 'RESOLVED');
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
