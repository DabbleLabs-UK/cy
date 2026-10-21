// Opt-in, owned disposable MariaDB + actual authenticated PHP API. No inference.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('indexed associative API, scope, episode groups, source logging and unchanged sender layer', {
  skip: process.env.CY_TEST_DB_ISOLATED !== '1',
}, async () => {
  const database = `cy_assoc_${randomBytes(6).toString('hex')}`;
  const sql = (query, db = database) => {
    const r = spawnSync(process.env.CY_TEST_MARIADB_BIN, [`--defaults-file=${process.env.CY_TEST_DB_DEFAULTS}`,
      '-h', '127.0.0.1', '-P', process.env.CY_TEST_DB_PORT, '-u', 'root', '--batch', '--skip-column-names', '--raw', ...(db ? [db] : [])],
    { input: query, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  const web = await mkdtemp(join(tmpdir(), 'cy-assoc-web-'));
  let server;
  try {
    sql(`CREATE DATABASE ${database}`, null);
    sql(await readFile(join(root, 'sql/schema.sql'), 'utf8'));
    await cp(join(root, 'lib'), join(web, 'lib'), { recursive: true });
    await cp(join(root, 'public/api'), join(web, 'public/api'), { recursive: true });
    await cp(join(root, 'config'), join(web, 'config'), { recursive: true });
    await writeFile(join(web, 'config/config.php'), `<?php return ['db'=>['host'=>'127.0.0.1;port=${process.env.CY_TEST_DB_PORT}',
      'name'=>'${database}','user'=>'root','pass'=>'','charset'=>'utf8mb4'],'ingest_key'=>'test-key','cookie_secret'=>'test-cookie'];`);
    const listener = createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
    const port = listener.address().port; await new Promise(r => listener.close(r));
    server = spawn(process.env.CY_TEST_PHP_BIN, ['-d', 'extension=pdo_mysql', '-S', `127.0.0.1:${port}`, '-t', join(web, 'public')],
      { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let errors = ''; server.stderr.on('data', b => { errors += b; });
    const url = `http://127.0.0.1:${port}/api/memory.php`;
    let ready = false;
    for (let i = 0; i < 50; i++) { try { await fetch(url); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.equal(ready, true, errors);
    const api = async (action, data = {}, key = 'test-key') => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': key }, body: JSON.stringify({ action, ...data }) });
      return { status: r.status, body: await r.json() };
    };
    const sender = 'a'.repeat(32), other = 'b'.repeat(32);
    const own = randomUUID(), topic = randomUUID(), publicCard = randomUUID(), publicReply = randomUUID(), prison = randomUUID(), privateId = randomUUID();
    const memory = (id, type, scope, subject, origin, content, summary = null) => sql(`INSERT INTO autobiographical_memories
      (id,memory_type,privacy_scope,subject_visitor_id,origin_kind,content,public_summary,created_at,updated_at)
      VALUES ('${id}','${type}','${scope}',${subject ? `'${subject}'` : 'NULL'},'${origin}','${content}',${summary ? `'${summary}'` : 'NULL'},NOW(),NOW())`);
    const source = (id, type, sourceId, visibility) => sql(`INSERT INTO autobiographical_memory_sources
      (memory_id,source_type,source_id,source_visibility,source_timestamp,created_at) VALUES ('${id}','${type}','${sourceId}','${visibility}',NOW(),NOW())`);
    memory(own, 'PERSON', 'SENDER_RECALLABLE', sender, 'POSTCARD', 'The sender tends garden seedlings.');
    memory(topic, 'UNRESOLVED_THREAD', 'SENDER_RECALLABLE', sender, 'POSTCARD', 'The sender awaits the garden seedlings result.');
    memory(publicCard, 'EPISODIC', 'PUBLIC_RECALLABLE', other, 'POSTCARD', 'SECRET ADDRESS garden seedlings', 'A correspondent described tending garden seedlings.');
    memory(publicReply, 'EPISODIC', 'PUBLIC_RECALLABLE', other, 'CY_REPLY', 'SECRET REPLY', 'Cy replied about garden seedlings.');
    memory(prison, 'EPISODIC', 'INTERNAL_ONLY', null, 'ENVIRONMENT_EVENT', 'Cy saw garden seedlings during exercise.');
    memory(privateId, 'PERSON', 'SENDER_RECALLABLE', other, 'POSTCARD', 'SECRET OTHER garden seedlings');
    source(own, 'POSTCARD', 'postcard:5', 'SENDER_RECALLABLE'); source(topic, 'POSTCARD', 'postcard:6', 'SENDER_RECALLABLE');
    source(publicCard, 'POSTCARD', 'postcard:7', 'SENDER_RECALLABLE'); source(publicReply, 'CY_REPLY', 'postcard-reply:7', 'SENDER_RECALLABLE');
    source(prison, 'ENVIRONMENT_EVENT', 'env-garden', 'INTERNAL_ONLY'); source(privateId, 'POSTCARD', 'postcard:8', 'SENDER_RECALLABLE');
    const input = { visitor_id: sender, query: { text: 'garden seedlings' }, exclude_ids: [own, topic] };
    const result = await api('postcard_associations', input);
    assert.equal(result.status, 200, errors + JSON.stringify(result.body));
    assert.equal(result.body.candidates.length, 2);
    assert.ok(result.body.candidates.some(m => m.id === prison));
    assert.equal(result.body.candidates.filter(m => m.sourceKeys.includes('exchange:7')).length, 1);
    assert.doesNotMatch(JSON.stringify(result.body), /SECRET|ADDRESS/);
    assert.ok(!result.body.consideredIds.includes(privateId));
    assert.equal((await api('postcard_associations', { ...input, query: { text: 'zeppelin' } })).body.candidates.length, 0);
    assert.equal((await api('postcard_associations', input, 'invalid')).status, 401);
    const continuity = await api('sender_continuity', input);
    assert.deepEqual(new Set(continuity.body.candidates.map(m => m.id)), new Set([own, topic]));
    // Actual existing query ledger persists considered/offered/inserted separately.
    const offered = result.body.candidates.map(m => m.id), inserted = offered.slice(0, 1);
    const logged = await api('record_query', { generation_ref: 'postcard-assoc:fixture', query_source_type: 'POSTCARD_ASSOCIATIVE',
      candidate_memory_ids: result.body.consideredIds, offered_memory_ids: offered, selected_memory_ids: inserted,
      inserted_memory_ids: inserted, candidate_match_provenance: { [offered[0]]: { sourceRefs: result.body.candidates[0].sourceRefs } } });
    assert.equal(logged.status, 200);
    assert.equal(sql("SELECT CONCAT(JSON_LENGTH(offered_memory_ids),':',JSON_LENGTH(inserted_memory_ids)) FROM autobiographical_memory_queries WHERE generation_ref='postcard-assoc:fixture'"), '2:1');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memories WHERE privacy_scope='SENDER_RECALLABLE'`), '3');
    // A real canonical episode key groups multiple environment stages too.
    const extra = randomUUID(); memory(extra, 'EPISODIC', 'INTERNAL_ONLY', null, 'ENVIRONMENT_EVENT', 'Cy recalled garden seedlings.');
    source(extra, 'ENVIRONMENT_EVENT', 'env-garden-2', 'INTERNAL_ONLY');
    for (const event of ['env-garden', 'env-garden-2']) sql(`INSERT INTO environment_events(event_id,occurred_at,event_type,event_family,record)
      VALUES ('${event}',NOW(),'test','test','{"world_event":{"world":{"search_episode":{"id":"search-garden"}}}}')`);
    const episodes = (await api('postcard_associations', input)).body;
    assert.equal(episodes.candidates.filter(m => m.sourceKeys.includes('episode:search-garden')).length, 1);
  } finally {
    if (server && server.exitCode === null) {
      const exited = new Promise(r => server.once('exit', r)); server.kill(); await exited;
    }
    sql(`DROP DATABASE IF EXISTS ${database}`, null);
    await rm(web, { recursive: true, force: true });
  }
});
