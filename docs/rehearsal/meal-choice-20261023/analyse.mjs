// Offline evidence verification and positive consequence controls; no provider.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CASES, prepare } from './fixtures.mjs';
import { consequenceCallbacks } from './rehearse.mjs';
import { decideMeal, parseMealChoice } from '../../../runner/meal-choice.js';

const out = resolve(process.argv[2]);
const read = async (name) => JSON.parse(await readFile(join(out, name), 'utf8'));
const manifest = await read('manifest.json');
const results = await read('results.json');
const completion = await read('completion.json');
const failures = await read('failure-semantics.json');
const sends = (await readFile(join(out, 'sends.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
assert.equal(results.length, 20);
assert.ok(sends.length <= 20);
assert.equal(completion.sends, sends.length);
assert.deepEqual(results.map((r) => r.id), CASES.map((c) => c.id));
assert.equal(new Set(sends.map((r) => r.caseId)).size, sends.length);
assert.deepEqual(sends.map((r) => r.ordinal), sends.map((r, i) => i + 1));
assert.deepEqual(failures.map((r) => r.kind),
  ['malformed', 'third_action', 'no_result', 'provider_failure', 'timeout', 'cancelled', 'stale']);
for (const failure of failures) {
  assert.equal(failure.phase, 'NO_DECISION');
  assert.equal(failure.intake.intakeOutcome, 'UNKNOWN');
  assert.equal(failure.intake.consumedEnergyKcal, null);
  assert.equal(failure.intake.consumedFraction, null);
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const distribution = (values) => {
  values = values.filter(Number.isFinite);
  return values.length ? { min: Math.min(...values), median: median(values), max: Math.max(...values) } : null;
};
const rows = [];
for (let i = 0; i < results.length; i++) {
  const result = results[i], sent = sends.find((s) => s.caseId === result.id), expected = manifest.requests[i];
  if (sent) {
    assert.deepEqual(sent.call, expected.call);
    assert.deepEqual(sent.opts, expected.opts);
  }
  assert.equal(parseMealChoice(result.raw), result.parse);
  if (result.transport?.stats?.response != null) assert.equal(result.raw, result.transport.stats.response);
  if (result.accepted) {
    assert.equal(result.consequence.intakeCount, 1);
    assert.equal(result.consequence.feeding.length, 1);
    const committed = result.checkpoints.find((state) => state.episodes[0].phase === 'COMMITTED').episodes[0];
    assert.equal(result.consequence.world.world.meal_decision.decision_id, committed.decision.id);
    assert.equal(result.consequence.world.id, committed.effectEventId);
    assert.equal(result.consequence.world.world.meal_decision.action, result.action);
    assert.equal(result.checkpoints.at(-1).episodes[0].phase, 'APPLIED');
  }
  rows.push({ id: result.id, meal: result.case.meal, profile: result.case.profile,
    injury: result.case.injury, raw: result.raw, action: result.action,
    parseValid: !!result.parse, proseLeak: result.proseLeak, http: result.transport?.status || null,
    inputTokens: result.transport?.stats?.prompt_eval_count || 0, outputTokens: result.transport?.stats?.eval_count || 0,
    finishReason: result.transport?.stats?.done_reason || null, waitMs: result.waitMs,
    inferenceMs: result.inferenceMs, totalMs: result.totalMs,
    intake: result.consequence?.feeding[0]?.intakeOutcome });
}
const positives = [];
for (const action of ['eat', 'decline']) {
  const p = prepare(CASES[0]);
  const result = { checkpoints: [], lifecycle: [] };
  const callbacks = consequenceCallbacks(p, result);
  let calls = 0;
  assert.equal(await decideMeal(p.state, p.episode, {
    ...callbacks, characterContext: p.characterContext,
    generate: async () => { calls++; return JSON.stringify({ action }); },
  }), true);
  assert.equal(await decideMeal(p.state, p.episode, {
    ...callbacks, generate: () => assert.fail('duplicate offer'),
  }), false);
  assert.equal(calls, 1);
  const intake = result.consequence.feeding[0];
  assert.equal(intake.intakeOutcome, action === 'eat' ? 'FULLY_CONSUMED' : 'REFUSED');
  assert.equal(intake.consumedFraction, action === 'eat' ? 1 : 0);
  assert.equal(intake.consumedEnergyKcal, action === 'eat' ? intake.fullMealEnergyKcal : 0);
  assert.equal(p.episode.decision.action, action);
  assert.match(result.consequence.sourceContext, action === 'eat' ? /fully consumed/ : /refused/);
  positives.push({ action, injectedOffline: true, realModelCall: false, offered: calls,
    phase: p.episode.phase, authoritativeDecision: p.episode.decision,
    intake, laterContext: result.consequence.sourceContext, lifecycle: result.lifecycle });
}
const byProfile = Object.fromEntries(['SPARSE', 'EMPTY', 'FILLING', 'FULL'].map((profile) => {
  const selected = rows.filter((r) => r.profile === profile);
  return [profile, { count: selected.length,
    eat: selected.filter((r) => r.action === 'eat').length,
    decline: selected.filter((r) => r.action === 'decline').length,
    noDecision: selected.filter((r) => r.action === 'NO_DECISION').length }];
}));
assert.deepEqual(completion.counts, Object.fromEntries(['eat', 'decline', 'NO_DECISION'].map((action) =>
  [action, rows.filter((row) => row.action === action).length])));
const summary = { sends: sends.length, opportunities: results.length, counts: completion.counts, byProfile,
  parseValid: rows.filter((r) => r.parseValid).length,
  proseLeaks: rows.filter((r) => r.proseLeak).length,
  transportFailures: rows.filter((r) => r.http !== 200).length,
  returnedModels: [...new Set(results.map((r) => r.transport?.stats?.model || null))],
  inferenceMs: distribution(rows.map((r) => r.inferenceMs)),
  waitMs: distribution(rows.map((r) => r.waitMs)),
  totalMs: distribution(rows.map((r) => r.totalMs)), batchElapsedMs: completion.elapsedMs,
  totalInputTokensReported: rows.reduce((sum, r) => sum + r.inputTokens, 0),
  totalOutputTokensReported: rows.reduce((sum, r) => sum + r.outputTokens, 0),
  finishReasons: [...new Set(rows.map((r) => r.finishReason))], rows,
};
await writeFile(join(out, 'analysis.json'), JSON.stringify(summary, null, 2) + '\n');
await writeFile(join(out, 'offline-positive-controls.json'), JSON.stringify(positives, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
