// Explicitly opted-in disposable MariaDB and HTTP tests; never production state.
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
test('formation claims, atomic completion replay, sender privacy and bounded recovery', {
  skip: process.env.CY_TEST_DB_ISOLATED !== '1',
}, async () => {
  const database = `cy_formation_${randomBytes(6).toString('hex')}`;
  const sql = (query, db = database) => {
    const result = spawnSync(process.env.CY_TEST_MARIADB_BIN, [
      `--defaults-file=${process.env.CY_TEST_DB_DEFAULTS}`, '-h', '127.0.0.1',
      '-P', process.env.CY_TEST_DB_PORT, '-u', 'root', '--batch', '--skip-column-names', '--raw', ...(db ? [db] : []),
    ], { input: query, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const web = await mkdtemp(join(tmpdir(), 'cy-formation-test-'));
  let server;
  try {
    sql(`CREATE DATABASE ${database}`, null);
    sql(await readFile(join(root, 'sql/schema.sql'), 'utf8'));
    const migration = await readFile(join(root, 'sql/027_memory_formation_delivery.sql'), 'utf8');
    sql(migration); sql(migration);
    await cp(join(root, 'lib'), join(web, 'lib'), { recursive: true });
    await cp(join(root, 'public/api'), join(web, 'public/api'), { recursive: true });
    await cp(join(root, 'config'), join(web, 'config'), { recursive: true });
    await writeFile(join(web, 'config/config.php'), `<?php return [
      'db'=>['host'=>'127.0.0.1;port=${process.env.CY_TEST_DB_PORT}','name'=>'${database}','user'=>'root','pass'=>'','charset'=>'utf8mb4'],
      'ingest_key'=>'test-key','cookie_secret'=>'test-cookie'];`);
    const listener = createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    server = spawn(process.env.CY_TEST_PHP_BIN, ['-d', 'extension=pdo_mysql', '-S', `127.0.0.1:${port}`, '-t', join(web, 'public')],
      { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let errors = '';
    server.stderr.on('data', data => { errors += data; });
    const endpoint = `http://127.0.0.1:${port}/api/memory.php`;
    for (let i = 0; i < 50; i++) {
      try { await fetch(endpoint); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    const api = async (action, input = {}, expectedStatus = 200, key = 'test-key') => {
      const response = await fetch(endpoint, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cy-Key': key }, body: JSON.stringify({ action, ...input }) });
      const data = await response.json();
      assert.equal(response.status, expectedStatus, JSON.stringify(data) + errors.slice(-1000));
      return data;
    };
    const sender = 'a'.repeat(32), other = 'b'.repeat(32);
    const source = (id, type = 'POSTCARD', visitor = sender) => ({ sourceType: type, sourceId: id,
      subjectVisitorId: visitor, sourceVisibility: visitor ? 'SENDER_RECALLABLE' : 'INTERNAL_ONLY',
      text: 'private sender garden question', tags: ['postcard'], occurredAt: '2026-10-05 12:00:00.000' });
    const enqueue = async value => {
      await api('enqueue_source', { source: value });
      return Number(sql(`SELECT id FROM autobiographical_memory_formation_queue WHERE source_type='${value.sourceType}' AND source_id='${value.sourceId}'`));
    };
    const claim = async visitor => (await api('claim_source', { sender_only: true, visitor_id: visitor })).job;
    const finish = (job, result_category, operations = [], rest = {}, expected = 200) => api('finish_source', {
      job_id: Number(job.id), claim_token: job.claim_token, result_category, operations, ...rest,
    }, expected);
    const create = (value, memoryId = randomUUID(), extra = {}) => ({ decision: 'CREATE', memoryId,
      type: 'PERSON', privacyScope: 'SENDER_RECALLABLE', consistencyStatus: 'CONSISTENT',
      content: 'The sender tends a garden.', source: value, tags: ['garden'], ...extra });

    await api('formation_health', {}, 401, 'wrong');
    const ambientId = await enqueue(source('ambient-safe', 'AMBIENT_EVENT', null));
    const firstSource = source('first');
    const firstId = await enqueue(firstSource);
    assert.equal((await api('claim_source', { sender_only: true, min_age_seconds: 120 })).job, null);
    sql(`UPDATE autobiographical_memory_formation_queue SET queued_at=NOW()-INTERVAL 3 MINUTE,attempts=292 WHERE id=${firstId}`);
    const first = (await api('claim_source', { sender_only: true, min_age_seconds: 120 })).job;
    assert.equal(Number(first.id), firstId);
    assert.equal(Number(first.attempts), 293);
    assert.equal(Number(first.failure_streak), 0, 'historical attempts do not consume the new retry allowance');
    assert.match(first.claim_token, /^[a-f0-9]{32}$/);
    const operation = create(firstSource);
    const completed = await finish(first, 'CREATE', [operation]);
    assert.equal(completed.status, 'PROCESSED');
    const replayed = await finish(first, 'CREATE', [create(firstSource)]);
    assert.equal(replayed.duplicate, true, 'lost acknowledgement returns original result despite a newly generated candidate ID');
    assert.equal(replayed.result_category, 'CREATE');
    assert.equal((await finish(first, 'ERROR')).result_category, 'CREATE', 'late transport failure cannot overwrite committed outcome');
    assert.deepEqual(replayed.results, completed.results);
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memories WHERE subject_visitor_id='${sender}'`), '1');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_revisions WHERE memory_id='${operation.memoryId}'`), '1');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_activity WHERE memory_id='${operation.memoryId}'`), '1');
    assert.equal(sql('SELECT COUNT(*) FROM autobiographical_memory_formation_attempts'), '1');
    assert.equal(await claim(sender), null, 'restart never reclaims completed source');
    assert.equal(sql(`SELECT status FROM autobiographical_memory_formation_queue WHERE id=${ambientId}`), 'PENDING');

    const privateSource = source('private');
    await enqueue(privateSource);
    const privateJob = await claim(sender);
    await finish(privateJob, 'CREATE', [create(privateSource), create(privateSource, randomUUID(), {
      privacyScope: 'PUBLIC_RECALLABLE', publicSummary: 'private sender exposed',
    })], {}, 422);
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memories WHERE subject_visitor_id='${sender}'`), '1', 'later invalid operation rolls back all earlier writes');
    await finish(privateJob, 'CREATE', [create({ ...privateSource, sourceId: 'forged' })], {}, 422);
    await finish(privateJob, 'NOTHING');

    const updateSource = source('garden-follow-up', 'CY_REPLY');
    await enqueue(updateSource);
    const updateJob = await claim(sender);
    const update = { decision: 'UPDATE', memoryId: operation.memoryId, expectedVersion: 1,
      content: 'The sender grows vegetables in their garden.', source: updateSource };
    await finish(updateJob, 'UPDATE', [update]);
    assert.equal((await finish(updateJob, 'UPDATE', [update])).duplicate, true);
    assert.equal(sql(`SELECT version FROM autobiographical_memories WHERE id='${operation.memoryId}'`), '2');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_sources WHERE memory_id='${operation.memoryId}'`), '2');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_activity WHERE memory_id='${operation.memoryId}'`), '2');

    const threadSource = source('topic');
    await enqueue(threadSource);
    const threadJob = await claim(sender);
    const thread = create(threadSource, randomUUID(), { type: 'UNRESOLVED_THREAD' });
    await finish(threadJob, 'CREATE', [thread]);
    const resolvingSource = source('topic-answer', 'CY_REPLY');
    await enqueue(resolvingSource);
    const resolvingJob = await claim(sender);
    const archive = { decision: 'ARCHIVE', memoryId: thread.memoryId, expectedVersion: 1, source: resolvingSource };
    await finish(resolvingJob, 'RESOLVE', [{ ...archive, expectedVersion: 2 }], {}, 409);
    await finish(resolvingJob, 'RESOLVE', [archive]);
    assert.equal(sql(`SELECT status FROM autobiographical_memories WHERE id='${thread.memoryId}'`), 'ARCHIVED');
    assert.equal(sql(`SELECT COUNT(*) FROM autobiographical_memory_sources WHERE memory_id='${thread.memoryId}'`), '2', 'resolving provenance is retained');
    assert.equal((await finish(resolvingJob, 'RESOLVE', [archive])).duplicate, true);
    assert.equal(sql(`SELECT version FROM autobiographical_memories WHERE id='${thread.memoryId}'`), '2');
    const otherSource = source('other-answer', 'CY_REPLY', other);
    await enqueue(otherSource);
    const otherJob = await claim(other);
    await finish(otherJob, 'UPDATE', [{ decision: 'UPDATE', memoryId: operation.memoryId, expectedVersion: 1,
      content: 'wrong sender', source: otherSource }], {}, 422);
    await finish(otherJob, 'NOTHING');

    const retryId = await enqueue(source('retry'));
    let job = await claim(sender);
    for (let failure = 1; failure <= 6; failure++) {
      const result = await finish(job, 'INVALID', [], { error: 'malformed model decision' });
      assert.equal(result.failure_streak, failure);
      assert.equal(result.status, failure === 6 ? 'FAILED' : 'RETRYABLE');
      assert.equal((await finish(job, 'INVALID')).duplicate, true, 'lost failure acknowledgement cannot count twice');
      if (failure === 6) break;
      assert.equal(await claim(sender), null, 'backoff prevents immediate hot retry');
      sql(`UPDATE autobiographical_memory_formation_queue SET available_at=NOW()-INTERVAL 1 SECOND WHERE id=${retryId}`);
      const old = job;
      job = await claim(sender);
      assert.notEqual(job.claim_token, old.claim_token);
      assert.equal((await finish(old, 'INVALID')).duplicate, true);
      assert.equal(sql(`SELECT status FROM autobiographical_memory_formation_queue WHERE id=${retryId}`), 'PROCESSING');
      if (failure === 2) {
        const preempted = await finish(job, 'PREEMPTED');
        assert.equal(preempted.failure_streak, 2);
        assert.equal(preempted.status, 'RETRYABLE');
        sql(`UPDATE autobiographical_memory_formation_queue SET available_at=NOW()-INTERVAL 1 SECOND WHERE id=${retryId}`);
        job = await claim(sender);
      }
    }
    assert.equal(await claim(sender), null, 'terminal failed source stays retained outside active queue');

    const operationalId = await enqueue(source('operational-timeout'));
    let operational = await claim(sender);
    for (let failure = 1; failure <= 7; failure++) {
      const result = await finish(operational, 'TIMEOUT', [], { error: 'shared model unavailable' });
      assert.equal(result.status, 'RETRYABLE', 'model access cannot make a valid source terminal');
      assert.equal(result.failure_streak, Math.min(failure, 6));
      assert.ok(result.retry_delay_seconds <= 900, 'operational retry rate stays capped');
      if (failure === 7) break;
      sql(`UPDATE autobiographical_memory_formation_queue SET available_at=NOW()-INTERVAL 1 SECOND WHERE id=${operationalId}`);
      operational = await claim(sender);
    }
    assert.equal(await claim(sender), null, 'operational failure still observes backoff');

    const crashedId = await enqueue(source('crash'));
    const crashed = await claim(sender);
    sql(`UPDATE autobiographical_memory_formation_queue SET started_at=NOW()-INTERVAL 11 MINUTE,failure_streak=5 WHERE id=${crashedId}`);
    assert.equal(await claim(sender), null, 'expired lease enters backoff');
    await finish(crashed, 'CREATE', [create(source('crash'))], {}, 409);
    assert.equal(sql(`SELECT failure_streak FROM autobiographical_memory_formation_queue WHERE id=${crashedId}`), '6');
    assert.equal(sql(`SELECT status FROM autobiographical_memory_formation_queue WHERE id=${crashedId}`), 'RETRYABLE');

    sql("INSERT INTO environment_events (event_id,occurred_at,event_type,event_family,record) VALUES ('legacy-card',NOW(),'postcard','ordinary_postcard','{}'),('ordinary-noise',NOW(),'wing_noise','environment','{}')");
    const legacyId = await enqueue(source('legacy-card', 'ENVIRONMENT_EVENT', null));
    const noiseId = await enqueue(source('ordinary-noise', 'ENVIRONMENT_EVENT', null));
    const ordinary = (await api('claim_source')).job;
    assert.equal(Number(ordinary.id), noiseId, 'unrelated real environment events remain claimable');
    assert.equal(sql(`SELECT status FROM autobiographical_memory_formation_queue WHERE id=${legacyId}`), 'QUARANTINED');
    assert.match(sql(`SELECT source_payload FROM autobiographical_memory_formation_queue WHERE id=${legacyId}`), /private sender garden question/);
    await finish(ordinary, 'NOTHING');
    const health = (await api('formation_health')).health;
    assert.equal(health.failed, 1);
    assert.equal(health.quarantined, 1);
    assert.equal(health.sender_sources.POSTCARD.failed, 1);
    assert.equal(health.sender_sources.POSTCARD.retryable, 2);
    assert.equal(health.sender_sources.POSTCARD.unlinked, 0);
    assert.ok(health.sender_sources.POSTCARD.linked > 0);
    assert.ok(health.sender_sources.CY_REPLY.processed > 0);
    assert.ok(health.last_sender_success_at);
    assert.equal(health.last_sender_failure.category, 'TIMEOUT');
    assert.ok(health.last_sender_failure.at);
    assert.ok(health.next_sender_retry_at);
    assert.equal(typeof health.oldest_sender_pending_age_seconds, 'number');
    assert.doesNotMatch(JSON.stringify(health), /garden|aaaa|source_payload/);
  } finally {
    if (server && server.exitCode === null) {
      const exit = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exit;
    }
    sql(`DROP DATABASE IF EXISTS ${database}`, null);
    await rm(web, { recursive: true, force: true });
  }
});
