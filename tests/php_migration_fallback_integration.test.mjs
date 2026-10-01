// Requires an isolated disposable MariaDB instance. Never use a CY database.
// CY_TEST_DB_ISOLATED=1, CY_TEST_DB_DEFAULTS, CY_TEST_DB_PORT,
// CY_TEST_MARIADB_BIN and CY_TEST_PHP_BIN opt in.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const enabled = process.env.CY_TEST_DB_ISOLATED === '1';
const dbName = `cy_php_fallback_${randomBytes(6).toString('hex')}`;
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
      await fetch(`http://127.0.0.1:${port}/api/history.php`, { signal: AbortSignal.timeout(500) });
      return child;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  child.kill();
  throw new Error(`PHP test server did not start: ${stderr}`);
}

test('only intended missing migration tables receive success-shaped PHP fallbacks',
  { skip: !enabled }, async () => {
    assert.ok(defaults && mysqlBin && phpBin && dbPort > 0, 'isolated DB settings required');
    const webRoot = await mkdtemp(join(tmpdir(), 'cy-php-fallback-web-'));
    let php = null;
    let createdDb = false;
    try {
      mysql(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      createdDb = true;
      mysql(await readFile(join(root, 'sql/schema.sql'), 'utf8'), dbName);
      mysql(await readFile(join(root, 'sql/004_history.sql'), 'utf8'), dbName);
      mysql(`INSERT INTO history_days (day, acc) VALUES ('2026-10-01', '{}');
        INSERT INTO history_hours (day, hour, acc) VALUES ('2026-10-01', 4, '{}');
        INSERT INTO events (ts, kind, payload) VALUES
          ('2026-10-01 03:00:00.000', 'vitals', '{"marker":"archived"}');
        INSERT INTO live_vitals_latest (id, updated_at, payload) VALUES
          (1, '2026-10-01 04:00:00.000', '{"marker":"fresh"}');`, dbName);
      await cp(join(root, 'lib'), join(webRoot, 'lib'), { recursive: true });
      await mkdir(join(webRoot, 'public/api'), { recursive: true });
      await mkdir(join(webRoot, 'config'), { recursive: true });
      for (const file of ['history.php', 'stream.php']) {
        await cp(join(root, 'public/api', file), join(webRoot, 'public/api', file));
      }
      const configPath = join(webRoot, 'config/config.php');
      const historyLibPath = join(webRoot, 'lib/history.php');
      const liveLibPath = join(webRoot, 'lib/live_vitals.php');
      const originalHistory = await readFile(historyLibPath, 'utf8');
      const originalLive = await readFile(liveLibPath, 'utf8');
      const writeConfig = async (port) => writeFile(configPath, `<?php return [
        'db' => ['host' => '127.0.0.1;port=${port}', 'name' => '${dbName}',
          'user' => 'root', 'pass' => '', 'charset' => 'utf8mb4'],
        'ingest_key' => 'disposable-test-key', 'cookie_secret' => 'disposable-test-cookie'
      ];`);
      await writeConfig(dbPort);
      const port = await freePort();
      php = await startPhp(webRoot, port);
      const request = async (path) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/${path}?probe=${randomBytes(4).toString('hex')}`);
        return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
      };
      const expectError = async (path, label) => {
        const result = await request(path);
        assert.equal(result.status, 500, `${label}: must not look successful`);
        assert.deepEqual(result.body, { ok: false, error: 'internal error' }, `${label}: API error shape`);
        if (path === 'history.php') assert.equal(result.cache, 'no-store', `${label}: errors must not be cached`);
      };

      let result = await request('history.php');
      assert.equal(result.status, 200);
      assert.equal(result.body.days.length, 1, 'valid history is unchanged');
      result = await request('stream.php');
      assert.equal(result.status, 200);
      assert.equal(result.body.live_vitals.payload.marker, 'fresh', 'valid singleton wins over archive');

      mysql('DROP TABLE history_days', dbName);
      result = await request('history.php');
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.days, [], 'missing intended history index remains compatible');
      mysql('CREATE TABLE history_days (not_day INT)', dbName);
      await expectError('history.php', 'history bad column');
      mysql('DROP TABLE history_days', dbName);
      mysql(await readFile(join(root, 'sql/004_history.sql'), 'utf8'), dbName);
      mysql('DROP TABLE history_hours', dbName);
      result = await request('history.php');
      assert.equal(result.status, 200, 'missing hourly index remains compatible');
      assert.deepEqual(result.body.days, []);
      mysql(await readFile(join(root, 'sql/004_history.sql'), 'utf8'), dbName);
      mysql('DROP TABLE history_cursor', dbName);
      result = await request('history.php');
      assert.equal(result.status, 200, 'missing cursor table remains compatible');
      assert.deepEqual(result.body.days, []);
      mysql(await readFile(join(root, 'sql/004_history.sql'), 'utf8'), dbName);
      const malformedHistory = originalHistory.replace(
        'SELECT * FROM history_days ORDER BY day ASC', 'SELECT FROM history_days');
      assert.notEqual(malformedHistory, originalHistory, 'history fault injection must match source query');
      await writeFile(historyLibPath, malformedHistory);
      await expectError('history.php', 'history malformed query');
      await writeFile(historyLibPath, originalHistory);

      mysql('DROP TABLE live_vitals_latest', dbName);
      result = await request('stream.php');
      assert.equal(result.status, 200);
      assert.equal(result.body.live_vitals.payload.marker, 'archived',
        'missing intended singleton retains old-schema fallback');
      mysql('CREATE TABLE live_vitals_latest (id INT PRIMARY KEY, payload JSON)', dbName);
      await expectError('stream.php', 'singleton bad column');
      mysql('DROP TABLE live_vitals_latest', dbName);
      mysql("CREATE TABLE live_vitals_latest (id INT PRIMARY KEY, updated_at DATETIME(3), payload JSON)", dbName);
      mysql(`INSERT INTO live_vitals_latest (id, updated_at, payload) VALUES
        (1, '2026-10-01 04:00:00.000', '{"marker":"fresh"}')`, dbName);
      const malformedLive = originalLive.replace('SELECT NULL AS seq, updated_at AS ts, payload',
        'SELECT FROM live_vitals_latest, updated_at AS ts, payload');
      assert.notEqual(malformedLive, originalLive, 'live fault injection must match source query');
      await writeFile(liveLibPath, malformedLive);
      await expectError('stream.php', 'singleton malformed query');
      await writeFile(liveLibPath, originalLive);

      await writeConfig(dbPort + 1);
      await expectError('history.php', 'history connection failure');
      await expectError('stream.php', 'live connection failure');
      await writeConfig(dbPort);
      result = await request('stream.php');
      assert.equal(result.status, 200);
      assert.equal(result.body.live_vitals.payload.marker, 'fresh', 'normal live path still works');
      console.log('PHP_FALLBACK_CASES valid,missing-table,bad-column,syntax,connection: checked');
    } finally {
      if (php && php.exitCode === null && php.signalCode === null) {
        php.kill();
        await new Promise((done) => php.once('exit', done));
      }
      if (createdDb) mysql(`DROP DATABASE \`${dbName}\``);
      await rm(webRoot, { recursive: true, force: true });
    }
  });
