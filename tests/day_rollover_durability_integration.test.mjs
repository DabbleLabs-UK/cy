// Opt in with CY_TEST_DB_ISOLATED=1 and a disposable MariaDB instance.
// Never points at a production CY schema.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { Client } from '../runner/client.js';
import {
  acknowledgeDayRollovers, dayRolloverDeliveryId, pendingDayRollovers,
  persistDayRollover, stageDayRollover,
} from '../runner/day-rollover.js';
import { loadVitals, saveVitals } from '../runner/vitals.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const enabled = process.env.CY_TEST_DB_ISOLATED === '1';
const dbName = `cy_day_crash_${randomBytes(6).toString('hex')}`;
const dbPort = Number(process.env.CY_TEST_DB_PORT || 0);
const mysqlBin = process.env.CY_TEST_MARIADB_BIN;
const phpBin = process.env.CY_TEST_PHP_BIN;
const defaults = process.env.CY_TEST_DB_DEFAULTS;
const key = 'disposable-day-test-key';

function mysql(sql, database = null) {
  const args = [`--defaults-file=${defaults}`, '-h', '127.0.0.1', '-P', String(dbPort),
    '-u', 'root', '--batch', '--skip-column-names', '--raw'];
  if (database) args.push(database);
  const result = spawnSync(mysqlBin, args, { input: sql, encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) {
    throw new Error(`MariaDB test command failed: ${result.error || result.stderr}`);
  }
  return result.stdout.trim();
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function startPhp(webRoot, port) {
  const child = spawn(phpBin, ['-d', 'extension=pdo_mysql', '-S', `127.0.0.1:${port}`,
    '-t', join(webRoot, 'public')],
  { cwd: webRoot, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`PHP test server exited: ${stderr}`);
    try {
      await fetch(`http://127.0.0.1:${port}/api/ingest.php`, { signal: AbortSignal.timeout(500) });
      return child;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  child.kill();
  throw new Error(`PHP test server did not start: ${stderr}`);
}

test('day rollover survives all publication/checkpoint crash orders', { skip: !enabled }, async () => {
  assert.ok(defaults && mysqlBin && phpBin && dbPort > 0, 'isolated DB settings required');
  const webRoot = await mkdtemp(join(tmpdir(), 'cy-day-crash-web-'));
  let php = null;
  let createdDb = false;
  const realFetch = globalThis.fetch;
  try {
    mysql(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    createdDb = true;
    mysql(await readFile(join(root, 'sql/schema.sql'), 'utf8'), dbName);
    mysql(await readFile(join(root, 'sql/024_ingest_delivery_receipts.sql'), 'utf8'), dbName);
    await cp(join(root, 'lib'), join(webRoot, 'lib'), { recursive: true });
    await mkdir(join(webRoot, 'public/api'), { recursive: true });
    await mkdir(join(webRoot, 'config'), { recursive: true });
    await cp(join(root, 'public/api/ingest.php'), join(webRoot, 'public/api/ingest.php'));
    await writeFile(join(webRoot, 'config/config.php'), `<?php return [
      'db' => ['host' => '127.0.0.1;port=${dbPort}', 'name' => '${dbName}',
        'user' => 'root', 'pass' => '', 'charset' => 'utf8mb4'],
      'ingest_key' => '${key}', 'cookie_secret' => 'disposable-day-test-cookie'
    ];`);
    const port = await freePort();
    php = await startPhp(webRoot, port);
    const config = { dryRun: false, apiBase: `http://127.0.0.1:${port}`, ingestKey: key };
    // Characterize the former publication-first path: two enqueues of the
    // same logical day mint different IDs, so receipt dedup alone gives two
    // public rows. This is a separate fixture date from the corrected cases.
    const legacyClient = new Client(config, join(webRoot, 'legacy-order'));
    const legacyEvent = { kind: 'day', ts: '2026-10-01 00:00:00.000',
      payload: { n: 51, date: '2026-10-01' } };
    legacyClient.enqueue(structuredClone(legacyEvent));
    await legacyClient.flush();
    legacyClient.enqueue(structuredClone(legacyEvent));
    await legacyClient.flush();
    assert.equal(Number(mysql("SELECT COUNT(*) FROM events WHERE kind = 'day' AND JSON_VALUE(payload, '$.date') = '2026-10-01'", dbName)), 2,
      'the old new-ID-on-restart order demonstrably duplicates a logical day');
    const scenarios = [
      ['A-before-either', '2026-10-02'],
      ['B-queued-before-checkpoint', '2026-10-03'],
      ['C-public-commit-before-checkpoint', '2026-10-04'],
      ['D-checkpoint-before-queue', '2026-10-05'],
      ['E-lost-ack-after-commit', '2026-10-06'],
      ['F-both-durable', '2026-10-07'],
    ];

    for (const [name, date] of scenarios) {
      const stateDir = join(webRoot, `state-${name}`);
      await mkdir(stateDir);
      const vitalsPath = join(stateDir, 'vitals.json');
      const before = await loadVitals(vitalsPath);
      before.day = 50;
      before.lastRolloverDate = '2026-10-01';
      await saveVitals(vitalsPath, before);
      const oldClient = new Client(config, stateDir);
      const ts = `${date} 00:00:00.000`;

      if (name.startsWith('B-') || name.startsWith('C-')) {
        // Characterize the old publication-first ordering. A newly created
        // delivery after the pre-rollover checkpoint must retain the same
        // logical date identity, even though its queue/HTTP path is separate.
        const event = stageDayRollover(before, date, ts);
        oldClient.enqueueDayRollover(event);
        if (name.startsWith('B-')) await oldClient._queuePendingBatch();
        else await oldClient.flush();
      } else if (name.startsWith('D-')) {
        await assert.rejects(persistDayRollover(before, date, ts,
          () => saveVitals(vitalsPath, before), () => { throw new Error('crash before enqueue'); }));
      } else if (name.startsWith('E-') || name.startsWith('F-')) {
        await persistDayRollover(before, date, ts,
          () => saveVitals(vitalsPath, before), (event) => oldClient.enqueueDayRollover(event));
        if (name.startsWith('E-')) {
          let lost = false;
          globalThis.fetch = async (...args) => {
            const response = await realFetch(...args);
            if (!lost && String(args[0]).endsWith('/api/ingest.php')) {
              lost = true;
              assert.equal(response.status, 200, await response.text());
              throw new Error('lost response after commit');
            }
            return response;
          };
          await oldClient.flush();
          assert.equal(lost, true);
          globalThis.fetch = realFetch;
        } else {
          oldClient.onDelivered = (events) => acknowledgeDayRollovers(before, events);
          await oldClient.flush();
          await saveVitals(vitalsPath, before);
        }
      }

      // Hard process death: only the on-disk checkpoint/queue and committed
      // MariaDB rows survive. The old in-memory client and vitals are dropped.
      const recovered = await loadVitals(vitalsPath);
      const client = new Client(config, stateDir);
      client.onDelivered = (events) => acknowledgeDayRollovers(recovered, events);
      for (const event of pendingDayRollovers(recovered)) client.enqueueDayRollover(event);
      if (recovered.lastRolloverDate !== date) {
        await persistDayRollover(recovered, date, ts,
          () => saveVitals(vitalsPath, recovered), (event) => client.enqueueDayRollover(event));
      }
      await client.flush();
      await saveVitals(vitalsPath, recovered);
      const after = await loadVitals(vitalsPath);
      assert.equal(after.day, 51, `${name}: one effective day increment`);
      assert.equal(after.lastRolloverDate, date, `${name}: durable date`);
      assert.equal(pendingDayRollovers(after).length, 0, `${name}: delivery acknowledged`);
      const count = Number(mysql(`SELECT COUNT(*) FROM events WHERE kind = 'day'
        AND JSON_VALUE(payload, '$.date') = '${date}'`, dbName));
      const receipts = Number(mysql(`SELECT COUNT(*) FROM ingest_delivery_receipts
        WHERE delivery_id = UNHEX('${dayRolloverDeliveryId(date).replaceAll('-', '')}')`, dbName));
      assert.equal(count, 1, `${name}: exactly one effective public rollover`);
      assert.equal(receipts, 1, `${name}: one logical delivery receipt`);
      console.log('DAY_CRASH_CASE', name, JSON.stringify({ day: after.day, count, receipts }));
    }

    const later = await loadVitals(join(webRoot, 'state-F-both-durable', 'vitals.json'));
    const next = stageDayRollover(later, '2026-10-08', '2026-10-08 00:00:00.000');
    assert.equal(next.payload.n, 52, 'ordinary later transitions remain possible');
  } finally {
    globalThis.fetch = realFetch;
    if (php && php.exitCode === null && php.signalCode === null) {
      php.kill();
      await new Promise((done) => php.once('exit', done));
    }
    if (createdDb) mysql(`DROP DATABASE \`${dbName}\``);
    await rm(webRoot, { recursive: true, force: true });
  }
});
