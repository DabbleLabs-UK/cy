// Explicit opt-in: exclusively owned loopback MariaDB and copied PHP API.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterMemoriesBeforePrompt } from '../runner/autobiographical-memory.js';

test('acknowledged cue, immutable one-attempt slot, canonical readiness and one-use consumption', {
  skip: process.env.CY_TEST_DB_ISOLATED !== '1',
}, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const database = `cy_journal_prep_${randomBytes(6).toString('hex')}`;
  const port = Number(process.env.CY_TEST_DB_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && process.env.CY_TEST_DB_DEFAULTS && process.env.CY_TEST_MARIADB_BIN && process.env.CY_TEST_PHP_BIN);
  const sql = (query, db = database) => {
    const result = spawnSync(process.env.CY_TEST_MARIADB_BIN, [
      `--defaults-file=${process.env.CY_TEST_DB_DEFAULTS}`, '-h', '127.0.0.1', '-P', String(port),
      '-u', 'root', '--batch', '--skip-column-names', '--raw', ...(db ? [db] : []),
    ], { input: query, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const web = await mkdtemp(join(tmpdir(), 'cy-journal-prep-api-'));
  let server;
  try {
    sql(`CREATE DATABASE ${database}`, null);
    sql(await readFile(join(root, 'sql/schema.sql'), 'utf8'));
    sql((await readFile(join(root, 'sql/017_memory_runtime_queue.sql'), 'utf8')).replaceAll('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '));
    for (const folder of ['lib', 'public/api', 'config']) await cp(join(root, folder), join(web, folder), { recursive: true });
    await writeFile(join(web, 'config/config.php'), `<?php return [
      'db'=>['host'=>'127.0.0.1;port=${port}','name'=>'${database}','user'=>'root','pass'=>'','charset'=>'utf8mb4'],
      'ingest_key'=>'test-key','cookie_secret'=>'test-cookie'];`);
    const listener = createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const httpPort = listener.address().port; await new Promise(resolve => listener.close(resolve));
    server = spawn(process.env.CY_TEST_PHP_BIN, ['-d', 'extension=pdo_mysql', '-S', `127.0.0.1:${httpPort}`, '-t', join(web, 'public')],
      { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let errors = ''; server.stderr.on('data', data => { errors += data; });
    const endpoint = `http://127.0.0.1:${httpPort}/api/memory.php`;
    for (let i = 0; i < 60; i++) {
      try { await fetch(endpoint); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    const api = async (action, input = {}, expected = 200) => {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'test-key' }, body: JSON.stringify({ action, ...input }) });
      const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data) + errors.slice(-1500)); return data;
    };
    const hash = text => createHash('sha256').update(text).digest('hex');
    const record = { world_event: { id: 'env-synthetic-journal', timestamp: '2026-10-28T10:00:00.000Z',
      event_type: 'observed_search', event_family: 'institutional', world: { context: { location: 'CELL' } } },
    observation: { summary: 'A synthetic search happened.' }, consumed_by: ['soma-input-staging-v1'] };
    const cue = { version: 'cy.journal-cue.v1', sourceEventId: record.world_event.id, occurredAt: record.world_event.timestamp,
      eventType: 'observed_search', eventFamily: 'institutional', text: record.observation.summary,
      tags: ['institutional', 'observed_search'], location: 'CELL', scope: 'NO_SENDER_JOURNAL' };
    cue.digest = hash(JSON.stringify(Object.values(cue)));
    const sourceSql = value => sql(`REPLACE INTO environment_events (event_id,occurred_at,event_type,event_family,record)
      VALUES ('${record.world_event.id}','2026-10-28 10:00:00','observed_search','institutional','${JSON.stringify(value).replaceAll("'", "''")}')`);
    const binding = anchor => ({ version: 'cy.journal-preparation.v1', slotAnchorMs: anchor,
      slotKey: hash('cy.journal-preparation.v1:' + anchor), cue });
    const context = envelope => ({ generationRef: 'journal:' + envelope.slotAnchorMs, text: cue.text,
      tags: cue.tags, location: cue.location, journalPreparation: envelope });
    const enqueue = (envelope, expected = 200) => api('enqueue_surfacing', {
      context_fingerprint: envelope.slotKey, context: context(envelope),
    }, expected);
    const proof = envelope => ({ context_fingerprint: envelope.slotKey, journal_preparation: envelope });
    const claim = async envelope => (await api('claim_surfacing', { journal_context_fingerprint: envelope.slotKey })).job;
    const first = binding(1793181600000);
    await enqueue(first, 422);
    sourceSql({ ...record, consumed_by: [] }); await enqueue(first, 422);
    sourceSql(record); assert.equal((await enqueue(first)).queued, true);
    assert.equal((await enqueue(first)).queued, false, 'same slot replay must not create another budget');
    const wrongCue = { ...first, cue: { ...cue, text: 'forged' } };
    await enqueue(wrongCue, 422);
    const anotherRecord = structuredClone(record); anotherRecord.world_event.id = 'env-other';
    sql(`INSERT INTO environment_events (event_id,occurred_at,event_type,event_family,record)
      VALUES ('env-other','2026-10-28 10:00:00','observed_search','institutional','${JSON.stringify(anotherRecord)}')`);
    const anotherCue = { ...cue, sourceEventId: 'env-other' }; delete anotherCue.digest;
    anotherCue.digest = hash(JSON.stringify(Object.values(anotherCue)));
    await enqueue({ ...first, cue: anotherCue }, 409);
    const seed = randomUUID();
    sql(`INSERT INTO autobiographical_memories
      (id,memory_type,status,privacy_scope,content,origin_kind,created_at,updated_at)
      VALUES ('${seed}','EPISODIC','ACTIVE','INTERNAL_ONLY','synthetic observed search','ENVIRONMENT_EVENT',NOW(3),NOW(3))`);
    const memoriesBefore = sql('SELECT * FROM autobiographical_memories');
    const queryResult = await api('query', { query: { text: 'synthetic observed search' }, journal_preparation: first });
    const retrieved = queryResult.candidates;
    const versions = queryResult.journal_candidate_versions;
    assert.equal(versions[seed], 1, 'query carries exact authoritative candidate version outside prose');
    const selected = filterMemoriesBeforePrompt(retrieved);
    assert.equal(selected.length, 1); assert.equal(selected[0].status, 'ACTIVE');
    const otherFingerprint = hash('other-consumer');
    await api('enqueue_surfacing', { context_fingerprint: otherFingerprint, priority: 100, context: { generationRef: 'other:1' } });
    await api('claim_surfacing', { journal_preparation_only: true }, 422);
    await api('claim_surfacing', { journal_preparation_only: 1, journal_context_fingerprint: first.slotKey }, 422);
    const job = (await api('claim_surfacing', { journal_context_fingerprint: first.slotKey, journal_preparation_only: true })).job;
    assert.equal(job.context_fingerprint, first.slotKey);
    assert.equal(sql(`SELECT status FROM autobiographical_memory_surfacing_queue WHERE context_fingerprint='${otherFingerprint}'`), 'PENDING');
    sql(`UPDATE autobiographical_memory_surfacing_queue SET status='PREPARED' WHERE context_fingerprint='${otherFingerprint}'`);
    assert.equal(sql(`SELECT attempts FROM autobiographical_memory_surfacing_queue WHERE id=${job.id}`), '1');
    const setId = randomUUID();
    const completed = await api('complete_surfacing', { job_id: Number(job.id), prepared_set_id: setId,
      result_category: 'PREPARED', candidate_ids: [seed], selected_memories: selected, journal_candidate_versions: versions });
    assert.equal(completed.status, 'PREPARED');
    const replay = await api('complete_surfacing', { job_id: Number(job.id), prepared_set_id: randomUUID(), result_category: 'PREPARED', candidate_ids: [seed], selected_memories: selected });
    assert.equal(replay.duplicate, true); assert.equal(replay.prepared_set_id, setId);
    await enqueue(first); assert.equal(await claim(first), null, 'completion and enqueue replay cannot re-ask');
    await api('enqueue_surfacing', { context_fingerprint: first.slotKey, context: { generationRef: 'other:collision' } }, 409);
    assert.equal(sql(`SELECT status FROM autobiographical_memory_surfacing_queue WHERE id=${job.id}`), 'PREPARED', 'legacy enqueue cannot reopen a protected slot');
    assert.equal((await api('prepared_get', { context_fingerprint: first.slotKey })).prepared_set, null, 'missing cue proof fails closed');
    const ready = (await api('prepared_get', proof(first))).prepared_set;
    assert.deepEqual(ready.selected_memories, selected); assert.deepEqual(ready.journal_preparation, first);
    assert.equal((await api('prepared_get', { ...proof(first), journal_preparation: wrongCue })).prepared_set, null);
    sql(`UPDATE autobiographical_memories SET status='ARCHIVED' WHERE id='${seed}'`);
    assert.equal((await api('prepared_get', proof(first))).prepared_set, null, 'current canonical status must still be ACTIVE');
    sql(`UPDATE autobiographical_memories SET status='ACTIVE',content='changed' WHERE id='${seed}'`);
    assert.equal((await api('prepared_get', proof(first))).prepared_set, null, 'changed canonical content cannot replace original selection');
    sql(`UPDATE autobiographical_memories SET content='synthetic observed search',privacy_scope='SENDER_RECALLABLE' WHERE id='${seed}'`);
    assert.equal((await api('prepared_get', proof(first))).prepared_set, null, 'private status change cannot pass');
    sql(`UPDATE autobiographical_memories SET privacy_scope='INTERNAL_ONLY' WHERE id='${seed}'`);
    assert.equal((await api('prepared_get', proof(first))).prepared_set.id, setId);
    sql(`UPDATE autobiographical_memories SET origin_kind='CY_EXPRESSION' WHERE id='${seed}'`);
    assert.equal((await api('prepared_get', proof(first))).prepared_set, null, 'changed provenance must not be silently relabelled');
    sql(`UPDATE autobiographical_memories SET origin_kind='ENVIRONMENT_EVENT' WHERE id='${seed}'`);
    sql(`UPDATE autobiographical_memory_prepared_sets SET expires_at=NOW()-INTERVAL 1 SECOND WHERE id='${setId}'`);
    assert.equal((await api('prepared_get', proof(first))).prepared_set, null, 'expiry does not extend readiness');
    sql(`UPDATE autobiographical_memory_prepared_sets SET expires_at=NOW()+INTERVAL 15 MINUTE WHERE id='${setId}'`);
    await api('consume_prepared', { prepared_set_id: setId, generation_ref: 'journal-prose:1' }, 409);
    await api('consume_prepared', { prepared_set_id: setId, generation_ref: 'journal-prose:1', journal_preparation: first });
    await api('consume_prepared', { prepared_set_id: setId, generation_ref: 'journal-prose:2', journal_preparation: first }, 409);
    assert.equal((await api('prepared_get', proof(first))).prepared_set, null, 'consumed preparation cannot reappear');
    const second = binding(first.slotAnchorMs + 1800000); await enqueue(second);
    const secondJob = await claim(second);
    await api('complete_surfacing', { job_id: Number(secondJob.id), result_category: 'TIMEOUT' });
    await enqueue(second); assert.equal(await claim(second), null, 'timeout does not buy a same-slot retry');
    assert.equal(sql(`SELECT CONCAT(status,':',attempts) FROM autobiographical_memory_surfacing_queue WHERE id=${secondJob.id}`), 'FAILED:1');
    const third = binding(second.slotAnchorMs + 1800000); await enqueue(third);
    const thirdJob = await claim(third);
    sql(`UPDATE autobiographical_memory_surfacing_queue SET started_at=NOW()-INTERVAL 11 MINUTE WHERE id=${thirdJob.id}`);
    assert.equal(await claim(third), null, 'crash recovery cannot re-ask an admitted slot');
    assert.equal(sql(`SELECT status FROM autobiographical_memory_surfacing_queue WHERE id=${thirdJob.id}`), 'FAILED');
    const fourth = binding(third.slotAnchorMs + 1800000); await enqueue(fourth);
    await api('claim_surfacing', { journal_context_fingerprint: null });
    assert.equal(sql(`SELECT status FROM autobiographical_memory_surfacing_queue WHERE context_fingerprint='${fourth.slotKey}'`), 'SUPERSEDED');
    const empty = binding(fourth.slotAnchorMs + 1800000); await enqueue(empty);
    const emptyJob = await claim(empty);
    const emptySetId = randomUUID();
    await api('complete_surfacing', { job_id: Number(emptyJob.id), prepared_set_id: emptySetId,
      result_category: 'NO_CANDIDATES', candidate_ids: [], selected_memories: [] });
    assert.deepEqual((await api('prepared_get', proof(empty))).prepared_set.selected_memories, [], 'zero-result search is never populated');
    assert.equal(sql('SELECT * FROM autobiographical_memories'), memoriesBefore, 'readiness does not mutate durable memories');
    const changed = binding(empty.slotAnchorMs + 1800000); await enqueue(changed);
    const changedJob = await claim(changed);
    const priorQuery = await api('query', { query: { text: 'synthetic observed search' }, journal_preparation: changed });
    const priorSelected = filterMemoriesBeforePrompt(priorQuery.candidates);
    sql(`UPDATE autobiographical_memories SET content='new canonical content',version=version+1 WHERE id='${seed}'`);
    const staleCompletion = await api('complete_surfacing', { job_id: Number(changedJob.id), prepared_set_id: randomUUID(),
      result_category: 'PREPARED', candidate_ids: [seed], selected_memories: priorSelected,
      journal_candidate_versions: priorQuery.journal_candidate_versions });
    assert.equal(staleCompletion.status, 'FAILED', 'query-time version fences content change during selection');
    assert.equal(staleCompletion.prepared_set_id, null);
    assert.equal((await api('prepared_get', proof(changed))).prepared_set, null);
    assert.equal(sql(`SELECT result_category FROM autobiographical_memory_surfacing_attempts WHERE queue_id=${changedJob.id}`), 'INVALID');
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const ended = new Promise(resolve => server.once('exit', resolve)); server.kill(); await ended;
    }
    sql(`DROP DATABASE IF EXISTS ${database}`, null);
    await rm(web, { recursive: true, force: true });
  }
});
