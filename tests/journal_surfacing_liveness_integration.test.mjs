// Explicit opt-in: disposable loopback MariaDB + copied PHP API, no providers.
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
import { AutobiographicalMemoryRuntime, memoryContextFingerprint } from '../runner/memory-runtime.js';
import { journalFromWorking } from '../runner/fixtures/memory-status-journal.mjs';

test('journal surfacing retires persisted obsolete work before claim; preserves memories and other consumers', {
  skip: process.env.CY_TEST_DB_ISOLATED !== '1',
}, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const database = `cy_journal_live_${randomBytes(6).toString('hex')}`;
  const port = Number(process.env.CY_TEST_DB_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && process.env.CY_TEST_DB_DEFAULTS && process.env.CY_TEST_MARIADB_BIN && process.env.CY_TEST_PHP_BIN);
  const sql = (query, db = database) => {
    const result = spawnSync(process.env.CY_TEST_MARIADB_BIN, [
      `--defaults-file=${process.env.CY_TEST_DB_DEFAULTS}`, '-h', '127.0.0.1', '-P', String(port),
      '-u', 'root', '--batch', '--skip-column-names', '--raw', ...(db ? [db] : []),
    ], { input: query, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const web = await mkdtemp(join(tmpdir(), 'cy-journal-live-api-'));
  let server;
  const stop = async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      const ended = new Promise(resolve => server.once('exit', resolve)); server.kill(); await ended;
    }
  };
  try {
    sql(`CREATE DATABASE ${database}`, null);
    sql(await readFile(join(root, 'sql/schema.sql'), 'utf8'));
    sql((await readFile(join(root, 'sql/017_memory_runtime_queue.sql'), 'utf8'))
      .replaceAll('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '));
    for (const folder of ['lib', 'public/api', 'config']) await cp(join(root, folder), join(web, folder), { recursive: true });
    await writeFile(join(web, 'config/config.php'), `<?php return [
      'db'=>['host'=>'127.0.0.1;port=${port}','name'=>'${database}','user'=>'root','pass'=>'','charset'=>'utf8mb4'],
      'ingest_key'=>'test-key','cookie_secret'=>'test-cookie'];`);
    const start = async () => {
      const listener = createServer();
      await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
      const httpPort = listener.address().port; await new Promise(resolve => listener.close(resolve));
      server = spawn(process.env.CY_TEST_PHP_BIN,
        ['-d', 'extension=pdo_mysql', '-S', `127.0.0.1:${httpPort}`, '-t', join(web, 'public')],
        { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      let errors = ''; server.stderr.on('data', data => { errors += data; });
      const endpoint = `http://127.0.0.1:${httpPort}/api/memory.php`;
      for (let i = 0; i < 60; i++) {
        try { await fetch(endpoint); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
      }
      return async (action, input = {}, status = 200) => {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'test-key' }, body: JSON.stringify({ action, ...input }) });
        const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data) + errors.slice(-1500)); return data;
      };
    };
    let api = await start();
    const hash = text => createHash('sha256').update(text).digest('hex');
    const seed = randomUUID();
    sql(`INSERT INTO autobiographical_memories (id,memory_type,status,privacy_scope,content,created_at,updated_at)
      VALUES ('${seed}','EPISODIC','ACTIVE','INTERNAL_ONLY','synthetic observed yard visit',NOW(3),NOW(3))`);
    await api('enqueue_source', { source: { sourceType: 'ENVIRONMENT_EVENT', sourceId: 'synthetic-formation',
      text: 'synthetic meaningful episode', sourceVisibility: 'INTERNAL_ONLY' } });
    const memoriesBefore = sql('SELECT * FROM autobiographical_memories');
    const formationBefore = sql('SELECT * FROM autobiographical_memory_formation_queue');
    const enqueue = async (name, generationRef, visitor = null, fingerprint = hash(name)) => {
      await api('enqueue_surfacing', { context_fingerprint: fingerprint, visitor_id: visitor,
        context: { text: name, generationRef } });
      return { fingerprint, id: Number(sql(`SELECT id FROM autobiographical_memory_surfacing_queue WHERE context_fingerprint='${fingerprint}'`)) };
    };
    // Simulate a persisted pre-deployment backlog in the same existing schema.
    const values = Array.from({ length: 215 }, (_, i) => {
      const status = ['PENDING', 'RETRYABLE', 'PROCESSING'][i % 3];
      return `('${hash('obsolete-' + i)}','{"generationRef":"journal:${1000 + i}"}','',80,'${status}',0,NOW(3),NOW(3)-INTERVAL 5 DAY,NOW(3))`;
    });
    sql(`INSERT INTO autobiographical_memory_surfacing_queue
      (context_fingerprint,context_payload,sender_scope_key,priority,status,attempts,available_at,queued_at,updated_at) VALUES ${values.join(',')}`);
    const current = await enqueue('current', 'journal:9000');
    const claim = await api('claim_surfacing', { journal_context_fingerprint: current.fingerprint });
    assert.equal(Number(claim.job.id), current.id);
    assert.equal(claim.journal_superseded_count, 215);
    assert.equal(Number(sql("SELECT COUNT(*) FROM autobiographical_memory_surfacing_queue WHERE status='SUPERSEDED' AND attempts=0")), 215);
    assert.equal(Number(sql('SELECT COUNT(*) FROM autobiographical_memory_surfacing_attempts')), 0, 'retirement does not invent a search attempt');
    const preparedId = randomUUID();
    const completed = await api('complete_surfacing', { job_id: current.id, prepared_set_id: preparedId,
      result_category: 'NO_CANDIDATES', candidate_ids: [], selected_memories: [] });
    assert.equal(completed.status, 'PREPARED');
    assert.equal(Number(sql(`SELECT COUNT(*) FROM autobiographical_memory_prepared_sets WHERE id='${preparedId}'`)), 1);

    // Real stored ACTIVE row -> query API -> runner projection -> JSON/PHP/DB
    // prepared round trip -> unchanged activation -> actual journal context.
    const found = await api('query', { query: { text: 'synthetic observed yard visit' }, limit: 10 });
    const retrieved = found.candidates.find(memory => memory.id === seed);
    assert.equal(retrieved.status, 'ACTIVE');
    const projected = filterMemoriesBeforePrompt([retrieved]);
    assert.equal(projected[0].status, retrieved.status);
    const journalContext = { text: 'synthetic observed yard visit', location: 'cell', generationRef: 'journal:9500' };
    const selectedJob = await enqueue(journalContext.text, journalContext.generationRef, null, memoryContextFingerprint(journalContext));
    assert.equal(Number((await api('claim_surfacing', { journal_context_fingerprint: selectedJob.fingerprint })).job.id), selectedJob.id);
    const selectedSetId = randomUUID();
    await api('complete_surfacing', { job_id: selectedJob.id, prepared_set_id: selectedSetId,
      result_category: 'PREPARED', candidate_ids: [seed], selected_memories: projected });
    const saved = await api('prepared_get', { context_fingerprint: selectedJob.fingerprint });
    assert.deepEqual(saved.prepared_set.selected_memories, projected);
    assert.equal(JSON.parse(sql(`SELECT selected_memories FROM autobiographical_memory_prepared_sets WHERE id='${selectedSetId}'`))[0].status, 'ACTIVE');
    let consumption;
    const runtime = new AutobiographicalMemoryRuntime({
      makeId: randomUUID, generate: async () => { throw new Error('inference forbidden'); },
      client: {
        async getPreparedMemorySet() { return saved; },
        async enqueueMemorySurfacing() { throw new Error('compatible prepared set must be used'); },
        consumePreparedMemorySet({ preparedSetId, generationRef }) {
          consumption = api('consume_prepared', { prepared_set_id: preparedSetId, generation_ref: generationRef });
          return consumption;
        },
      },
    });
    assert.equal((await runtime.requestWorkingContext(journalContext)).selected[0].status, 'ACTIVE');
    const journal = journalFromWorking(runtime);
    assert.match(journal.prompt, /synthetic observed yard visit/);
    assert.match(journal.context.sharedContext, /"source":"recollection"/);
    await consumption;
    assert.equal(sql(`SELECT consumed_by FROM autobiographical_memory_prepared_sets WHERE id='${selectedSetId}'`), 'journal-prose:1000');

    const inFlight = await enqueue('in-flight', 'journal:10000');
    await api('claim_surfacing', { journal_context_fingerprint: inFlight.fingerprint });
    const newer = await enqueue('newer', 'journal:11000');
    const next = await api('claim_surfacing', { journal_context_fingerprint: newer.fingerprint });
    assert.equal(Number(next.job.id), newer.id);
    for (const category of ['PREPARED', 'TIMEOUT', 'PREEMPTED']) {
      const late = await api('complete_surfacing', { job_id: inFlight.id, result_category: category,
        prepared_set_id: randomUUID(), candidate_ids: [seed], selected_memories: [{ id: seed, status: 'ACTIVE', privacyScope: 'INTERNAL_ONLY', content: 'synthetic' }] });
      assert.equal(late.status, 'SUPERSEDED'); assert.equal(late.prepared_set_id, null);
    }
    assert.equal(sql(`SELECT status FROM autobiographical_memory_surfacing_queue WHERE id=${inFlight.id}`), 'SUPERSEDED');
    assert.equal(Number(sql('SELECT COUNT(*) FROM autobiographical_memory_prepared_sets')), 2);

    // Restart has no current desire; it retires old journal work, not other consumers.
    await stop(); api = await start();
    const other = await enqueue('unrelated', 'other:1');
    const sender = await enqueue('sender optional', 'postcard:1', 'a'.repeat(32));
    const restarted = await api('claim_surfacing', { journal_context_fingerprint: null });
    assert.equal(Number(restarted.job.id), other.id);
    assert.equal(sql(`SELECT status FROM autobiographical_memory_surfacing_queue WHERE id=${newer.id}`), 'SUPERSEDED');
    assert.equal(sql(`SELECT status FROM autobiographical_memory_surfacing_queue WHERE id=${sender.id}`), 'PENDING');
    const fresh = await enqueue('fresh', 'journal:12000');
    const oldClient = await api('claim_surfacing');
    assert.equal(Number(oldClient.job.id), sender.id, 'old clients cannot claim journal work without current authority');
    assert.equal(sql(`SELECT status FROM autobiographical_memory_surfacing_queue WHERE id=${fresh.id}`), 'PENDING');
    assert.equal(Number((await api('claim_surfacing', { journal_context_fingerprint: fresh.fingerprint })).job.id), fresh.id);
    await api('claim_surfacing', { journal_context_fingerprint: 'bad' }, 422);
    for (const [index, ref] of ['journal:123\n', 'JOURNAL:123', '', 'other:123'].entries()) {
      const unknown = await enqueue('unknown-shape-' + index, ref);
      const preserved = await api('claim_surfacing', { journal_context_fingerprint: null });
      assert.equal(Number(preserved.job.id), unknown.id, 'SQL journal identity matches the strict PHP/runner namespace');
      await api('complete_surfacing', { job_id: unknown.id, result_category: 'SUPERSEDED' }, 422);
      assert.equal(sql(`SELECT status FROM autobiographical_memory_surfacing_queue WHERE id=${unknown.id}`), 'PROCESSING');
    }
    assert.equal(sql('SELECT * FROM autobiographical_memories'), memoriesBefore);
    assert.equal(sql('SELECT * FROM autobiographical_memory_formation_queue'), formationBefore);
  } finally {
    await stop();
    sql(`DROP DATABASE IF EXISTS ${database}`, null);
    await rm(web, { recursive: true, force: true });
  }
});
