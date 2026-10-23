// Rehearsal only. No production Client, main loop or persisted world state.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { prepare } from './fixtures.mjs';
import { CONFIG, consequenceCallbacks } from './rehearse.mjs';
import { decideMeal, parseMealChoice } from '../../../runner/meal-choice.js';
import { makeProviders } from '../../../runner/provider.js';
import { InferenceCoordinator } from '../../../runner/inference-coordinator.js';
import { withAbortTimeout } from '../../../runner/run.js';

const json = value => JSON.stringify(value, null, 2) + '\n';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const base = [ ['EMPTY', 'A'], ['FULL', 'B'], ['FULL', 'A'], ['EMPTY', 'B'] ];
export const MAIN = Object.freeze(Array.from({ length: 6 }, (_, round) =>
  (round % 2 ? [...base].reverse() : base).map(([profile, condition], index) => ({
    id: `order-${String(round * 4 + index + 1).padStart(2, '0')}`,
    meal: 'lunch', profile, injury: false, condition, opaque: false, round: round + 1,
  }))).flat());
export const EXTRA = Object.freeze(Array.from({ length: 2 }, (_, round) =>
  (round % 2 ? [...base].reverse() : base).map(([profile, condition], index) => ({
    id: `opaque-${String(round * 4 + index + 1).padStart(2, '0')}`,
    meal: 'lunch', profile, injury: false, condition, opaque: true, round: round + 1,
  }))).flat());

export function transform(call, c) {
  const next = clone(call), prompt = JSON.parse(call.prompt);
  const order = c.condition === 'A' ? ['eat', 'decline'] : ['decline', 'eat'];
  const labels = c.opaque ? ['A', 'B'] : order;
  const mapping = Object.fromEntries(labels.map((label, i) => [label, order[i]]));
  next.prompt = JSON.stringify({ ...prompt,
    choices: Object.fromEntries(labels.map(label => [label, prompt.choices[mapping[label]]])),
    response: { action: labels.join(' | ') },
  });
  next.format.properties.action.enum = labels;
  return { call: next, mapping, order, labels };
}

export function decode(raw, mapping) {
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || Object.keys(value).length !== 1
      || !Object.hasOwn(mapping, value.action)) return null;
    return mapping[value.action];
  } catch { return null; }
}

export function packet(c) {
  const p = prepare(c), presented = transform(p.call, c);
  if (!c.opaque && c.condition === 'A') assert.deepEqual(presented.call, p.call);
  return { case: c, supportedContext: p.characterContext, sourceCall: p.call,
    ...presented, options: p.opts,
    wireBody: { model: CONFIG.model, system: presented.call.system, prompt: presented.call.prompt,
      options: p.opts, keep_alive: -1, stream: false, format: presented.call.format },
  };
}

// Optional labels run only when BOTH orders and BOTH contexts still produce
// one unanimous semantic action. No post-hoc cell selection or replacements.
export function needsOpaque(results) {
  return results.length === 24 && results.every(r => r.accepted)
    && new Set(results.map(r => r.action)).size === 1;
}

export function summary(results) {
  const cells = {};
  for (const result of results) {
    const key = `${result.case.opaque ? 'opaque' : 'order'}/${result.case.condition}/${result.case.profile}`;
    const cell = cells[key] ||= { eat: 0, decline: 0, NO_DECISION: 0, rawLabels: {} };
    cell[result.action]++;
    if (result.rawLabel) cell.rawLabels[result.rawLabel] = (cell.rawLabels[result.rawLabel] || 0) + 1;
  }
  return { opportunities: results.length, cells };
}

export async function execute(out) {
  await mkdir(out); // Exclusive output: never resume/replace any failed case.
  const manifest = { runtimeRevision: '5087e53b5b1756b746fad16ac1eeb1251cb30983',
    createdAt: new Date().toISOString(), config: CONFIG, mainCount: 24, optionalCount: 8,
    optionalRule: 'Only if all 24 main cases are valid and unanimously choose the same semantic action.',
    maxSends: 32, retries: 0, repairs: 0, perOpportunityMs: 600000,
    main: MAIN.map(packet), optional: EXTRA.map(packet),
    limits: 'Synthetic fixed-clock in-memory meals only. No live Client, main loop, publication, production checkpoint, config writes, paid API, maintenance hold or provider fallback.',
  };
  await writeFile(resolve(out, 'manifest.json'), json(manifest));
  const provider = makeProviders(CONFIG).ollama, coordinator = new InferenceCoordinator();
  const results = [], started = Date.now();
  let sends = 0;
  async function run(c) {
    const expected = packet(c), p = prepare(c);
    const result = { id: c.id, case: c, packet: expected,
      startedAt: new Date().toISOString(), raw: null, checkpoints: [], lifecycle: [] };
    const callbacks = consequenceCallbacks(p, result), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('MEAL_CHOICE_TIMEOUT')), 600000);
    const admittedAt = Date.now();
    try {
      result.accepted = await decideMeal(p.state, p.episode, {
        ...callbacks, characterContext: p.characterContext, signal: controller.signal,
        generate: async sourceCall => {
          assert.deepEqual(sourceCall, expected.sourceCall);
          let lease = null, host = null;
          try {
            lease = await coordinator.acquire({ purpose: 'meal_choice', deferStart: true }, controller.signal);
            host = await provider.acquireSharedLease({ purpose: 'meal_choice', signal: controller.signal,
              onLost: () => controller.abort(new Error('LEASE_LOSS')), preemptible: false });
            const opts = provider.applySharedProfile(p.opts, host);
            assert.deepEqual(opts, expected.options);
            assert.ok(!controller.signal.aborted);
            lease.begin();
            result.waitMs = Date.now() - admittedAt;
            assert.ok(sends < 32);
            await appendFile(resolve(out, 'sends.jsonl'), JSON.stringify({ ordinal: ++sends,
              id: c.id, at: new Date().toISOString(), body: expected.wireBody,
              bodySha256: sha256(JSON.stringify(expected.wireBody)) }) + '\n');
            const inferenceAt = Date.now();
            const generated = await withAbortTimeout(controller, 600000, () => provider.rawGenerate({
              ...expected.call, opts, purpose: 'meal_choice', signal: controller.signal,
            }));
            result.inferenceMs = Date.now() - inferenceAt;
            result.transport = generated;
            result.raw = generated.text;
            if (!generated.ok || controller.signal.aborted) return '';
            result.decoded = decode(result.raw, expected.mapping);
            try { result.rawLabel = JSON.parse(result.raw)?.action; } catch { /* invalid */ }
            // Identity mapping for main cells; explicit label translation only
            // for the optional diagnostic, then unchanged production parser.
            return result.decoded ? JSON.stringify({ action: result.decoded }) : '';
          } catch (error) {
            result.error = String(error?.message || error);
            return '';
          } finally {
            lease?.finish();
            await host?.release({ timeoutMs: 5000 });
          }
        },
      });
    } finally { clearTimeout(timer); }
    result.action = result.accepted ? p.episode.decision.action : 'NO_DECISION';
    if (!c.opaque && result.accepted) assert.equal(parseMealChoice(result.raw), result.action);
    result.totalMs = Date.now() - admittedAt;
    result.endedAt = new Date().toISOString();
    results.push(result);
    await writeFile(resolve(out, 'results.json'), json(results));
    console.log(JSON.stringify({ id: c.id, profile: c.profile, condition: c.condition,
      opaque: c.opaque, raw: result.raw, action: result.action,
      waitMs: result.waitMs, inferenceMs: result.inferenceMs, error: result.error || null }));
  }
  for (const c of MAIN) await run(c);
  const optional = needsOpaque(results);
  await writeFile(resolve(out, 'optional-decision.json'), json({ run: optional,
    reason: optional ? manifest.optionalRule : 'Main matrix was not unanimously valid with one semantic action.' }));
  if (optional) for (const c of EXTRA) await run(c);
  const report = { ...summary(results), sends, optionalRan: optional,
    startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started, retries: 0, repairs: 0 };
  assert.equal(results.length, optional ? 32 : 24);
  assert.ok(sends <= results.length);
  await writeFile(resolve(out, 'completion.json'), json(report));
  console.log(json(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== '--execute-authorized-order-diagnostic') throw new Error('Explicit diagnostic authorization required');
  await execute(resolve(process.argv[3]));
}
