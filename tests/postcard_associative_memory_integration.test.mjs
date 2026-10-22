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
    // Exercise the real additive migration over an old row, not just fresh DDL.
    sql('ALTER TABLE postcards DROP COLUMN recall_permission_version, DROP COLUMN recall_permitted_at');
    sql("INSERT INTO postcards(id,mail_class,posted_at) VALUES (3000,'fan_final',NOW()-INTERVAL 1 YEAR)");
    sql(await readFile(join(root, 'sql/032_postcard_public_recollection_permission.sql'), 'utf8'));
    assert.equal(sql('SELECT recall_permission_version IS NULL AND recall_permitted_at IS NULL FROM postcards WHERE id=3000'), '1');
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

    // Complete future-sender opt-in -> publication -> the SAME formation job ->
    // canonical public memory -> associative recall. All text is disposable.
    const submit = async enabled => {
      const fd = new FormData(); fd.set('from', 'FixtureSender');
      fd.set('body', 'my garden seedlings finally grew after all that waiting');
      if (enabled) fd.set('public_recollection', 'compact-public-recall-v1');
      const r = await fetch(`http://127.0.0.1:${port}/api/post-postcard.php`, { method: 'POST', body: fd });
      assert.equal(r.status, 200, await r.clone().text()); return r.json();
    };
    const opted = await submit(true), declined = await submit(false);
    const invalidPermission = new FormData(); invalidPermission.set('from', 'FixtureSender');
    invalidPermission.set('body', 'hello'); invalidPermission.set('public_recollection', 'yes');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/post-postcard.php`, { method: 'POST', body: invalidPermission })).status, 422);
    assert.equal(sql(`SELECT recall_permission_version FROM postcards WHERE id=${opted.id}`), 'compact-public-recall-v1');
    assert.equal(sql(`SELECT recall_permitted_at IS NOT NULL FROM postcards WHERE id=${opted.id}`), '1');
    assert.equal(sql(`SELECT recall_permission_version IS NULL AND recall_permitted_at IS NULL FROM postcards WHERE id=${declined.id}`), '1');
    const publish = async id => {
      const ts = new Date().toISOString().slice(0, 23).replace('T', ' ');
      const events = [
        { delivery_id: randomUUID(), ts, kind: 'postcard_in', payload: { id, claim_generation: 0,
          body: 'my garden seedlings finally grew after all that waiting' } },
        { delivery_id: randomUUID(), ts, kind: 'postcard_out', payload: { id, reply_to: id, claim_generation: 0,
          body: 'i replied that growing things takes care and waiting' } },
      ];
      const r = await fetch(`http://127.0.0.1:${port}/api/ingest.php`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'test-key' }, body: JSON.stringify({ events }) });
      assert.equal(r.status, 200, await r.clone().text());
      return events;
    };
    const sent = await publish(opted.id);
    await publish(declined.id);
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_formation_queue WHERE source_id='postcard-reply:${opted.id}'`), '1');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_formation_queue WHERE source_id='postcard-reply:${declined.id}'`), '0');
    const visitor = sql(`SELECT visitor_id FROM postcards WHERE id=${opted.id}`);
    const claimed = (await api('claim_source', { sender_only: true, visitor_id: visitor })).body.job;
    assert.equal(claimed.source.publicExchange.postcardId, opted.id);
    assert.equal(claimed.source.publicExchange.correspondentText, sent[0].payload.body);
    const senderId = randomUUID();
    const completion = { job_id: Number(claimed.id), claim_token: claimed.claim_token, result_category: 'CREATE',
      operations: [{ decision: 'CREATE', memoryId: senderId, type: 'EPISODIC', privacyScope: 'SENDER_RECALLABLE',
        content: 'Cy replied about growing things.', source: claimed.source }],
      public_recollection: { basis: 'POSTCARD', summary: 'Patience helped with growing seedlings.' } };
    const formed = await api('finish_source', completion);
    assert.equal(formed.status, 200, JSON.stringify(formed.body));
    const publicId = formed.body.public_recollection.memory_id;
    assert.ok(publicId);
    assert.equal(sql(`SELECT privacy_scope FROM autobiographical_memories WHERE id='${senderId}'`), 'SENDER_RECALLABLE');
    assert.equal(sql(`SELECT origin_kind FROM autobiographical_memories WHERE id='${senderId}'`), 'CORRESPONDENCE_EXCHANGE');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_sources WHERE memory_id='${senderId}' AND source_visibility='SENDER_RECALLABLE'`), '2');
    assert.equal(sql(`SELECT CONCAT(origin_kind,':',consistency_status,':',public_summary) FROM autobiographical_memories WHERE id='${publicId}'`),
      'POSTCARD:UNCERTAIN:A correspondent told Cy: Patience helped with growing seedlings.');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_sources WHERE memory_id='${publicId}' AND source_visibility='SENDER_RECALLABLE'`), '2');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_sources s JOIN postcards p ON p.id=${opted.id}
      WHERE s.memory_id='${publicId}' AND s.source_type='POSTCARD' AND s.source_timestamp=p.posted_at`), '1');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_sources WHERE memory_id='${publicId}' AND source_excerpt LIKE '%compact-public-recall-v1%'`), '2');
    assert.equal((await api('finish_source', completion)).body.duplicate, true);
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_revisions WHERE memory_id='${publicId}'`), '1');
    // Public summaries cannot consume the five sender formation candidate slots.
    for (let i = 0; i < 8; i++) memory(randomUUID(), 'EPISODIC', 'PUBLIC_RECALLABLE', visitor, 'CY_REPLY',
      'garden seedlings patience', 'Cy replied about garden seedlings patience.');
    const formationCandidates = (await api('query', { visitor_id: visitor, limit: 5,
      query: { text: 'garden seedlings patience', sender_formation_only: true } })).body.candidates;
    assert.ok(formationCandidates.some(m => m.id === senderId));
    assert.ok(formationCandidates.every(m => m.privacyScope === 'SENDER_RECALLABLE'));
    const reused = (await api('postcard_associations', { visitor_id: other, query: { text: 'patience seedlings' } })).body.candidates;
    assert.ok(reused.some(m => m.id === publicId && m.sourceKeys.includes(`exchange:${opted.id}`)));
    assert.ok(!JSON.stringify(reused).includes(sent[0].payload.body));
    // Neither publication replay nor duplicate source enqueue reopens formation.
    const again = await fetch(`http://127.0.0.1:${port}/api/ingest.php`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'test-key' }, body: JSON.stringify({ events: sent }) });
    assert.equal(again.status, 200, await again.clone().text());
    await api('enqueue_source', { source: claimed.source });
    assert.equal((await api('claim_source', { sender_only: true, visitor_id: visitor })).body.job, null);

    const fixture = async (id, permission, published, summary, invalidate = false) => {
      sql(`INSERT INTO postcards(id,visitor_id,from_name,body,posted_at,deliver_at,recall_permission_version,recall_permitted_at)
        VALUES (${id},'${other}','FixtureSender','a disposable greeting',NOW(),NOW(),${permission ? "'compact-public-recall-v1',NOW(3)" : 'NULL,NULL'})`);
      if (published) await publish(id);
      const s = { sourceType: 'CY_REPLY', sourceId: `postcard-reply:${id}`, subjectVisitorId: other,
        sourceVisibility: 'SENDER_RECALLABLE', text: 'a short reply', publicExchange: { permissionVersion: 'forged' },
        pairedExchangeReplySeq: 999999 };
      await api('enqueue_source', { source: s });
      const job = (await api('claim_source', { sender_only: true, visitor_id: other })).body.job;
      assert.ok(job);
      assert.equal(!!job.source.publicExchange, permission && published);
      assert.equal(!!job.source.pairedExchangeReplySeq, permission && published, 'enqueue cannot forge the pairing receipt');
      if (invalidate) sql(`UPDATE postcards SET blocked=1 WHERE id=${id}`);
      const retainedId = randomUUID();
      const result = (await api('finish_source', { job_id: Number(job.id), claim_token: job.claim_token,
        result_category: invalidate ? 'CREATE' : 'NOTHING', operations: invalidate ? [{
          decision: 'CREATE', memoryId: retainedId, type: 'EPISODIC', privacyScope: 'SENDER_RECALLABLE',
          content: 'Cy replied about patience.', source: job.source,
        }] : [], public_recollection: summary })).body;
      if (invalidate) assert.equal(sql(`SELECT privacy_scope FROM autobiographical_memories WHERE id='${retainedId}'`), 'SENDER_RECALLABLE');
      return result;
    };
    const proposal = { basis: 'CY_REPLY', summary: 'Patience with growing things mattered to Cy.' };
    assert.equal((await fixture(1001, false, true, proposal)).public_recollection.status, 'REJECTED', 'historical/default and opted-out fail closed');
    assert.equal((await fixture(1002, true, false, proposal)).public_recollection.status, 'REJECTED', 'unpublished opt-in fails closed');
    assert.equal((await fixture(1003, true, true, null)).public_recollection, null, 'trivial opted-in exchange need not form any memory');
    assert.equal((await fixture(1004, true, true, proposal, true)).public_recollection.status, 'REJECTED', 'publication eligibility is rechecked after inference, not just at claim');
    // Model saw the pair before it was blocked. Private provenance must retain
    // both sources even though optional public permission no longer suffices.
    assert.equal(sql("SELECT COUNT(*) FROM autobiographical_memory_sources WHERE source_type='POSTCARD' AND source_id='postcard:1004'"), '1');
    assert.equal(sql("SELECT COUNT(*) FROM autobiographical_memories WHERE privacy_scope='SENDER_RECALLABLE' AND origin_kind='CORRESPONDENCE_EXCHANGE'"), '2');
    // A normal incoming POSTCARD job can find the already-formed private
    // exchange topic and UPDATE it, rather than losing it behind public rows.
    sql(`INSERT INTO postcards(id,visitor_id,from_name,posted_at,deliver_at,recall_permission_version,recall_permitted_at)
      VALUES (1005,'${other}','FixtureSender',NOW(),NOW(),'compact-public-recall-v1',NOW(3))`);
    await publish(1005);
    const pairedJob = (await api('claim_source', { sender_only: true, visitor_id: other })).body.job;
    const topicId = randomUUID();
    await api('finish_source', { job_id: Number(pairedJob.id), claim_token: pairedJob.claim_token, result_category: 'CREATE',
      operations: [{ decision: 'CREATE', memoryId: topicId, type: 'UNRESOLVED_THREAD', privacyScope: 'SENDER_RECALLABLE',
        content: 'The sender will report more about garden seedlings.', source: pairedJob.source }], public_recollection: null });
    const incoming = { sourceType: 'POSTCARD', sourceId: 'postcard:1005', subjectVisitorId: other,
      sourceVisibility: 'SENDER_RECALLABLE', text: 'more garden seedlings news' };
    await api('enqueue_source', { source: incoming });
    const incomingJob = (await api('claim_source', { sender_only: true, visitor_id: other })).body.job;
    assert.ok((await api('query', { visitor_id: other, query: { text: incoming.text, sender_formation_only: true }, limit: 5 })).body.candidates.some(m => m.id === topicId));
    const update = { job_id: Number(incomingJob.id), claim_token: incomingJob.claim_token, result_category: 'UPDATE',
      operations: [{ decision: 'UPDATE', memoryId: topicId, expectedVersion: 1,
        content: 'The sender plans to report the next garden seedlings result.', source: incomingJob.source }] };
    assert.equal((await api('finish_source', update)).status, 200);
    assert.equal((await api('finish_source', update)).body.duplicate, true);
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memories WHERE id='${topicId}'`), '1');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_sources WHERE memory_id='${topicId}'`), '2');
    assert.equal(sql("SELECT COUNT(*) FROM autobiographical_memories WHERE privacy_scope='PUBLIC_RECALLABLE' AND classification='opted-in correspondence recollection'"), '1');
    assert.equal(sql('SELECT COUNT(*) FROM memory_formation_inference_attempts'), '0', 'no provider inference');
  } finally {
    if (server && server.exitCode === null) {
      const exited = new Promise(r => server.once('exit', r)); server.kill(); await exited;
    }
    sql(`DROP DATABASE IF EXISTS ${database}`, null);
    await rm(web, { recursive: true, force: true });
  }
});
