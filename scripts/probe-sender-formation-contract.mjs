// Opt-in, non-publishing acceptance probe. Synthetic SQLite state exists only
// in this process; the remote side imports the unchanged deployed provider.
// Run with CY_RUN_LOCAL_FORMATION_PROBE=1 and --rounds=1 (maximum 3).
// Requires Node with node:sqlite and host SSH access to the DELL alias.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { AutobiographicalMemoryRuntime } from '../runner/memory-runtime.js';
import { createContextItem, buildContextPacket, renderContextPacket } from '../runner/context-broker.js';

if (process.env.CY_RUN_LOCAL_FORMATION_PROBE !== '1') {
  throw new Error('Explicit CY_RUN_LOCAL_FORMATION_PROBE=1 is required; this probe uses local model capacity.');
}
const rounds = Number(process.argv.find(value => value.startsWith('--rounds='))?.split('=')[1] || 1);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) throw new Error('rounds must be 1..3');
const sender = 'synthetic-sender';
const fixtures = [
  { key: 'person', text: 'My dog is called Alfie.', expected: 'CREATE', type: 'PERSON' },
  { key: 'topic', text: 'I am waiting for an important result and will tell you next time. The result is still unknown, so please remember this open topic for our next exchange.', expected: 'CREATE', type: 'UNRESOLVED_THREAD' },
  { key: 'greeting', text: "Hi, hope you're okay.", expected: 'NOTHING' },
  { key: 'resolution', text: 'The important result I was waiting for has arrived: I passed. That question is settled now; I am no longer waiting for it.', expected: 'RESOLVE', candidates: [{
    id: 'synthetic-open-topic', type: 'UNRESOLVED_THREAD', status: 'ACTIVE', version: 1,
    privacyScope: 'SENDER_RECALLABLE', subjectVisitorId: sender, consistencyStatus: 'CONSISTENT',
    content: 'The sender is waiting for an important result and plans to tell Cy when it arrives.',
  }] },
];
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE fixtures (id INTEGER PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE completions (id INTEGER PRIMARY KEY, body TEXT NOT NULL);');
fixtures.forEach((fixture, i) => db.prepare('INSERT INTO fixtures VALUES (?,?)').run(i + 1, JSON.stringify(fixture)));
const hashes = {};
for (const file of ['runner/autobiographical-memory.js', 'runner/memory-runtime.js']) {
  hashes[file] = createHash('sha256').update(await readFile(new URL(`../${file}`, import.meta.url))).digest('hex');
}
console.log(JSON.stringify({ kind: 'probe_start', rounds, fixtures: fixtures.map(x => x.key), source_sha256: hashes,
  isolation: 'synthetic in-memory SQLite; no production client/API; no paid provider',
  lease_wait_limit_ms: 240000, inference_limit_ms: 120000,
  note: 'Probe budgets isolate inference from contention; production 120s total timeout is not changed.' }));

function remoteGenerate(call) {
  const packet = Buffer.from(JSON.stringify({ system: call.system, prompt: call.prompt, options: call.options,
    purpose: call.purpose, format: call.format })).toString('base64');
  const script = `
import { readFile } from 'node:fs/promises';
import { makeProviders } from 'file:///C:/dev/cy/runner/provider.js';
import { options } from 'file:///C:/dev/cy/runner/prompt.js';
const call=JSON.parse(Buffer.from('${packet}','base64').toString('utf8'));
const cfg=JSON.parse(await readFile('C:/dev/cy/runner/config.json','utf8'));
const provider=makeProviders(cfg).ollama;
if (!cfg.ollamaArbiterUrl || !provider.local || provider.costsMoney) throw Error('leased local provider required');
const controller=new AbortController();
let reason=null, lease=null, started=null;
const queued=Date.now();
let timer=setTimeout(()=>{reason='MODEL_ACCESS_TIMEOUT';controller.abort();},240000);
const metrics={provider:provider.id,model:provider.modelFor(call.purpose),queued_at:new Date(queued).toISOString()};
try {
 lease=await provider.acquireSharedLease({purpose:'memory_formation_contract_probe',signal:controller.signal,preemptible:true,onLost:r=>{reason=r;controller.abort();}});
 clearTimeout(timer);
 started=Date.now(); metrics.wait_ms=started-queued; metrics.owner_at_request=lease.ownerAtRequest;
 metrics.inference_started_at=new Date(started).toISOString();
 timer=setTimeout(()=>{reason='INFERENCE_TIMEOUT';controller.abort();},120000);
 const opts=provider.applySharedProfile(options({},cfg.threads,'journal',call.options),lease);
 metrics.options=opts;
 const result=await provider.rawGenerate({system:call.system,prompt:call.prompt,opts,signal:controller.signal,purpose:call.purpose,format:call.format});
 metrics.inference_ms=Date.now()-started; metrics.inference_ended_at=new Date().toISOString();
 metrics.output_tokens=result.stats?.eval_count; metrics.prompt_tokens=result.stats?.prompt_eval_count;
 metrics.finish_reason=result.stats?.done_reason; metrics.output_chars=result.text?.length;
 metrics.token_limited=result.stats?.done_reason==='length'||result.stats?.eval_count>=opts.num_predict;
 if(!result.ok) throw Error('PROVIDER_HTTP_'+result.status);
 console.log(JSON.stringify({kind:'provider_result',text:result.text,metrics}));
} catch(error) {
 metrics.wait_ms ??= Date.now()-queued;
 if(started) metrics.inference_ms=Date.now()-started;
 console.log(JSON.stringify({kind:'provider_error',error:reason||error.message,metrics}));
} finally { clearTimeout(timer); if(lease) await lease.release(); }
`;
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', ['dell', 'node.exe --input-type=module'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => child.kill(), 380000);
    const abort = () => child.kill();
    call.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timeout); call.signal?.removeEventListener('abort', abort);
      const line = stdout.split(/\r?\n/).find(value => value.startsWith('{"kind":"provider_'));
      if (!line) return reject(new Error(`remote probe exited ${code}: ${stderr.slice(0, 300)}`));
      resolve(JSON.parse(line));
    });
    child.stdin.end(script);
  });
}

let passed = 0;
try {
  for (let round = 1; round <= rounds; round++) {
    for (const row of db.prepare('SELECT id,body FROM fixtures ORDER BY id').all()) {
      const fixture = JSON.parse(row.body);
      const id = (round - 1) * fixtures.length + row.id;
      const source = { sourceType: 'POSTCARD', sourceId: `synthetic-${fixture.key}-${round}`,
        occurredAt: '2026-10-05T12:00:00.000Z', text: fixture.text, sourceVisibility: 'SENDER_RECALLABLE',
        subjectVisitorId: sender, participantLabel: 'Synthetic visitor', tags: [] };
      let providerResult, requestMetrics;
      const runtime = new AutobiographicalMemoryRuntime({
        makeId: () => `synthetic-${randomUUID()}`, backgroundTimeoutMs: 385000,
        client: {
          queryMemories: async () => ({ candidates: fixture.candidates || [] }),
          finishMemorySource: async completion => {
            db.prepare('INSERT INTO completions VALUES (?,?)').run(id, JSON.stringify(completion));
            return { result_category: completion.result_category, status: 'PROCESSED' };
          },
        },
        contextBroker: ({ consumer, currentSenderId, provenanceSource, memoryCandidates }) => {
          const items = [createContextItem({ id: 'memory-source:current', sourceId: provenanceSource.sourceId,
            section: 'provenance_source', provenanceClass: 'OBSERVED BY CY', knowledgeScope: 'CY_OBSERVED',
            privacyScope: 'SENDER_RECALLABLE', senderId: currentSenderId, mandatory: true, priority: 100,
            content: provenanceSource.text })];
          for (const memory of memoryCandidates) items.push(createContextItem({ id: `memory:${memory.id}`,
            sourceId: `memory:${memory.id}`, section: 'autobiographical_memory', provenanceClass: 'SUBJECTIVE MEMORY',
            knowledgeScope: 'CY_BELIEVES', privacyScope: memory.privacyScope, senderId: memory.subjectVisitorId,
            priority: 70, content: memory.content }));
          const packet = buildContextPacket({ consumer, currentSenderId, generationRef: 'synthetic-probe', items });
          return { rendering: renderContextPacket(packet) };
        },
        generate: async call => {
          requestMetrics = { system_chars: call.system.length, prompt_chars: call.prompt.length,
            format_sha256: createHash('sha256').update(JSON.stringify(call.format)).digest('hex') };
          providerResult = await remoteGenerate(call);
          if (providerResult.kind === 'provider_error') throw new Error(providerResult.error);
          return providerResult.text;
        },
        providerInfo: () => ({ id: 'ollama', model: 'deployed-local-model' }),
      });
      console.log(JSON.stringify({ kind: 'fixture_start', fixture: fixture.key, round }));
      const result = await runtime.processFormation({ id, claim_token: `synthetic-${id}`, source }, 1);
      const completion = JSON.parse(db.prepare('SELECT body FROM completions WHERE id=?').get(id).body);
      const operation = completion.operations[0];
      const valid = result.status === fixture.expected && (!fixture.type || operation?.type === fixture.type)
        && (fixture.expected !== 'RESOLVE' || operation?.memoryId === 'synthetic-open-topic');
      if (valid) passed++;
      console.log(JSON.stringify({ kind: 'fixture_result', fixture: fixture.key, round, passed: valid,
        result: result.status, rejection_code: completion.rejection_code, decision: providerResult?.text || null,
        metrics: providerResult?.metrics, request: requestMetrics, error: completion.error || null }));
      // A semantic mismatch is reported, not automatically retried or tuned.
      // Continue only the explicitly requested bounded fixture set. Structural
      // failure or unavailable infrastructure stops further inference.
      if (!providerResult || providerResult.kind !== 'provider_result' || result.status === 'INVALID') {
        console.log(JSON.stringify({ kind: 'probe_stopped', reason: 'structural_or_infrastructure_failure', passed, attempted: id }));
        process.exitCode = 1;
        break;
      }
    }
    if (process.exitCode) break;
  }
  console.log(JSON.stringify({ kind: 'probe_end', passed, completed: db.prepare('SELECT COUNT(*) AS n FROM completions').get().n }));
  if (passed !== rounds * fixtures.length) process.exitCode = 1;
} finally { db.close(); }
