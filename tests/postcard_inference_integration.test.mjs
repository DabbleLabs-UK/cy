// Opt-in disposable MariaDB + real HTTP endpoints. Never uses production config.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const enabled = process.env.CY_TEST_DB_ISOLATED === '1';
test('postcard cloud budget, lost acknowledgements, one reply and public/admin boundaries', { skip: !enabled }, async () => {
  const dbName = `cy_cloud_${randomBytes(6).toString('hex')}`;
  const sql = (query, database = dbName) => {
    const result = spawnSync(process.env.CY_TEST_MARIADB_BIN, [
      `--defaults-file=${process.env.CY_TEST_DB_DEFAULTS}`, '-h', '127.0.0.1',
      '-P', process.env.CY_TEST_DB_PORT, '-u', 'root', '--batch', '--skip-column-names', '--raw',
      ...(database ? [database] : []),
    ], { input: query, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const web = await mkdtemp(join(tmpdir(), 'cy-cloud-test-'));
  let server;
  try {
    sql(`CREATE DATABASE ${dbName}`, null);
    sql(await readFile(join(root, 'sql/schema.sql'), 'utf8'));
    // Migration is safe to apply again over a fully migrated schema.
    sql(await readFile(join(root, 'sql/026_postcard_inference.sql'), 'utf8'));
    await cp(join(root, 'lib'), join(web, 'lib'), { recursive: true });
    await cp(join(root, 'public/api'), join(web, 'public/api'), { recursive: true });
    await cp(join(root, 'config'), join(web, 'config'), { recursive: true });
    await writeFile(join(web, 'config/config.php'), `<?php return [
      'db'=>['host'=>'127.0.0.1;port=${process.env.CY_TEST_DB_PORT}','name'=>'${dbName}','user'=>'root','pass'=>'','charset'=>'utf8mb4'],
      'ingest_key'=>'test-key','cookie_secret'=>'test-cookie'];`);
    const listener = createServer();
    await new Promise(r => listener.listen(0, '127.0.0.1', r));
    const port = listener.address().port;
    await new Promise(r => listener.close(r));
    server = spawn(process.env.CY_TEST_PHP_BIN, ['-d', 'extension=pdo_mysql', '-S', `127.0.0.1:${port}`, '-t', join(web, 'public')],
      { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let errors = '';
    server.stderr.on('data', b => { errors += b; });
    const base = `http://127.0.0.1:${port}`;
    for (let n = 0; n < 50; n++) {
      try { await fetch(`${base}/api/postcard-inference.php`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    const api = async (action, data = {}, extra = {}) => {
      const response = await fetch(`${base}/api/postcard-inference.php`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'test-key', ...extra },
        body: JSON.stringify({ action, ...data }),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result) + errors.slice(-1500));
      return result;
    };
    const publicGet = async range => (await fetch(`${base}/api/postcard-inference.php?range=${range}`)).json();
    const initial = await publicGet('1H');
    assert.equal(initial.ok, true);
    assert.equal(initial.can_admin, false);
    const denied = await fetch(`${base}/api/postcard-inference.php?111`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ action: 'settings', settings: { enabled: true } }),
    });
    assert.equal(denied.status, 403, '?111 does not authorize paid settings');
    let nextId = 100;
    const postcard = () => {
      const id = nextId++;
      sql(`INSERT INTO postcards (id,body,posted_at,deliver_at,delivered_at,mail_class) VALUES (${id},'hola',NOW(),NOW(),NOW(),'reply')`);
      return id;
    };
    const route = id => api('route', { postcard_id: id, cloud_available: true, cloud_healthy: true,
      model: 'deepseek-v4-flash', local_model: 'test-local' });
    const reserve = (id, provider = 'deepseek', attempt = 'initial') => api('reserve', {
      postcard_id: id, provider, model: provider === 'deepseek' ? 'deepseek-v4-flash' : 'test-local',
      attempt, input_tokens: 20000, max_output_tokens: 512,
    });
    const id = postcard();
    sql(`UPDATE postcards SET visitor_id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE id=${id};
      INSERT INTO postcards (id,body,posted_at,deliver_at,replied_at,visitor_id,mail_class,blocked) VALUES
      (90,'previous greeting',NOW(),NOW(),NOW(),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','reply',0),
      (91,'other sender secret',NOW(),NOW(),NOW(),'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','reply',0),
      (92,'unscreened mail',NOW(),NOW(),NULL,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','fan',0),
      (93,'blocked material',NOW(),NOW(),NOW(),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','reply',1)`);
    const firstRoute = await route(id);
    assert.equal(firstRoute.provider, 'deepseek');
    assert.deepEqual(firstRoute.correspondence.map(c => c.body), ['previous greeting']);
    assert.equal((await route(id)).execute, false, 'lost route acknowledgement never repeats a turn');
    const reserved = await reserve(id);
    assert.equal(reserved.execute, true);
    assert.equal((await reserve(id)).execute, false, 'lost reserve acknowledgement cannot authorize repeat');
    const id2 = postcard();
    assert.equal((await route(id2)).provider, 'ollama', 'concurrency cap gives AUTO local fallback');
    const settled = await api('settle', { request_id: reserved.request_id, status: 'validation_rejected',
      usage: { prompt_tokens: 1000, completion_tokens: 30, cached_tokens: 100 }, latency_ms: 100,
      validation_failure: 'malformed control' });
    assert.ok(settled.cost_gbp > 0);
    assert.equal((await api('settle', { request_id: reserved.request_id, status: 'generated', usage: null, latency_ms: 0 })).duplicate, true);
    const repair = await reserve(id, 'deepseek', 'repair');
    assert.equal(repair.execute, true);
    await api('settle', { request_id: repair.request_id, status: 'generated',
      usage: { prompt_tokens: 1100, completion_tokens: 80 }, latency_ms: 150 });
    assert.equal((await api('outcome', { postcard_id: id, status: 'generated' })).execute, true);
    const ingest = async deliveryId => {
      const response = await fetch(`${base}/api/ingest.php`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'test-key' },
        body: JSON.stringify({ events: [{ delivery_id: deliveryId, kind: 'postcard_out',
          ts: '2026-10-05 12:00:00.000', payload: { id, reply_to: id, body: 'hola, glad you wrote' } }] }) });
      assert.equal(response.status, 200, await response.text());
    };
    await ingest(randomUUID());
    await ingest(randomUUID());
    assert.equal(sql("SELECT COUNT(*) FROM events WHERE kind='postcard_out'"), '1');
    assert.equal(sql(`SELECT publication_result FROM postcard_inference_turns WHERE postcard_id=${id}`), 'published');
    assert.equal((await route(id)).execute, false, 'restart cannot repeat paid/public reply');
    assert.equal((await api('outcome', { postcard_id: id, status: 'generated' })).execute, false);
    // Authenticated ingest above recorded localhost as the fresh owner network.
    const changed = await api('settings', { settings: { enabled: false } }, { Origin: base });
    assert.equal(changed.settings.enabled, false);
    assert.equal((await publicGet('24H')).settings.enabled, false, 'settings persist across requests');
    assert.equal((await route(postcard())).provider, 'ollama');
    await api('settings', { settings: { enabled: true, route: 'DEEPSEEK', requests_hour: 2 } }, { Origin: base });
    const held = await route(postcard());
    assert.equal(held.execute, false);
    assert.match(held.reason, /hour/);
    await api('settings', { settings: { requests_hour: 100, gbp_hour: 0.000001 } }, { Origin: base });
    const capId = postcard();
    assert.equal((await route(capId)).execute, false, 'existing cost cap holds DS-only');
    await api('settings', { settings: { route: 'AUTO', gbp_hour: 0.1 } }, { Origin: base });
    const uncertainId = postcard();
    assert.equal((await route(uncertainId)).provider, 'deepseek');
    const uncertain = await reserve(uncertainId);
    await api('settle', { request_id: uncertain.request_id, status: 'provider_error', usage: null, latency_ms: 10 });
    assert.equal(sql(`SELECT actual_gbp IS NULL FROM postcard_inference_attempts WHERE request_id='${uncertain.request_id}'`), '1');
    assert.equal((await api('fallback', { postcard_id: uncertainId, reason: 'provider_unavailable' })).execute, true);
    const localRetry = await reserve(uncertainId, 'ollama');
    assert.equal(localRetry.execute, true, 'known provider failure falls back without replaying cloud');
    await api('settle', { request_id: localRetry.request_id, status: 'generated',
      usage: { prompt_tokens: 100, completion_tokens: 30 }, latency_ms: 300 });
    // Preflight must reject a call even when the already-spent amount fits.
    const spent = Number(sql("SELECT SUM(COALESCE(actual_gbp,estimated_gbp)) FROM postcard_inference_attempts WHERE provider='deepseek'"));
    await api('settings', { settings: { gbp_hour: spent + 0.00001 } }, { Origin: base });
    const preflightId = postcard();
    assert.equal((await route(preflightId)).provider, 'deepseek');
    const deniedPreflight = await reserve(preflightId);
    assert.equal(deniedPreflight.execute, false);
    assert.equal(deniedPreflight.reason, 'hour_spend_cap');
    assert.equal((await api('fallback', { postcard_id: preflightId, reason: deniedPreflight.reason })).execute, true);
    await api('settings', { settings: { gbp_hour: 0.1 } }, { Origin: base });
    const crashId = postcard();
    assert.equal((await route(crashId)).provider, 'deepseek');
    const crashed = await reserve(crashId);
    sql(`UPDATE postcard_inference_attempts SET created_at=UTC_TIMESTAMP()-INTERVAL 31 MINUTE WHERE request_id='${crashed.request_id}'`);
    assert.equal((await route(postcard())).provider, 'deepseek', 'expired unknown attempt releases concurrency only');
    assert.equal((await reserve(crashId)).execute, false, 'expired attempt can never run again');
    for (const range of ['1H', '24H', '30D', 'ALL']) {
      const report = await publicGet(range);
      assert.equal(report.ok, true);
      assert.ok(report.buckets.length <= 120);
      assert.ok(report.totals.uncertain_gbp > 0);
      assert.ok(!JSON.stringify(report).includes(reserved.request_id), 'public report excludes request identities');
    }
    assert.ok(Number(sql('SELECT COUNT(*) FROM postcard_inference_settings_audit')) >= 4);
  } finally {
    if (server && server.exitCode === null) {
      const exited = new Promise(r => server.once('exit', r)); server.kill(); await exited;
    }
    sql(`DROP DATABASE IF EXISTS ${dbName}`, null);
    await rm(web, { recursive: true, force: true });
  }
});
