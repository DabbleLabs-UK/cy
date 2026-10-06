// Run only against an isolated, disposable MariaDB instance.
// Set CY_TEST_DB_ISOLATED=1, CY_TEST_DB_DEFAULTS, CY_TEST_DB_PORT,
// CY_TEST_MARIADB_BIN and CY_TEST_PHP_BIN to opt in.
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const enabled = process.env.CY_TEST_DB_ISOLATED === '1';
const dbName = `cy_postcard_claim_${randomBytes(6).toString('hex')}`;
const dbPort = Number(process.env.CY_TEST_DB_PORT || 0);
const mysqlBin = process.env.CY_TEST_MARIADB_BIN;
const phpBin = process.env.CY_TEST_PHP_BIN;
const defaults = process.env.CY_TEST_DB_DEFAULTS;

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

function scalar(sql) {
  return mysql(sql, dbName);
}

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
      await fetch(`http://127.0.0.1:${port}/api/inbox.php`, { signal: AbortSignal.timeout(500) });
      return child;
    } catch {
      await new Promise((wait) => setTimeout(wait, 100));
    }
  }
  child.kill();
  throw new Error(`PHP test server did not start: ${stderr}`);
}

test('lost inbox claim response releases a stale lease and reclaims once without terminal retention',
  { skip: !enabled }, async () => {
    assert.ok(defaults && mysqlBin && phpBin && dbPort > 0, 'isolated test DB settings required');
    const webRoot = await mkdtemp(join(tmpdir(), 'cy-postcard-claim-web-'));
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
      for (const endpoint of ['inbox.php', 'ingest.php', 'postcard-archive.php']) {
        await cp(join(root, 'public/api', endpoint), join(webRoot, 'public/api', endpoint));
      }
      await writeFile(join(webRoot, 'config/config.php'), `<?php return [
        'db' => ['host' => '127.0.0.1;port=${dbPort}', 'name' => '${dbName}',
          'user' => 'root', 'pass' => '', 'charset' => 'utf8mb4'],
        'ingest_key' => 'disposable-test-key', 'cookie_secret' => 'disposable-test-cookie'
      ];`);
      const port = await freePort();
      server = await startPhp(webRoot, port);
      const base = `http://127.0.0.1:${port}`;
      const client = new Client({ dryRun: false, apiBase: base,
        ingestKey: 'disposable-test-key' }, join(webRoot, 'state'));
      const received = [];
      client.onInbox = (data) => received.push(data);

      mysql(`INSERT INTO postcards (id, from_name, body, posted_at, deliver_at, mail_class)
        VALUES (1, 'A', 'normal claim', NOW(), NOW(), 'reply')`, dbName);
      await client.pollInbox();
      assert.deepEqual(received.at(-1).postcards.map((item) => item.id), [1]);
      const firstGeneration = received.at(-1).postcards[0].claim_generation;
      assert.equal(scalar('SELECT delivered_at IS NOT NULL FROM postcards WHERE id = 1'), '1');
      client.enqueue({ ts: '2026-10-01 03:00:00.000', kind: 'postcard_in', payload: { id: 1, claim_generation: firstGeneration } });
      client.enqueue({ ts: '2026-10-01 03:01:00.000', kind: 'postcard_out',
        payload: { reply_to: 1, claim_generation: firstGeneration, body: 'reply' } });
      await client.flush();
      assert.equal(scalar('SELECT replied_at IS NOT NULL FROM postcards WHERE id = 1'), '1');

      mysql(`INSERT INTO postcards (id, from_name, body, posted_at, deliver_at, mail_class)
        VALUES (2, 'B', 'lost claim response', NOW(), NOW(), 'reply')`, dbName);
      const callbacksBeforeLoss = received.length;
      let lost = false;
      globalThis.fetch = async (...args) => {
        const response = await realFetch(...args);
        if (!lost && String(args[0]).includes('/api/inbox.php')) {
          lost = true;
          assert.equal(response.status, 200, await response.text());
          throw new Error('simulated lost inbox response after claim commit');
        }
        return response;
      };
      await client.pollInbox();
      globalThis.fetch = realFetch;
      assert.equal(lost, true);
      assert.equal(received.length, callbacksBeforeLoss, 'runner did not receive the claimed item');
      assert.equal(scalar('SELECT delivered_at IS NOT NULL FROM postcards WHERE id = 2'), '1');
      await client.pollInbox();
      assert.equal(received.length, callbacksBeforeLoss, 'no repeat personal claim before TTL');
      assert.equal(scalar("SELECT COUNT(*) FROM events WHERE kind IN ('postcard_in', 'fan_mail_in') AND JSON_VALUE(payload, '$.id') = 2"), '0');

      mysql('UPDATE postcards SET delivered_at = DATE_SUB(NOW(), INTERVAL 31 MINUTE) WHERE id = 2', dbName);
      await client.pollInbox();
      assert.equal(scalar('SELECT mail_class FROM postcards WHERE id = 2'), 'reply');
      assert.equal(scalar('SELECT delivered_at IS NULL FROM postcards WHERE id = 2'), '1');
      assert.equal(scalar('SELECT quality_failures FROM postcards WHERE id = 2'), '0');
      assert.equal(scalar('SELECT temporary_failures FROM postcards WHERE id = 2'), '1');
      assert.equal(scalar('SELECT deliver_at > NOW() FROM postcards WHERE id = 2'), '1', 'claim expiry backs off');
      assert.equal(received.length, callbacksBeforeLoss, 'expiry does not immediately hot-loop');
      mysql('UPDATE postcards SET deliver_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = 2', dbName);
      await client.pollInbox();
      const reclaimed = received.at(-1).postcards[0];
      assert.equal(reclaimed.id, 2);
      assert.equal(reclaimed.claim_generation, 2, 'reclaim advances the fencing generation');
      client.enqueue({ ts: '2026-10-01 03:02:00.000', kind: 'postcard_in',
        payload: { id: 2, claim_generation: reclaimed.claim_generation } });
      client.enqueue({ ts: '2026-10-01 03:03:00.000', kind: 'postcard_out',
        payload: { reply_to: 2, claim_generation: reclaimed.claim_generation, body: 'one recovered reply' } });
      let ingestResponseLost = false;
      globalThis.fetch = async (...args) => {
        const response = await realFetch(...args);
        if (!ingestResponseLost && String(args[0]).endsWith('/api/ingest.php')) {
          ingestResponseLost = true;
          assert.equal(response.status, 200, await response.text());
          throw new Error('simulated lost ingest response after reply commit');
        }
        return response;
      };
      await client.flush();
      globalThis.fetch = realFetch;
      await client.flush();
      assert.equal(ingestResponseLost, true);
      assert.equal(scalar("SELECT COUNT(*) FROM events WHERE kind = 'fan_mail_in' AND JSON_VALUE(payload, '$.id') = 2"), '0');
      assert.equal(scalar("SELECT COUNT(*) FROM events WHERE kind = 'postcard_in' AND JSON_VALUE(payload, '$.id') = 2"), '1');
      assert.equal(scalar("SELECT COUNT(*) FROM events WHERE kind = 'postcard_out' AND JSON_VALUE(payload, '$.reply_to') = 2"), '1');
      assert.equal(scalar('SELECT reply_attempts FROM postcards WHERE id = 2'), '0');
      const archive = await realFetch(`${base}/api/postcard-archive.php`);
      const archiveBody = await archive.json();
      assert.equal(archive.status, 200, JSON.stringify(archiveBody));
      assert.ok(archiveBody.items.some((item) => item.id === 2), 'successful retry remains accessible in correspondence history');
      const callbacksBeforeRepeatPoll = received.length;
      await client.pollInbox();
      assert.equal(received.length, callbacksBeforeRepeatPoll, 'no second personal or fan-mail delivery');
      assert.equal(scalar("SELECT COUNT(*) FROM ingest_delivery_receipts WHERE kind = 'postcard_out'"), '2');
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
