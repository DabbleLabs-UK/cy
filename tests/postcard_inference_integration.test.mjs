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
    // Exercise the pre-existing indexed memory API, not a provider-specific
    // transcript lookup. Old sender/topic records survive many newer exchanges.
    const sender = 'a'.repeat(32), other = 'b'.repeat(32);
    const personId = randomUUID(), topicId = randomUUID(), publicId = randomUUID(), privateId = randomUUID();
    const memoryRow = (id, type, scope, who, content, summary, date) =>
      `('${id}','${type}','${scope}','${who}','${content}',${summary ? `'${summary}'` : 'NULL'},'${date}','${date}')`;
    const rows = [
      memoryRow(personId, 'PERSON', 'SENDER_RECALLABLE', sender, 'Ana tends a garden', null, '2025-01-01'),
      memoryRow(topicId, 'UNRESOLVED_THREAD', 'SENDER_RECALLABLE', sender, 'The garden seedlings question remains unanswered', null, '2025-01-02'),
      memoryRow(publicId, 'EPISODIC', 'PUBLIC_RECALLABLE', other, 'PRIVATE identifying garden wording', 'Another visitor described a garden', '2025-01-03'),
      memoryRow(privateId, 'PERSON', 'SENDER_RECALLABLE', other, 'PRIVATE other garden history', null, '2025-01-04'),
      ...Array.from({ length: 300 }, () => memoryRow(randomUUID(), 'EPISODIC', 'SENDER_RECALLABLE', other, 'unrelated correspondence', null, '2026-10-01')),
    ];
    sql(`INSERT INTO autobiographical_memories (id,memory_type,privacy_scope,subject_visitor_id,content,public_summary,created_at,updated_at) VALUES ${rows.join(',')}`);
    sql(`INSERT INTO autobiographical_memory_sources (memory_id,source_type,source_id,source_visibility,created_at)
      SELECT id,'POSTCARD',CONCAT('test-card:',id),privacy_scope,created_at FROM autobiographical_memories`);
    const recalledResponse = await fetch(`${base}/api/memory.php`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'test-key' },
      body: JSON.stringify({ action: 'query', visitor_id: sender, query: { text: 'garden seedlings' }, limit: 10 }),
    });
    assert.equal(recalledResponse.status, 200);
    const recalled = await recalledResponse.json();
    assert.deepEqual(new Set(recalled.candidates.map(m => m.id)), new Set([personId, topicId, publicId]));
    assert.ok(recalled.candidates.length <= 10, 'many exchanges never become a whole transcript');
    assert.match(recalled.candidates.find(m => m.id === topicId).content, /unanswered/);
    assert.equal(recalled.candidates.find(m => m.id === publicId).content, 'Another visitor described a garden');
    assert.doesNotMatch(JSON.stringify(recalled.candidates), /PRIVATE/);
    assert.ok(recalled.retrieval.mechanisms.includes('EXACT_PERSON'));
    // Sender continuity is its own bounded canonical read, not the newest
    // general-purpose candidate pool or an unbounded correspondence transcript.
    const archivedPerson = randomUUID(), archivedTopic = randomUUID();
    const extraPeople = Array.from({ length: 120 }, () => randomUUID());
    const extraTopics = Array.from({ length: 120 }, () => randomUUID());
    const continuityRows = [
      ...Array.from({ length: 320 }, () => memoryRow(randomUUID(), 'EPISODIC', 'SENDER_RECALLABLE', sender, 'new ordinary correspondence', null, '2026-10-04')),
      ...extraPeople.map(id => memoryRow(id, 'PERSON', 'SENDER_RECALLABLE', sender, 'Another retained personal fact', null, '2026-10-03')),
      ...extraTopics.map(id => memoryRow(id, 'UNRESOLVED_THREAD', 'SENDER_RECALLABLE', sender, 'Another unresolved topic', null, '2026-10-03')),
      memoryRow(archivedPerson, 'PERSON', 'SENDER_RECALLABLE', sender, 'PRIVATE archived garden detail', null, '2026-10-04'),
      memoryRow(archivedTopic, 'UNRESOLVED_THREAD', 'SENDER_RECALLABLE', sender, 'PRIVATE resolved garden question', null, '2026-10-04'),
    ];
    sql(`INSERT INTO autobiographical_memories (id,memory_type,privacy_scope,subject_visitor_id,content,public_summary,created_at,updated_at) VALUES ${continuityRows.join(',')}`);
    sql(`UPDATE autobiographical_memories SET status='ARCHIVED' WHERE id IN ('${archivedPerson}','${archivedTopic}')`);
    sql(`UPDATE autobiographical_memories SET version=3 WHERE id='${personId}'`);
    const memoryApi = async (payload, key = 'test-key') => fetch(`${base}/api/memory.php`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': key },
      body: JSON.stringify({ action: 'sender_continuity', ...payload }),
    });
    assert.equal((await memoryApi({ visitor_id: sender }, 'wrong-key')).status, 401);
    assert.equal((await memoryApi({})).status, 422);
    assert.equal((await memoryApi({ visitor_id: 'not-a-sender' })).status, 422);
    const continuityResponse = await memoryApi({ visitor_id: sender, query: { text: 'garden seedlings' } });
    assert.equal(continuityResponse.status, 200);
    const continuity = await continuityResponse.json();
    assert.equal(continuity.ok, true);
    assert.equal(continuity.candidates.length, 4);
    assert.equal(continuity.candidates.filter(m => m.type === 'PERSON').length, 2);
    assert.equal(continuity.candidates.filter(m => m.type === 'UNRESOLVED_THREAD').length, 2);
    const oldPerson = continuity.candidates.find(m => m.id === personId);
    const oldTopic = continuity.candidates.find(m => m.id === topicId);
    assert.equal(oldPerson.content, 'Ana tends a garden', '320 newer sender exchanges cannot displace retained PERSON facts');
    assert.equal(oldTopic.content, 'The garden seedlings question remains unanswered');
    assert.equal(oldPerson.version, 3);
    assert.equal(oldPerson.sourceCount, 1, 'canonical source provenance survives selection');
    assert.equal(oldPerson.matchProvenance.structured_sender_identity, true);
    assert.ok(oldPerson.reasons.includes('DIRECT_SENDER_HISTORY'));
    assert.ok(continuity.candidates.every(m => m.subjectVisitorId === sender && m.status === 'ACTIVE'));
    assert.ok(continuity.candidates.every(m => ![publicId, privateId, archivedPerson, archivedTopic].includes(m.id)));
    assert.doesNotMatch(JSON.stringify(continuity.candidates), /PRIVATE|new ordinary correspondence/);
    assert.equal(continuity.retrieval.per_type_limit, 2);
    assert.equal(continuity.retrieval.candidate_pool_per_type, 300);
    assert.equal(continuity.retrieval.candidate_pool_per_mechanism, 100);
    assert.ok(Number.isFinite(continuity.retrieval.duration_ms));
    const repeated = await (await memoryApi({ visitor_id: sender, query: { text: 'garden seedlings' } })).json();
    assert.deepEqual(repeated.candidates, continuity.candidates, 'equal-rank selection is stable');
    const empty = await (await memoryApi({ visitor_id: 'c'.repeat(32) })).json();
    assert.deepEqual(empty.candidates, [], 'no other visitor records are substituted for an empty sender');
    sql(`INSERT INTO autobiographical_memory_tags (memory_id,tag) VALUES ('${personId}','sender-hobby'),('${topicId}','pending-seedlings')`);
    const tagged = await (await memoryApi({ visitor_id: sender, query: { tags: ['sender-hobby', 'pending-seedlings'] } })).json();
    assert.ok(tagged.candidates.some(m => m.id === personId), 'indexed tags can independently recover old PERSON facts');
    assert.ok(tagged.candidates.some(m => m.id === topicId), 'indexed tags can independently recover old unresolved topics');
    assert.ok(tagged.candidates.every(m => m.subjectVisitorId === sender));
    const indexedPlan = sql(`EXPLAIN SELECT id FROM autobiographical_memories
      WHERE subject_visitor_id='${sender}' AND status='ACTIVE' AND memory_type='PERSON'
      AND privacy_scope IN ('INTERNAL_ONLY','SENDER_RECALLABLE','PUBLIC_RECALLABLE')
      ORDER BY updated_at DESC,id ASC LIMIT 100`);
    assert.match(indexedPlan, /idx_memory_(subject|type)/, 'continuity lookup uses existing source indexes');
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
    const firstRoute = await route(id);
    assert.equal(firstRoute.provider, 'deepseek');
    assert.equal(firstRoute.correspondence, undefined, 'accounting is not a second memory/history source');
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
