// Opt-in, exactly bounded rehearsal. Never starts the CY runner or Client.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASES, prepare, packet, recordFor, BASE } from './fixtures.mjs';
import { decideMeal, parseMealChoice, liveMeal, applyCommittedMeal } from '../../../runner/meal-choice.js';
import { materialiseMealConsumption, mealUnknownConsumption } from '../../../runner/environment.js';
import { observeEnvironmentRecord } from '../../../runner/grounded-environment-transition.js';
import { makeProviders } from '../../../runner/provider.js';
import { InferenceCoordinator } from '../../../runner/inference-coordinator.js';
import { withAbortTimeout } from '../../../runner/run.js';
import { createSomaRuntime } from '../../../runner/soma-runtime.js';

const home = dirname(fileURLToPath(import.meta.url));
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const sha = (value) => createHash('sha256').update(value).digest('hex');
export const CONFIG = Object.freeze({
  model: 'hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M', threads: 4,
  ollamaUrl: 'http://127.0.0.1:11434', ollamaArbiterUrl: 'http://127.0.0.1:11435',
});

export function consequenceCallbacks(p, result) {
  const fresh = createSomaRuntime(null, { now: BASE });
  const consume = (episode, atMs = BASE, unknown = false) => {
    const built = unknown ? mealUnknownConsumption(episode.meal, {
      mealId: episode.id, availabilityEventId: episode.availabilityEventId,
    }) : materialiseMealConsumption(episode.meal, episode.decision.action, {
      mealId: episode.id, availabilityEventId: episode.availabilityEventId, decisionId: episode.decision.id,
    });
    const record = recordFor(built, episode.effectEventId || `unknown-${p.c.id}`, atMs);
    observeEnvironmentRecord(p.soma, record);
    observeEnvironmentRecord(fresh, record);
    result.consequence = {
      world: record.world_event, feeding: fresh.state.feeding.records,
      sourceContext: fresh.groundedDirective({ now: atMs }).directive,
      intakeCount: fresh.state.feeding.records.length,
      action: unknown ? null : episode.decision.action,
    };
    // Existing canonical intake event deduplication is a second safety layer.
    observeEnvironmentRecord(fresh, record);
    assert.equal(fresh.state.feeding.records.length, 1);
  };
  return {
    readContext: () => p.context,
    checkpoint: async () => { result.checkpoints.push(JSON.parse(JSON.stringify(p.state))); },
    apply: (episode, atMs) => consume(episode, atMs),
    unknown: (episode) => consume(episode, BASE, true),
    diagnostic: (stage, episode, reason) => result.lifecycle.push({ stage, phase: episode.phase, reason }),
  };
}

export async function failureChecks() {
  const results = [];
  for (const kind of ['malformed', 'third_action', 'no_result', 'provider_failure', 'timeout', 'cancelled', 'stale']) {
    const p = prepare(CASES[0]);
    const result = { kind, checkpoints: [], lifecycle: [] };
    const controller = new AbortController();
    const callback = consequenceCallbacks(p, result);
    const accepted = await decideMeal(p.state, p.episode, {
      ...callback, characterContext: p.characterContext, signal: controller.signal,
      generate: async () => {
        if (kind === 'provider_failure') throw new Error('synthetic provider failure');
        if (kind === 'timeout') {
          return withAbortTimeout(controller, 5, () => new Promise((resolve, reject) => {
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
          }));
        }
        if (kind === 'cancelled') controller.abort();
        if (kind === 'stale') p.context.nowMs = p.episode.expiresAt;
        return kind === 'malformed' ? 'not JSON' : kind === 'third_action' ? '{"action":"partial"}'
          : kind === 'no_result' ? '' : '{"action":"eat"}';
      },
    });
    assert.equal(accepted, false);
    assert.equal(p.episode.phase, 'NO_DECISION');
    assert.equal(result.consequence.feeding[0].intakeOutcome, 'UNKNOWN');
    assert.equal(result.consequence.feeding[0].consumedEnergyKcal, null);
    assert.equal(result.consequence.action, null);
    results.push({ kind, phase: p.episode.phase, failure: p.episode.failure,
      intake: result.consequence.feeding[0], lifecycle: result.lifecycle });
  }
  return results;
}

export async function execute(out) {
  await mkdir(out); // No overwrite/resume/replacement batch.
  const requests = CASES.map(packet);
  assert.equal(requests.length, 20);
  const manifest = { runtimeRevision: '5087e53b5b1756b746fad16ac1eeb1251cb30983',
    createdAt: new Date().toISOString(), count: 20, maxModelSends: 20, retries: 0, repairs: 0,
    provider: 'ollama', config: CONFIG, timeoutMs: 600000, wallLimitMs: 7200000,
    fixturesSha256: sha(await readFile(join(home, 'fixtures.mjs'))), requests,
    isolation: 'Synthetic in-memory meal/Soma/checkpoints only. Native Windows-local existing Ollama and fair arbiter. No CY Client, config writes, production checkpoint, API, publication, maintenance hold or provider fallback.',
    limitation: 'EMPTY/FILLING/FULL are declared synthetic gut-state checkpoints projected by unchanged code, not a claim about naturally reachable routine states or subjective hunger. No preference/narrative reasons supplied.',
  };
  await writeFile(join(out, 'manifest.json'), json(manifest));
  const failures = await failureChecks();
  await writeFile(join(out, 'failure-semantics.json'), json(failures));
  const provider = makeProviders(CONFIG).ollama;
  const coordinator = new InferenceCoordinator();
  const start = Date.now(), results = [];
  let sends = 0;
  for (const c of CASES) {
    assert.ok(Date.now() - start < manifest.wallLimitMs, 'batch wall limit reached; no replacement');
    const p = prepare(c);
    assert.deepEqual(packet(c), requests.find((r) => r.case.id === c.id));
    const result = { id: c.id, case: c, startedAt: new Date().toISOString(),
      checks: [], checkpoints: [], lifecycle: [], raw: null, transport: null };
    const callbacks = consequenceCallbacks(p, result);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('MEAL_CHOICE_TIMEOUT')), 600000);
    const admittedAt = Date.now();
    let lease = null, hostLease = null;
    const accepted = await decideMeal(p.state, p.episode, {
      ...callbacks, characterContext: p.characterContext, signal: controller.signal,
      generate: async (call) => {
        assert.deepEqual(call, p.call, 'production mealModelCall must be used unchanged');
        try {
          lease = await coordinator.acquire({ purpose: 'meal_choice', deferStart: true }, controller.signal);
          hostLease = await provider.acquireSharedLease({ purpose: 'meal_choice', signal: controller.signal,
            onLost: () => controller.abort(new Error('LEASE_LOSS')), preemptible: false });
          const opts = provider.applySharedProfile(p.opts, hostLease);
          assert.deepEqual(opts, p.opts, 'same configured production options/profile');
          assert.ok(!controller.signal.aborted && liveMeal(p.episode, p.context));
          lease.begin();
          result.waitMs = Date.now() - admittedAt;
          assert.ok(sends < 20);
          await appendFile(join(out, 'sends.jsonl'), JSON.stringify({ ordinal: ++sends, caseId: c.id,
            at: new Date().toISOString(), call, opts }) + '\n');
          const inferenceAt = Date.now();
          const generated = await withAbortTimeout(controller, 600000, () => provider.rawGenerate({
            ...call, opts, signal: controller.signal, purpose: 'meal_choice',
          }));
          result.inferenceMs = Date.now() - inferenceAt;
          result.transport = { ok: generated.ok, status: generated.status, model: generated.model,
            stats: generated.stats || null };
          result.raw = generated.text;
          if (controller.signal.aborted) throw controller.signal.reason;
          return generated.ok ? generated.text : '';
        } catch (error) {
          result.error = String(error?.message || error);
          return '';
        } finally {
          lease?.finish();
          await hostLease?.release({ timeoutMs: 5000 });
          lease = null; hostLease = null;
        }
      },
    }).finally(() => clearTimeout(timer));
    result.accepted = accepted;
    result.action = accepted ? p.episode.decision.action : 'NO_DECISION';
    result.parse = parseMealChoice(result.raw);
    result.proseLeak = result.raw != null && !result.parse;
    result.totalMs = Date.now() - admittedAt;
    result.endedAt = new Date().toISOString();
    if (accepted) {
      assert.equal(result.consequence.feeding[0].intakeOutcome, result.action === 'eat' ? 'FULLY_CONSUMED' : 'REFUSED');
      assert.equal(result.consequence.feeding[0].consumedFraction, result.action === 'eat' ? 1 : 0);
      assert.ok(result.checkpoints.some((state) => state.episodes[0].phase === 'COMMITTED'));
      assert.equal(applyCommittedMeal(p.episode, callbacks), false);
    }
    results.push(result);
    await writeFile(join(out, 'results.json'), json(results));
    console.log(JSON.stringify({ id: c.id, profile: c.profile, action: result.action,
      raw: result.raw, waitMs: result.waitMs, inferenceMs: result.inferenceMs,
      tokens: result.transport?.stats?.eval_count, error: result.error || null }));
  }
  const counts = Object.fromEntries(['eat', 'decline', 'NO_DECISION'].map((key) =>
    [key, results.filter((result) => result.action === key).length]));
  await writeFile(join(out, 'completion.json'), json({ startedAt: new Date(start).toISOString(),
    completedAt: new Date().toISOString(), sends, opportunities: results.length, counts,
    productionWrites: 0, providerFallbacks: 0, repairs: 0, retries: 0, elapsedMs: Date.now() - start }));
  assert.equal(results.length, 20);
  assert.equal(sends, 20);
  console.log(JSON.stringify({ complete: true, sends, counts }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2], out = resolve(process.argv[3] || join(home, 'prepared'));
  if (mode === '--prepare') {
    await mkdir(out);
    await writeFile(join(out, 'requests.json'), json(CASES.map(packet)));
    await writeFile(join(out, 'failure-semantics.json'), json(await failureChecks()));
    console.log('Prepared exactly 20 fixed opportunities, offline only.');
  } else if (mode === '--execute-20-actual-configured-model') await execute(out);
  else throw new Error('Explicit offline prepare or bounded real-model opt-in required');
}
