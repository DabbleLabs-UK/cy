// Final fixed opaque-label diagnostic. Rehearsal only, no production integration.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepare } from './fixtures.mjs';
import { CONFIG, consequenceCallbacks, failureChecks } from './rehearse.mjs';
import { decode, sha256 } from './order-diagnostic.mjs';
import { decideMeal, parseMealChoice } from '../../../runner/meal-choice.js';
import { makeProviders } from '../../../runner/provider.js';
import { InferenceCoordinator } from '../../../runner/inference-coordinator.js';
import { withAbortTimeout } from '../../../runner/run.js';

// Gray-code ordering interleaves state/mapping/presentation changes. The second
// full factorial block reverses the first; all sixteen cells occur twice.
const block = Array.from({ length: 16 }, (_, i) => {
  const bits = i ^ (i >> 1);
  return { profile: bits & 1 ? 'FULL' : 'EMPTY',
    eatId: bits & 2 ? 'B' : 'A', displayOrder: bits & 4 ? 'BA' : 'AB',
    enumOrder: bits & 8 ? 'BA' : 'AB' };
});
export const CASES = Object.freeze([block, [...block].reverse()].flatMap((items, round) =>
  items.map((c, index) => Object.freeze({ ...c, id: `final-${String(round * 16 + index + 1).padStart(2, '0')}`,
    meal: 'lunch', injury: false, round: round + 1 }))));

export function packet(c) {
  const p = prepare(c), source = p.call, call = JSON.parse(JSON.stringify(source));
  const prompt = JSON.parse(source.prompt);
  assert.equal(Object.hasOwn(prompt, 'response'), false, 'corrected helper only; no answer hint');
  const mapping = c.eatId === 'A' ? { A: 'eat', B: 'decline' } : { A: 'decline', B: 'eat' };
  const display = c.displayOrder.split(''), enumeration = c.enumOrder.split('');
  prompt.choices = Object.fromEntries(display.map(id => [id, prompt.choices[mapping[id]]]));
  call.prompt = JSON.stringify(prompt);
  call.format.properties.action.enum = enumeration;
  return { case: c, supportedContext: p.characterContext, sourceCall: source, call,
    mapping, display, enumeration, options: p.opts,
    wireBody: { model: CONFIG.model, system: call.system, prompt: call.prompt,
      options: p.opts, keep_alive: -1, stream: false, format: call.format } };
}

export function summarize(results) {
  const cells = {}, semantic = { eat: 0, decline: 0, NO_DECISION: 0 };
  const opaqueId = { A: 0, B: 0 }, displayPosition = { first: 0, second: 0 };
  const enumPosition = { first: 0, second: 0 };
  const body = { EMPTY: { eat: 0, decline: 0, NO_DECISION: 0 }, FULL: { eat: 0, decline: 0, NO_DECISION: 0 } };
  for (const r of results) {
    const key = `${r.case.eatId}/${r.case.displayOrder}/${r.case.enumOrder}/${r.case.profile}`;
    const cell = cells[key] ||= { eat: 0, decline: 0, NO_DECISION: 0, A: 0, B: 0 };
    semantic[r.action]++; cell[r.action]++; body[r.case.profile][r.action]++;
    if (r.accepted) {
      opaqueId[r.rawId]++; cell[r.rawId]++;
      displayPosition[r.packet.display[0] === r.rawId ? 'first' : 'second']++;
      enumPosition[r.packet.enumeration[0] === r.rawId ? 'first' : 'second']++;
    }
  }
  return { opportunities: results.length, semantic, opaqueId, displayPosition, enumPosition, body, cells };
}

export async function execute(out) {
  await mkdir(out); // Fail rather than overwrite/resume an interrupted batch.
  const manifest = { runtimeRevision: '1219d21dcf0cbb8595ab78829c5b3b4fc177fc99',
    createdAt: new Date().toISOString(), config: CONFIG, count: 32, maxSends: 32,
    repairs: 0, retries: 0, perOpportunityMs: 600000, requests: CASES.map(packet),
    scope: 'Synthetic fixed-clock in-memory meal/Soma/checkpoint state. No Client/main loop, production state/publication/accounting API, maintenance hold, provider fallback or production opaque IDs.' };
  await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(resolve(out, 'failure-semantics.json'), JSON.stringify(await failureChecks(), null, 2) + '\n');
  const provider = makeProviders(CONFIG).ollama, coordinator = new InferenceCoordinator();
  const results = [], started = Date.now();
  let sends = 0;
  for (const c of CASES) {
    const p = prepare(c), expected = packet(c), controller = new AbortController();
    const result = { id: c.id, case: c, packet: expected, raw: null,
      startedAt: new Date().toISOString(), checkpoints: [], lifecycle: [] };
    const callbacks = consequenceCallbacks(p, result), admittedAt = Date.now();
    const timer = setTimeout(() => controller.abort(new Error('MEAL_CHOICE_TIMEOUT')), 600000);
    try {
      result.accepted = await decideMeal(p.state, p.episode, { ...callbacks,
        characterContext: p.characterContext, signal: controller.signal,
        generate: async source => {
          assert.deepEqual(source, expected.sourceCall);
          let lease = null, host = null;
          try {
            lease = await coordinator.acquire({ purpose: 'meal_choice', deferStart: true }, controller.signal);
            host = await provider.acquireSharedLease({ purpose: 'meal_choice', signal: controller.signal,
              onLost: () => controller.abort(new Error('LEASE_LOSS')), preemptible: false });
            const opts = provider.applySharedProfile(p.opts, host);
            assert.deepEqual(opts, expected.options);
            assert.ok(!controller.signal.aborted && sends < 32);
            lease.begin(); result.waitMs = Date.now() - admittedAt;
            await appendFile(resolve(out, 'sends.jsonl'), JSON.stringify({ ordinal: ++sends, id: c.id,
              at: new Date().toISOString(), body: expected.wireBody,
              bodySha256: sha256(JSON.stringify(expected.wireBody)) }) + '\n');
            const at = Date.now();
            const response = await withAbortTimeout(controller, 600000, () => provider.rawGenerate({
              ...expected.call, opts, signal: controller.signal, purpose: 'meal_choice' }));
            result.inferenceMs = Date.now() - at; result.transport = response; result.raw = response.text;
            if (!response.ok || controller.signal.aborted) return '';
            result.decoded = decode(result.raw, expected.mapping);
            if (!result.decoded) return '';
            result.rawId = JSON.parse(result.raw).action;
            result.displayPosition = expected.display.indexOf(result.rawId) + 1;
            result.enumPosition = expected.enumeration.indexOf(result.rawId) + 1;
            return JSON.stringify({ action: result.decoded });
          } catch (error) { result.error = String(error?.message || error); return ''; }
          finally { lease?.finish(); await host?.release({ timeoutMs: 5000 }); }
        },
      });
    } finally { clearTimeout(timer); }
    result.action = result.accepted ? p.episode.decision.action : 'NO_DECISION';
    result.totalMs = Date.now() - admittedAt; result.endedAt = new Date().toISOString();
    results.push(result);
    await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify({ id: c.id, body: c.profile, eatId: c.eatId,
      display: c.displayOrder, enumeration: c.enumOrder, raw: result.raw, action: result.action,
      waitMs: result.waitMs, inferenceMs: result.inferenceMs, error: result.error || null }));
  }
  const report = { ...summarize(results), sends, retries: 0, repairs: 0,
    startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(), elapsedMs: Date.now() - started };
  assert.equal(results.length, 32); assert.ok(sends <= 32);
  await writeFile(resolve(out, 'completion.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}

export async function analyse(out) {
  const read = async name => JSON.parse(await readFile(resolve(out, name), 'utf8'));
  const manifest = await read('manifest.json'), results = await read('results.json'), completion = await read('completion.json');
  const sends = (await readFile(resolve(out, 'sends.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(manifest.requests, CASES.map(packet));
  assert.deepEqual(results.map(r => r.id), CASES.map(c => c.id));
  assert.equal(completion.sends, sends.length); assert.ok(sends.length <= 32);
  assert.equal(new Set(sends.map(s => s.id)).size, sends.length);
  assert.deepEqual(sends.map(s => s.ordinal), sends.map((_, i) => i + 1));
  for (const [i, r] of results.entries()) {
    const expected = packet(CASES[i]), sent = sends.find(s => s.id === r.id);
    assert.deepEqual(r.packet, expected);
    if (sent) { assert.deepEqual(sent.body, expected.wireBody); assert.equal(sent.bodySha256, sha256(JSON.stringify(sent.body))); }
    if (r.transport) {
      assert.equal(r.raw, r.transport.text);
      if (r.transport.stats?.response != null) assert.equal(r.raw, r.transport.stats.response);
    }
    if (r.accepted) {
      assert.equal(decode(r.raw, expected.mapping), r.action);
      assert.equal(parseMealChoice(JSON.stringify({ action: r.action })), r.action);
      assert.equal(r.rawId, JSON.parse(r.raw).action);
      assert.equal(r.consequence.intakeCount, 1);
      assert.equal(r.consequence.feeding[0].intakeOutcome, r.action === 'eat' ? 'FULLY_CONSUMED' : 'REFUSED');
      assert.equal(r.checkpoints.at(-1).episodes[0].phase, 'APPLIED');
    } else assert.equal(r.action, 'NO_DECISION');
  }
  const calculated = summarize(results);
  for (const key of Object.keys(calculated)) assert.deepEqual(completion[key], calculated[key]);
  const values = field => results.map(r => r[field]).filter(Number.isFinite).sort((a, b) => a - b);
  const range = field => { const v = values(field), n = v.length;
    return n ? { min: v[0], median: n % 2 ? v[Math.floor(n / 2)] : (v[n / 2 - 1] + v[n / 2]) / 2, max: v[n - 1] } : null; };
  const report = { ...completion, valid: results.filter(r => r.accepted).length,
    noDecision: results.filter(r => !r.accepted).length, waitMs: range('waitMs'), inferenceMs: range('inferenceMs'),
    rows: results.map(r => ({ id: r.id, ...r.case, raw: r.raw, decoded: r.action,
      rawId: r.rawId, displayPosition: r.displayPosition, enumPosition: r.enumPosition,
      waitMs: r.waitMs, inferenceMs: r.inferenceMs, inputTokens: r.transport?.stats?.prompt_eval_count,
      outputTokens: r.transport?.stats?.eval_count, status: r.transport?.status,
      finishReason: r.transport?.stats?.done_reason, error: r.error || null })) };
  await writeFile(resolve(out, 'analysis.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--execute-authorized-final-32') await execute(resolve(process.argv[3]));
  else if (process.argv[2] === '--analyse-offline') await analyse(resolve(process.argv[3]));
  else throw new Error('Explicit execute or offline-analysis flag required');
}
