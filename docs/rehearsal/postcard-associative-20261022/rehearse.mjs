import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixtures, probes } from './fixtures.mjs';

const home = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(home, '../cy-postcard-associative-recall');
const run = process.env.REHEARSAL_RUN || 'baseline-384def8';
assert.match(run, /^[a-z0-9-]+$/);
const out = join(home, run); await mkdir(out); // Never overwrite existing evidence.
assert.equal(process.env.CY_TEST_DB_ISOLATED, '1');
assert.equal(fixtures.length, 16);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const mod = file => import(pathToFileURL(join(root, 'runner', file)).href);
const { Client } = await mod('client.js');
const { AutobiographicalMemoryRuntime } = await mod('memory-runtime.js');
const { MemoryFormationInference } = await mod('memory-formation-inference.js');
const { makeProviders } = await mod('provider.js');
const { createContextItem, safeBuildContext } = await mod('context-broker.js');
const database = `cy_recall_rehearsal_${randomBytes(5).toString('hex')}`;
const sql = (query, db = database) => {
  const r = spawnSync(process.env.CY_TEST_MARIADB_BIN, [`--defaults-file=${process.env.CY_TEST_DB_DEFAULTS}`,
    '-h', '127.0.0.1', '-P', process.env.CY_TEST_DB_PORT, '-u', 'root', '--batch', '--raw', '--skip-column-names', ...(db ? [db] : [])],
  { input: query, encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
};
const quote = value => "'" + String(value).replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
let server, sends = 0, activeCase = null;
const rawFetch = globalThis.fetch;
const providerEvidence = [];
let base;
try {
  sql(`CREATE DATABASE ${database}`, null);
  sql(await readFile(join(root, 'sql/schema.sql'), 'utf8'));
  const web = join(out, 'disposable-web');
  await cp(join(root, 'lib'), join(web, 'lib'), { recursive: true });
  await cp(join(root, 'public/api'), join(web, 'public/api'), { recursive: true });
  await cp(join(root, 'config'), join(web, 'config'), { recursive: true });
  await writeFile(join(web, 'config/config.php'), `<?php return ['db'=>['host'=>'127.0.0.1;port=${process.env.CY_TEST_DB_PORT}',
    'name'=>'${database}','user'=>'root','pass'=>'','charset'=>'utf8mb4'],'ingest_key'=>'synthetic-key','cookie_secret'=>'synthetic-cookie'];`);
  const listener = createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port; await new Promise(r => listener.close(r));
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.env.CY_TEST_PHP_BIN, ['-d', 'extension=pdo_mysql', '-S', `127.0.0.1:${port}`, '-t', join(web, 'public')],
    { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let serverErrors = ''; server.stderr.on('data', b => { serverErrors += b; });
  let ready = false;
  for (let n = 0; n < 50; n++) { try { await rawFetch(`${base}/api/memory.php`); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  assert.equal(ready, true, serverErrors);

  // Credentials stay in process memory; never saved or printed. Only these two
  // read-only files on DELL are accessed; no production API/ledger is used.
  const live = JSON.parse(execFileSync('ssh', ['dell', 'cat', '/mnt/c/dev/cy/runner/config.json'], { encoding: 'utf8', windowsHide: true }));
  const key = execFileSync('ssh', ['dell', 'cat', '/mnt/c/dev/cy/runner/deepseek.key'], { encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(live.deepseek.model, 'deepseek-v4-flash');
  assert.equal(live.deepseek.apiBase, 'https://api.deepseek.com');
  assert.ok(key.length > 10);
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(url);
    if (target.origin === base) return rawFetch(url, options);
    assert.equal(target.href, 'https://api.deepseek.com/beta/chat/completions', 'no other remote or Ollama access');
    assert.ok(activeCase && sends < 16, 'bounded dispatch only');
    sends++;
    const record = { caseId: activeCase, ordinal: sends, started: new Date().toISOString(), request: JSON.parse(options.body) };
    providerEvidence.push(record);
    await writeFile(join(out, 'provider-evidence.json'), JSON.stringify(providerEvidence, null, 2));
    try {
      const response = await rawFetch(url, options);
      record.httpStatus = response.status;
      record.raw = await response.clone().json();
      record.finished = new Date().toISOString();
      await writeFile(join(out, 'provider-evidence.json'), JSON.stringify(providerEvidence, null, 2));
      return response;
    } catch (error) { record.errorClass = error.name; throw error; }
  };
  const config = { apiBase: base, ingestKey: 'synthetic-key', dryRun: false,
    threads: live.threads, model: live.model, deepseek: live.deepseek };
  const provider = makeProviders(config, { deepseekKey: key }).deepseek;
  const inference = new MemoryFormationInference(config);
  const client = new Client(config, join(out, 'private-state'));
  const api = async (action, data = {}) => {
    const response = await fetch(`${base}/api/memory.php`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'synthetic-key' }, body: JSON.stringify({ action, ...data }) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  const completions = [];
  const actualFinish = client.finishMemorySource.bind(client);
  client.finishMemorySource = async value => {
    const result = await actualFinish(value); completions.push({ caseId: activeCase, input: value, result }); return result;
  };
  const runtime = new AutobiographicalMemoryRuntime({ client, makeId: randomUUID, canRunBackground: () => true,
    providerInfo: () => ({ id: 'deepseek', model: live.deepseek.model }),
    generate: () => { throw new Error('local inference prohibited'); },
    senderFormationGenerate: ({ job, call, localGenerate }) => inference.generate({ job, call, localGenerate,
      providers: { deepseek: provider, ollama: { modelFor: () => live.model } } }),
    contextBroker: ({ consumer, generationRef, currentSenderId, provenanceSource, memoryCandidates }) => {
      const items = [createContextItem({ id: 'synthetic-state', sourceId: 'synthetic-state', section: 'mandatory_current_state',
        provenanceClass: 'WORLD FACT', knowledgeScope: 'CY_OBSERVED', privacyScope: 'INTERNAL_ONLY', mandatory: true, priority: 100,
        content: 'Current HMP ThinkPad regime and clock: locked-up cell period. Authoritative location: cell (CELL), entered at the start of this period; activity locked_up.' }),
      createContextItem({ id: 'memory-source:current', sourceId: provenanceSource.sourceId, section: 'provenance_source',
        provenanceClass: 'SUBJECTIVE BELIEF', knowledgeScope: 'CY_BELIEVES', privacyScope: 'SENDER_RECALLABLE',
        senderId: currentSenderId, mandatory: true, priority: 100, content: provenanceSource.text }),
      ...memoryCandidates.map(m => createContextItem({ id: `memory:${m.id}`, sourceId: `memory:${m.id}`, section: 'autobiographical_memory',
        provenanceClass: 'SUBJECTIVE MEMORY', knowledgeScope: 'CY_BELIEVES', privacyScope: m.privacyScope,
        senderId: m.subjectVisitorId, priority: 70, content: m.content }))];
      const result = safeBuildContext({ consumer, generationRef, currentSenderId, items });
      assert.equal(result.ok, true); return result;
    },
  });
  const manifest = { revision, run, fixtureHash: createHash('sha256').update(await readFile(join(home, 'fixtures.mjs'))).digest('hex'),
    harnessHash: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    model: live.deepseek.model, endpoint: 'https://api.deepseek.com/beta/chat/completions', cases: fixtures.length,
    noProductionWrites: true, notes: 'Actual Client/runtime/prompt/parser/provider/schema/reservation/settlement/application/retriever. Synthetic current-state broker items; no production personal history or Soma.' };
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(out, 'implementation.diff'), execFileSync('git', ['diff'], { cwd: root, encoding: 'utf8' }));
  const results = [];
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i]; activeCase = fixture.id;
    const visitor = createHash('md5').update(`synthetic:${fixture.id}`).digest('hex');
    const id = i + 1;
    sql(`INSERT INTO postcards(id,visitor_id,from_name,body,posted_at,deliver_at,recall_permission_version,recall_permitted_at)
      VALUES (${id},'${visitor}','SyntheticSender${id}',${quote(fixture.incoming)},NOW(),NOW(),'compact-public-recall-v1',NOW(3))`);
    const ts = new Date().toISOString().slice(0, 23).replace('T', ' ');
    const events = [{ kind: 'postcard_in', payload: { id, body: fixture.incoming, claim_generation: 0 } },
      { kind: 'postcard_out', payload: { id, reply_to: id, body: fixture.reply, claim_generation: 0 } }]
      .map(e => ({ ...e, ts, delivery_id: randomUUID() }));
    const published = await fetch(`${base}/api/ingest.php`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'synthetic-key' }, body: JSON.stringify({ events }) });
    assert.equal(published.status, 200, await published.clone().text());
    if (fixture.topic) await api('apply', { operations: [{ decision: 'CREATE', memoryId: randomUUID(), type: 'UNRESOLVED_THREAD',
      privacyScope: 'SENDER_RECALLABLE', content: fixture.topic, consistencyStatus: 'UNCERTAIN',
      source: { sourceType: 'POSTCARD', sourceId: 'synthetic-prior-topic', subjectVisitorId: visitor,
        sourceVisibility: 'SENDER_RECALLABLE', text: fixture.topic } }] });
    const job = (await api('claim_source', { sender_only: true, visitor_id: visitor })).job;
    assert.ok(job?.source?.publicExchange, 'actual publication permission must hydrate source');
    const before = sends, started = Date.now();
    const outcome = await runtime.processFormation(job);
    assert.ok(sends - before <= 1, 'no retry/replacement request');
    const record = { fixture, outcome, latencyMs: Date.now() - started,
      provider: providerEvidence.filter(r => r.caseId === fixture.id),
      completion: completions.filter(r => r.caseId === fixture.id),
      privateProvenance: sql(`SELECT m.id,m.origin_kind,s.source_type,s.source_id,s.source_visibility
        FROM autobiographical_memories m JOIN autobiographical_memory_sources s ON s.memory_id=m.id
        WHERE m.subject_visitor_id='${visitor}' AND m.privacy_scope='SENDER_RECALLABLE' ORDER BY m.id,s.source_type`),
      publicMemories: JSON.parse(sql(`SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',id,'scope',privacy_scope,'origin',origin_kind,'consistency',consistency_status,'summary',public_summary)), '[]')
        FROM autobiographical_memories WHERE subject_visitor_id='${visitor}' AND privacy_scope='PUBLIC_RECALLABLE'`)) };
    results.push(record);
    await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ case: fixture.id, status: outcome.status, public: record.publicMemories.map(m => m.summary), latencyMs: record.latencyMs, sends }));
    assert.ok(!record.provider.some(p => p.httpStatus >= 400 && p.httpStatus < 500), 'stop on provider configuration/auth/schema error rather than repeat it');
  }
  activeCase = null;
  assert.equal(sends, 16, 'exact fixed initial batch');
  const retrieval = [];
  for (const probe of probes) retrieval.push({ ...probe,
    result: await api('postcard_associations', { visitor_id: 'f'.repeat(32), query: { text: probe.text } }) });
  await writeFile(join(out, 'retrieval.json'), JSON.stringify(retrieval, null, 2));
  const ledger = sql('SELECT request_id,provider,configured_model,actual_model,status,decision,application_outcome,input_tokens,output_tokens,actual_gbp FROM memory_formation_inference_attempts ORDER BY created_at');
  await writeFile(join(out, 'ledger.tsv'), ledger);
  await writeFile(join(out, 'completions.json'), JSON.stringify(completions, null, 2));
  console.log(JSON.stringify({ sends, complete: results.length, costGbp: sql('SELECT SUM(actual_gbp) FROM memory_formation_inference_attempts'), retrievalProbes: retrieval.length }));
} finally {
  globalThis.fetch = rawFetch;
  if (server && server.exitCode === null) { const ended = new Promise(r => server.once('exit', r)); server.kill(); await ended; }
  // Non-destructive evidence: retain the isolated database files; no fixture
  // output enters production memory/continuation, and no originals are deleted.
  await writeFile(join(out, 'cleanup.json'), JSON.stringify({ stoppedPhp: !server || server.exitCode !== null || server.signalCode !== null,
    database, phpPid: server?.pid || null, phpExitCode: server?.exitCode, phpSignal: server?.signalCode,
    phpExitObserved: !server || server.exitCode !== null || server.signalCode !== null,
    productionTouched: false, sends, finishedAt: new Date().toISOString() }, null, 2));
}
