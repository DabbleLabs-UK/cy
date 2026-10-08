// Explicitly opted-in disposable MariaDB and HTTP tests; never production state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('generic claims share durable cadence, class fairness and canonical privacy fencing', {
  skip: process.env.CY_TEST_DB_ISOLATED !== '1',
}, async () => {
  const database = `cy_generic_${randomBytes(6).toString('hex')}`;
  const sqlArgs = (db = database) => [
    `--defaults-file=${process.env.CY_TEST_DB_DEFAULTS}`, '-h', '127.0.0.1',
    '-P', process.env.CY_TEST_DB_PORT, '-u', 'root', '--batch', '--skip-column-names', '--raw', ...(db ? [db] : []),
  ];
  const sql = (query, db = database) => {
    const result = spawnSync(process.env.CY_TEST_MARIADB_BIN, sqlArgs(db),
      { input: query, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const web = await mkdtemp(join(tmpdir(), 'cy-generic-test-'));
  const servers = [];
  let lockHolder;
  const stop = async process => {
    if (process && process.exitCode === null && process.signalCode === null) {
      const exit = new Promise(resolve => process.once('exit', resolve));
      process.kill();
      await exit;
    }
  };
  try {
    sql(`CREATE DATABASE ${database}`, null);
    sql(await readFile(join(root, 'sql/schema.sql'), 'utf8'));
    await cp(join(root, 'lib'), join(web, 'lib'), { recursive: true });
    await cp(join(root, 'public/api'), join(web, 'public/api'), { recursive: true });
    await cp(join(root, 'config'), join(web, 'config'), { recursive: true });
    await writeFile(join(web, 'config/config.php'), `<?php return [
      'db'=>['host'=>'127.0.0.1;port=${process.env.CY_TEST_DB_PORT}','name'=>'${database}','user'=>'root','pass'=>'','charset'=>'utf8mb4'],
      'ingest_key'=>'test-key','cookie_secret'=>'test-cookie'];`);
    const start = async () => {
      const listener = createServer();
      await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
      const port = listener.address().port;
      await new Promise(resolve => listener.close(resolve));
      const server = spawn(process.env.CY_TEST_PHP_BIN,
        ['-d', 'extension=pdo_mysql', '-S', `127.0.0.1:${port}`, '-t', join(web, 'public')],
        { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      servers.push(server);
      let errors = '';
      server.stderr.on('data', data => { errors += data; });
      const endpoint = `http://127.0.0.1:${port}/api/memory.php`;
      for (let i = 0; i < 50; i++) {
        try { await fetch(endpoint); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
      }
      return async (action, input = {}, expectedStatus = 200, key = 'test-key') => {
        const response = await fetch(endpoint, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Cy-Key': key }, body: JSON.stringify({ action, ...input }) });
        const data = await response.json();
        assert.equal(response.status, expectedStatus, JSON.stringify(data) + errors.slice(-1000));
        return data;
      };
    };
    let api = await start();
    const sender = 'a'.repeat(32);
    const source = (id, type = 'ENVIRONMENT_EVENT', visitor = null) => ({ sourceType: type, sourceId: id,
      subjectVisitorId: visitor, sourceVisibility: visitor ? 'SENDER_RECALLABLE' : 'INTERNAL_ONLY',
      text: `retained source bytes ${id}`, tags: ['generic-test'], occurredAt: '2026-10-01 12:00:00.000' });
    const enqueue = async (value, hours = 0) => {
      await api('enqueue_source', { source: value });
      const id = Number(sql(`SELECT id FROM autobiographical_memory_formation_queue WHERE source_type='${value.sourceType}' AND source_id='${value.sourceId}'`));
      sql(`UPDATE autobiographical_memory_formation_queue SET queued_at=NOW(3)-INTERVAL ${hours} HOUR WHERE id=${id}`);
      return id;
    };
    const finish = (job, category = 'NOTHING', operations = [], expected = 200) => api('finish_source', {
      job_id: Number(job.id), claim_token: job.claim_token, result_category: category, operations,
    }, expected);
    const check = (result, reason) => {
      assert.equal(result.ok, true);
      assert.equal(result.admission.reason, reason, JSON.stringify(result));
      assert.ok(Number.isInteger(result.admission.wait_ms));
      assert.ok(result.admission.wait_ms >= 0 && result.admission.wait_ms <= 1800000);
      if (reason !== 'ADMITTED') assert.equal(result.job, null);
      else assert.equal(result.depth, Number(sql("SELECT COUNT(*) FROM autobiographical_memory_formation_queue WHERE status IN ('PENDING','PROCESSING','RETRYABLE')")));
      assert.doesNotMatch(JSON.stringify(result.admission), /retained source|source_payload|aaaa|claim_token/);
      return result.job;
    };
    // The test advances only claim timestamps to simulate elapsed wall time.
    // Production has no reset, retry-count reset, or bulk status rewrite.
    const elapse = () => sql(`UPDATE autobiographical_memory_formation_queue
      SET started_at=started_at-INTERVAL 31 MINUTE WHERE started_at IS NOT NULL`);
    await api('claim_generic_source', {}, 401, 'wrong');
    check(await api('claim_generic_source'), 'EMPTY');
    const ambient = await enqueue(source('ambient', 'AMBIENT_EVENT'));
    const backlog = await enqueue(source('env-backlog'), 72);
    const recentOld = await enqueue(source('env-recent-old'), 2);
    const recentNew = await enqueue(source('env-recent-new'), 1);
    for (const type of ['DREAM_EXPRESSION', 'CY_EXPRESSION']) {
      await enqueue(source(`${type}-one`, type), 2);
      await enqueue(source(`${type}-two`, type), 1);
      await enqueue(source(`${type}-three`, type));
    }
    const privateId = await enqueue(source('private-dream', 'DREAM_EXPRESSION', sender), 100);
    const terminalId = await enqueue(source('already-failed', 'CY_EXPRESSION'), 100);
    sql(`UPDATE autobiographical_memory_formation_queue SET status='FAILED',attempts=99,failure_streak=6,model_invalid_streak=6 WHERE id=${terminalId}`);
    sql("INSERT INTO environment_events (event_id,occurred_at,event_type,event_family,record) VALUES ('legacy-card',NOW(),'postcard','ordinary_postcard','{}')");
    const legacyId = await enqueue(source('legacy-card'), 100);
    const originalBytes = sql('SELECT id,source_payload FROM autobiographical_memory_formation_queue ORDER BY id');
    const senderId = await enqueue(source('sender-ready', 'POSTCARD', sender), 1);
    check(await api('claim_generic_source'), 'SENDER_PRIORITY');
    assert.equal(sql(`SELECT status FROM autobiographical_memory_formation_queue WHERE id=${legacyId}`), 'QUARANTINED');
    assert.equal(sql(`SELECT attempts FROM autobiographical_memory_formation_queue WHERE id=${senderId}`), '0');
    const senderJob = (await api('claim_source', { sender_only: true, min_age_seconds: 120 })).job;
    check(await api('claim_generic_source'), 'SENDER_PRIORITY');
    await finish(senderJob);
    const retrySender = await enqueue(source('sender-retry', 'CY_REPLY', sender), 1);
    sql(`UPDATE autobiographical_memory_formation_queue SET status='RETRYABLE',available_at=NOW()-INTERVAL 1 SECOND WHERE id=${retrySender}`);
    check(await api('claim_generic_source'), 'SENDER_PRIORITY');
    sql(`UPDATE autobiographical_memory_formation_queue SET available_at=NOW()+INTERVAL 2 HOUR WHERE id=${retrySender}`);
    const youngSender = await enqueue(source('young-sender', 'POSTCARD', sender));

    let job = check(await api('claim_generic_source', { source_type: 'POSTCARD', min_age_seconds: 0, cadence_ms: 0 }), 'ADMITTED');
    assert.equal(Number(job.id), recentOld, 'oldest unattempted recent source wins over older backlog');
    assert.equal(job.source_type, 'ENVIRONMENT_EVENT');
    assert.match(job.claim_token, /^[a-f0-9]{32}$/);
    assert.equal(Number(job.attempts), 1);
    assert.equal((await finish(job, 'ERROR')).status, 'RETRYABLE');
    sql(`UPDATE autobiographical_memory_formation_queue SET available_at=NOW()-INTERVAL 1 SECOND WHERE id=${recentOld}`);
    check(await api('claim_generic_source'), 'CADENCE');
    assert.equal(Number((await api('claim_source')).job.id), youngSender, 'ordinary sender claim remains compatible');
    const processingSender = sql(`SELECT claim_token FROM autobiographical_memory_formation_queue WHERE id=${youngSender}`);
    check(await api('claim_generic_source'), 'SENDER_PRIORITY');
    await finish({ id: youngSender, claim_token: processingSender });
    assert.equal((await api('claim_source')).job, null, 'legacy default action cannot bypass generic cadence');
    assert.equal(sql(`SELECT status FROM autobiographical_memory_formation_queue WHERE id=${ambient}`), 'PENDING');
    await stop(servers[0]);
    api = await start();
    check(await api('claim_generic_source'), 'CADENCE');

    const classes = ['ENVIRONMENT_EVENT'];
    for (let i = 0; i < 6; i++) {
      elapse();
      job = check(await api('claim_generic_source'), 'ADMITTED');
      classes.push(job.source_type);
      if (i === 2) assert.equal(Number(job.id), recentNew, 'unattempted recent source precedes a due recent retry');
      if (i === 5) assert.equal(Number(job.id), backlog, 'when no fresh recent source remains the oldest backlog wins');
      await finish(job, i === 0 ? 'PREEMPTED' : 'NOTHING');
      check(await api('claim_generic_source'), 'CADENCE');
    }
    assert.deepEqual(classes, ['ENVIRONMENT_EVENT', 'DREAM_EXPRESSION', 'CY_EXPRESSION',
      'ENVIRONMENT_EVENT', 'DREAM_EXPRESSION', 'CY_EXPRESSION', 'ENVIRONMENT_EVENT']);
    assert.equal(sql(`SELECT CONCAT(status,':',attempts,':',failure_streak,':',model_invalid_streak)
      FROM autobiographical_memory_formation_queue WHERE id=${terminalId}`), 'FAILED:99:6:6');
    assert.equal(sql(`SELECT CONCAT(status,':',attempts) FROM autobiographical_memory_formation_queue WHERE id=${privateId}`), 'PENDING:0');
    assert.equal(sql(`SELECT id,source_payload FROM autobiographical_memory_formation_queue WHERE id<=${legacyId} ORDER BY id`), originalBytes,
      'admission preserves backlog and quarantine bytes');

    // Separate PHP processes provide genuinely independent DB connections.
    const parallelApi = await start();
    elapse();
    const attemptsBefore = Number(sql('SELECT SUM(attempts) FROM autobiographical_memory_formation_queue'));
    const concurrent = await Promise.all([api('claim_generic_source'), parallelApi('claim_generic_source'), api('claim_source')]);
    assert.equal(concurrent.filter(result => result.job !== null).length, 1, 'concurrent generic and legacy clients share one cadence');
    assert.equal(Number(sql('SELECT SUM(attempts) FROM autobiographical_memory_formation_queue')), attemptsBefore + 1);
    job = concurrent.find(result => result.job).job;
    const forged = { decision: 'CREATE', memoryId: randomUUID(), type: 'EPISODIC', privacyScope: 'INTERNAL_ONLY',
      consistencyStatus: 'CONSISTENT', content: 'a remembered event', tags: [],
      source: { ...job.source, sourceId: 'forged-source' } };
    await finish(job, 'CREATE', [forged], 422);
    const complete = await finish(job);
    assert.equal(complete.status, 'PROCESSED');
    assert.equal((await finish(job)).duplicate, true, 'generic completion uses canonical replay receipt');
    check(await parallelApi('claim_generic_source'), 'CADENCE');
    const lockName = `cy_generic_memory:${createHash('sha256').update(database).digest('hex').slice(0, 40)}`;
    assert.equal(sql(`SELECT IS_FREE_LOCK('${lockName}')`), '1', 'successful and declined claims release connection lock');

    lockHolder = spawn(process.env.CY_TEST_MARIADB_BIN, sqlArgs(),
      { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    lockHolder.stdin.end(`SELECT GET_LOCK('${lockName}',0); SELECT SLEEP(30);`);
    for (let i = 0; i < 100 && sql(`SELECT IS_FREE_LOCK('${lockName}')`) !== '0'; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(sql(`SELECT IS_FREE_LOCK('${lockName}')`), '0');
    check(await api('claim_generic_source'), 'BUSY');
    await stop(lockHolder);
    const lockOwner = sql(`SELECT IS_USED_LOCK('${lockName}')`);
    if (/^[0-9]+$/.test(lockOwner)) sql(`KILL ${lockOwner}`);
    assert.equal(sql(`SELECT IS_FREE_LOCK('${lockName}')`), '1');

    sql('RENAME TABLE autobiographical_memory_formation_queue TO generic_test_unavailable_queue');
    try {
      check(await api('claim_generic_source'), 'UNAVAILABLE');
      assert.equal(sql(`SELECT IS_FREE_LOCK('${lockName}')`), '1', 'admission failure releases lock');
    } finally {
      sql('RENAME TABLE generic_test_unavailable_queue TO autobiographical_memory_formation_queue');
    }
    // Even if only failed generic rows remain, a recent claim still owns cadence.
    sql("UPDATE autobiographical_memory_formation_queue SET status='FAILED' WHERE source_type IN ('ENVIRONMENT_EVENT','DREAM_EXPRESSION','CY_EXPRESSION') AND status IN ('PENDING','RETRYABLE')");
    sql(`UPDATE autobiographical_memory_formation_queue SET started_at=NOW(3) WHERE id=${terminalId}`);
    check(await api('claim_generic_source'), 'CADENCE');
    elapse();
    const terminalSnapshot = sql('SELECT id,status,attempts,failure_streak,model_invalid_streak,source_payload FROM autobiographical_memory_formation_queue ORDER BY id');
    check(await api('claim_generic_source'), 'EMPTY');
    check(await api('claim_generic_source'), 'EMPTY');
    assert.equal(sql('SELECT id,status,attempts,failure_streak,model_invalid_streak,source_payload FROM autobiographical_memory_formation_queue ORDER BY id'), terminalSnapshot,
      'empty calls never reset statuses, counters or source payloads');
    const ordinary = (await api('claim_source')).job;
    assert.equal(Number(ordinary.id), ambient, 'non-generic default work retains its priority contract');
    await finish(ordinary);
  } finally {
    await stop(lockHolder);
    for (const server of servers) await stop(server);
    sql(`DROP DATABASE IF EXISTS ${database}`, null);
    await rm(web, { recursive: true, force: true });
  }
});
