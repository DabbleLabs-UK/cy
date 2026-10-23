// One correction candidate, rehearsal only. Runtime helper is not changed.
import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAIN, packet, sha256, summary } from './order-diagnostic.mjs';
import { prepare } from './fixtures.mjs';
import { CONFIG, consequenceCallbacks } from './rehearse.mjs';
import { decideMeal, parseMealChoice } from '../../../runner/meal-choice.js';
import { makeProviders } from '../../../runner/provider.js';
import { InferenceCoordinator } from '../../../runner/inference-coordinator.js';
import { withAbortTimeout } from '../../../runner/run.js';

export const CASES = Object.freeze(MAIN.slice(0, 8).map(c => ({ ...c, id: c.id.replace('order-', 'no-hint-') })));
export function probePacket(c) {
  const original = packet(c), next = JSON.parse(JSON.stringify(original));
  const prompt = JSON.parse(next.call.prompt);
  delete prompt.response;
  next.call.prompt = JSON.stringify(prompt);
  next.wireBody.prompt = next.call.prompt;
  const restored = JSON.parse(next.call.prompt);
  restored.response = JSON.parse(original.call.prompt).response;
  assert.equal(JSON.stringify(restored), original.call.prompt);
  return next;
}

export async function execute(out) {
  await mkdir(out);
  const manifest = { correctionCandidate: 'Remove only redundant response.action answer hint.',
    runtimeUnchanged: true, maxSends: 8, count: 8, repairs: 0, retries: 0,
    config: CONFIG, requests: CASES.map(probePacket) };
  await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const provider = makeProviders(CONFIG).ollama, coordinator = new InferenceCoordinator();
  const results = [], started = Date.now();
  let sends = 0;
  for (const c of CASES) {
    const p = prepare(c), expected = probePacket(c), controller = new AbortController();
    const result = { id: c.id, case: c, packet: expected, raw: null,
      startedAt: new Date().toISOString(), checkpoints: [], lifecycle: [] };
    const admittedAt = Date.now(), callbacks = consequenceCallbacks(p, result);
    const timer = setTimeout(() => controller.abort(new Error('MEAL_CHOICE_TIMEOUT')), 600000);
    try {
      result.accepted = await decideMeal(p.state, p.episode, { ...callbacks,
        characterContext: p.characterContext, signal: controller.signal,
        generate: async call => {
          assert.deepEqual(call, expected.sourceCall);
          let lease = null, host = null;
          try {
            lease = await coordinator.acquire({ purpose: 'meal_choice', deferStart: true }, controller.signal);
            host = await provider.acquireSharedLease({ purpose: 'meal_choice', signal: controller.signal,
              onLost: () => controller.abort(new Error('LEASE_LOSS')), preemptible: false });
            const opts = provider.applySharedProfile(p.opts, host);
            assert.deepEqual(opts, expected.options);
            assert.ok(!controller.signal.aborted && sends < 8);
            lease.begin();
            result.waitMs = Date.now() - admittedAt;
            await appendFile(resolve(out, 'sends.jsonl'), JSON.stringify({ ordinal: ++sends,
              id: c.id, at: new Date().toISOString(), body: expected.wireBody,
              bodySha256: sha256(JSON.stringify(expected.wireBody)) }) + '\n');
            const at = Date.now();
            const response = await withAbortTimeout(controller, 600000, () => provider.rawGenerate({
              ...expected.call, opts, signal: controller.signal, purpose: 'meal_choice' }));
            result.inferenceMs = Date.now() - at;
            result.transport = response;
            result.raw = response.text;
            if (!response.ok || controller.signal.aborted) return '';
            result.rawLabel = parseMealChoice(result.raw);
            return result.raw;
          } catch (error) { result.error = String(error?.message || error); return ''; }
          finally { lease?.finish(); await host?.release({ timeoutMs: 5000 }); }
        },
      });
    } finally { clearTimeout(timer); }
    result.action = result.accepted ? p.episode.decision.action : 'NO_DECISION';
    result.totalMs = Date.now() - admittedAt;
    result.endedAt = new Date().toISOString();
    results.push(result);
    await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify({ id: c.id, profile: c.profile, condition: c.condition,
      raw: result.raw, action: result.action, waitMs: result.waitMs, inferenceMs: result.inferenceMs }));
  }
  const report = { ...summary(results), sends, elapsedMs: Date.now() - started,
    startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(), retries: 0, repairs: 0 };
  assert.equal(results.length, 8);
  assert.ok(sends <= 8);
  await writeFile(resolve(out, 'completion.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== '--execute-eight-no-response-probe') throw new Error('Explicit correction-probe flag required');
  await execute(resolve(process.argv[3]));
}
