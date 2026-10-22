// Explicitly opted-in synthetic cloud rehearsal. Never imports/starts the runner main loop.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from './cases.mjs';
import { canonicalPostcardContext } from '../../../runner/postcard-context.js';
import { buildDirectives, completionBudget, completionDirective, letterPredict, options,
  applyBurstSeparator } from '../../../runner/prompt.js';
import { buildContextPacket, createContextItem, CONTEXT_CONSUMERS, renderContextPacket } from '../../../runner/context-broker.js';
import { reconcileSoma, groundedSomaDirective } from '../../../runner/soma.js';
import { generateWithCharacterRepair } from '../../../runner/character-output.js';
import { PostcardInference, validatePostcardCandidate } from '../../../runner/postcard-inference.js';
import { makeProviders, looksLikeRefusal } from '../../../runner/provider.js';
import { createWarden, sanitize, stripScaffold, stripScaffoldAccounted, looksLikeAssistantFrame,
  repeatsWithinBurst } from '../../../runner/warden.js';
import { readNdjsonStream, generationHitTokenLimit } from '../../../runner/run.js';

const home = dirname(fileURLToPath(import.meta.url));
const root = resolve(home, '../../..');
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
export const config = Object.freeze({ threads: 4, model: 'hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M',
  apiBase: 'https://synthetic.invalid', ingestKey: 'synthetic-only',
  deepseek: { model: 'deepseek-v4-flash', apiBase: 'https://api.deepseek.com', maxTokens: 512 } });
const warden = createWarden({}, join(home, 'unused-block-log'));

export function prepare(c) {
  const now = Date.parse(c.at);
  const grounded = groundedSomaDirective(reconcileSoma(null, { now }), { now });
  const item = (id, section, provenanceClass, content, mandatory = false) => createContextItem({ id, sourceId: id,
    section, provenanceClass, content, mandatory, knowledgeScope: 'CY_OBSERVED', privacyScope: 'INTERNAL_ONLY' });
  const packet = buildContextPacket({ consumer: CONTEXT_CONSUMERS.CY_PROSE, items: [
    item('current-time:synthetic', 'mandatory_current_state', 'WORLD FACT',
      `Current HMP ThinkPad regime and clock: synthetic ${c.at}. Authoritative location: ${c.location}; activity ${c.activity}. Movement remains subject to the prison routine; no prison-exit permission is supplied.`, true),
    item('synthetic-observation', 'recent_events', 'OBSERVED BY CY', `${c.at}: ${c.event}`),
    item('grounded-soma:current', 'grounded_soma', 'MODEL ESTIMATE', grounded.directive),
  ] });
  const target = letterPredict(c.body);
  const directives = buildDirectives({}, 'letter', { sharedContext: renderContextPacket(packet), length: completionDirective(target) });
  const context = canonicalPostcardContext({ postcard: { from_name: 'Alex', body: c.body,
    ...(c.picture ? { image_path: 'synthetic-picture', caption: c.picture } : {}) },
    directives, priorWriting: c.prior, now: c.at, location: c.location });
  return { id: c.id, inbound: warden.screenIn(c.body),
    controlInbound: c.screenedControl ? warden.screenIn(c.screenedControl) : null,
    ...context, opts: options({}, config.threads, 'letter', { num_predict: completionBudget(target) }) };
}

export function publicProjection(candidate, tokenLimited = false) {
  const accounted = stripScaffoldAccounted(sanitize(candidate));
  const buffer = warden.newBuffer();
  const chunks = [...buffer.push(accounted.out), ...buffer.flush({ tokenLimited })];
  let visible = '';
  const discarded = [];
  for (const raw of chunks) {
    const clean = sanitize(raw);
    if (looksLikeAssistantFrame(clean)) { discarded.push('assistant-frame'); break; }
    const text = stripScaffoldAccounted(clean).out;
    if (!text.trim()) continue;
    const screen = warden.screenOut(text);
    if (!screen.ok) { discarded.push(screen.reason); continue; }
    const separated = applyBurstSeparator(visible, text);
    if (repeatsWithinBurst(separated, visible)) { discarded.push('within-burst-repeat'); break; }
    visible += separated;
  }
  return { text: visible.trim(), discarded, stripped: accounted.removed };
}

function readProductionKey() {
  try { return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'dell',
    'cat', '/mnt/c/dev/cy/runner/deepseek.key'], { encoding: 'utf8', windowsHide: true, timeout: 20000 }).trim(); }
  catch { throw new Error('Read-only rehearsal credential acquisition failed'); }
}

export async function execute(out, { readKey = readProductionKey } = {}) {
  const candidate = '18ce5d84ffa078553ad51fc701109616b8bdea78';
  execFileSync('git', ['merge-base', '--is-ancestor', candidate, 'HEAD'], { cwd: root });
  assert.equal(execFileSync('git', ['diff', candidate, '--', 'runner'], { cwd: root, encoding: 'utf8' }).trim(), '',
    'no runtime wording change is allowed within a batch');
  await mkdir(out); // Never overwrite or resume an existing batch.
  const prepared = cases.map(prepare);
  assert.equal(prepared.length, 16);
  const manifest = { revision: '18ce5d8', casesSha256: sha(await readFile(join(home, 'cases.mjs'))),
    model: config.deepseek.model, provider: 'deepseek', count: 16, maxCalls: 32, maxRepairsPerCase: 1,
    sampler: { temperature: 0.72, top_p: 0.86 }, timeoutMs: 600000, wallLimitMs: 900000,
    isolation: 'Only provider HTTPS. Synthetic in-memory accounting; no production API, database, memory or state.',
    requests: prepared };
  await writeFile(join(out, 'manifest.json'), json(manifest));
  // Only the dedicated key file is read. It stays in process memory, never evidence or console output.
  let key = readKey();
  assert.ok(key.length > 10);
  const originalFetch = globalThis.fetch;
  const deadline = Date.now() + manifest.wallLimitMs;
  let sends = 0, active = null;
  const evidence = [], ledger = [], results = [];
  const checkpoint = async () => {
    await writeFile(join(out, 'provider-evidence.json'), json(evidence));
    await writeFile(join(out, 'ledger.json'), json(ledger));
    await writeFile(join(out, 'results.json'), json(results));
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.deepseek.com/chat/completions', 'no other network destination');
    assert.ok(active && sends < 32 && Date.now() < deadline, 'fixed call and wall-clock bound');
    const request = JSON.parse(init.body);
    assert.equal(request.model, config.deepseek.model);
    assert.equal(request.stream, true);
    assert.deepEqual(request.thinking, { type: 'disabled' });
    const record = { ordinal: ++sends, caseId: active, started: new Date().toISOString(), request };
    evidence.push(record);
    await checkpoint(); // Dispatch intent precedes every call; never retry an uncertain send.
    const response = await originalFetch(url, { ...init, redirect: 'error' });
    record.httpStatus = response.status;
    record.rawStream = response.clone().text();
    return response;
  };
  // Production reservation/settlement class, with a local non-network accounting adapter.
  // It is not a paid production ledger and creates no canonical production turn.
  let reservation = 0;
  const accounting = new PostcardInference(config, { fetchImpl: async (_url, init) => {
    const data = JSON.parse(init.body);
    ledger.push({ caseId: active, ...data });
    const value = data.action === 'reserve' ? { ok: true, execute: true, request_id: `synthetic-${++reservation}` }
      : { ok: true, execute: true, cost_gbp: null, cost_usd: null };
    return new Response(JSON.stringify(value), { status: 200 });
  } });
  const provider = makeProviders(config, { deepseekKey: key }).deepseek;
  try {
    for (let i = 0; i < prepared.length; i++) {
      const c = prepared[i]; active = c.id;
      const row = { id: c.id, body: cases[i].body, inbound: c.inbound, controlInbound: c.controlInbound, attempts: [] };
      results.push(row);
      if (!c.inbound.ok) { row.accepted = ''; row.status = 'inbound-blocked'; await checkpoint(); continue; }
      const turn = accounting.turn({ id: 10001 + i, claim_generation: 1 }, { provider: 'deepseek', route: 'AUTO' });
      const result = await generateWithCharacterRepair({ prompt: c.prompt,
        validate: () => validatePostcardCandidate(row.attempts.at(-1)?.candidate || ''),
        generate: async (prompt, { repair }) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), Math.min(600000, Math.max(1, deadline - Date.now())));
          const attempt = { repair, candidate: '', started: new Date().toISOString() };
          row.attempts.push(attempt); const started = Date.now();
          try {
            await turn.beforeRequest({ system: c.system, prompt, opts: c.opts, repair, provider });
            turn.markDispatched();
            const stream = await provider.openStream({ system: c.system, prompt, opts: c.opts,
              signal: controller.signal, purpose: 'postcard' });
            if (!stream.ok) { attempt.error = true; attempt.httpStatus = stream.status; }
            else {
              await readNdjsonStream(stream.reader, { signal: controller.signal,
                onToken: token => { attempt.candidate += token; }, onDone: stats => { attempt.stats = stats; } });
              if (!attempt.stats?.done) attempt.error = true;
              const clean = stripScaffold(sanitize(attempt.candidate));
              if (provider.screensContent && clean.trim() && looksLikeRefusal(clean)) attempt.refused = true;
              attempt.tokenLimited = generationHitTokenLimit(attempt.stats, c.opts);
              attempt.validation = validatePostcardCandidate(attempt.candidate);
            }
          } catch (error) { attempt.error = true; attempt.errorClass = error.name; attempt.aborted = controller.signal.aborted; }
          finally {
            clearTimeout(timer); attempt.latencyMs = Date.now() - started;
            for (const e of evidence.filter(e => e.rawStream instanceof Promise)) {
              try { e.rawStream = await e.rawStream; } catch { e.rawStream = null; e.streamError = true; }
              e.finished = new Date().toISOString();
            }
            await turn.afterCandidate(attempt); await checkpoint();
          }
          return attempt;
        }, onDiagnostic: detail => { row.repairDiagnostic = detail; },
      });
      row.characterValidation = result.characterValidation || null;
      row.status = result.error || result.aborted ? 'provider-error' : result.refused ? 'refused'
        : result.characterDiscarded ? 'discarded-to-silence' : 'validated';
      row.projection = row.status === 'validated' ? publicProjection(result.candidate, result.tokenLimited) : null;
      row.accepted = row.projection?.text || '';
      await turn.outcome(row.accepted ? 'generated' : 'validation_rejected');
      await checkpoint();
      console.log(`${row.id}: ${row.status}, calls=${row.attempts.length}, tokens=${row.attempts.at(-1)?.stats?.eval_count ?? 'unknown'}`);
      if (turn.ambiguous || Date.now() >= deadline) throw new Error('Ambiguous provider outcome or experiment wall-clock bound; no replacement');
    }
    await writeFile(join(out, 'completion.json'), json({ sends, cases: results.length, finished: new Date().toISOString(),
      syntheticOnly: true, productionWrites: 0, localInference: false }));
  } finally { globalThis.fetch = originalFetch; key = ''; await checkpoint(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--dry-run') {
    const prepared = cases.map(prepare);
    console.log(json({ cases: prepared.map(c => ({ id: c.id, inbound: c.inbound, controlInbound: c.controlInbound,
      systemChars: c.system.length, promptChars: c.prompt.length, opts: c.opts })), sends: 0 }));
  } else {
    assert.equal(process.argv[2], '--execute', 'explicit execution opt-in required');
    assert.equal(process.argv[3], 'baseline-18ce5d8', 'one declared batch, no silent repeats');
    await execute(join(home, process.argv[3]));
  }
}
