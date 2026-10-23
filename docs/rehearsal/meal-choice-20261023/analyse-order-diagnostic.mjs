// Offline-only verification of fixed counterbalanced diagnostic evidence.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MAIN, EXTRA, packet, needsOpaque, decode, sha256, summary } from './order-diagnostic.mjs';
import { parseMealChoice } from '../../../runner/meal-choice.js';

const out = resolve(process.argv[2]);
const read = async name => JSON.parse(await readFile(resolve(out, name), 'utf8'));
const manifest = await read('manifest.json'), results = await read('results.json');
const completion = await read('completion.json'), optional = await read('optional-decision.json');
const sends = (await readFile(resolve(out, 'sends.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
assert.deepEqual(manifest.main, MAIN.map(packet));
assert.deepEqual(manifest.optional, EXTRA.map(packet));
assert.equal(optional.run, needsOpaque(results.slice(0, 24)));
assert.equal(completion.optionalRan, optional.run);
const cases = optional.run ? [...MAIN, ...EXTRA] : MAIN;
assert.equal(results.length, cases.length);
assert.deepEqual(results.map(r => r.id), cases.map(c => c.id));
assert.ok(sends.length <= cases.length && sends.length <= 32);
assert.equal(sends.length, completion.sends);
assert.equal(new Set(sends.map(s => s.id)).size, sends.length);
assert.deepEqual(sends.map(s => s.ordinal), sends.map((_, i) => i + 1));
const rows = [];
for (let i = 0; i < results.length; i++) {
  const r = results[i], expected = packet(cases[i]), sent = sends.find(s => s.id === r.id);
  assert.deepEqual(r.packet, expected);
  if (sent) {
    assert.deepEqual(sent.body, expected.wireBody);
    assert.equal(sent.bodySha256, sha256(JSON.stringify(expected.wireBody)));
  }
  if (r.transport) {
    assert.equal(r.raw, r.transport.text);
    if (r.transport.stats?.response != null) assert.equal(r.raw, r.transport.stats.response);
  }
  const semantic = decode(r.raw, expected.mapping);
  if (r.accepted) {
    assert.equal(r.action, semantic);
    assert.equal(parseMealChoice(JSON.stringify({ action: semantic })), semantic);
    if (!cases[i].opaque) assert.equal(parseMealChoice(r.raw), semantic);
    assert.equal(r.consequence.intakeCount, 1);
    assert.equal(r.consequence.feeding[0].intakeOutcome, semantic === 'eat' ? 'FULLY_CONSUMED' : 'REFUSED');
    assert.equal(r.checkpoints.at(-1).episodes[0].phase, 'APPLIED');
  } else assert.equal(r.action, 'NO_DECISION');
  rows.push({ id: r.id, profile: r.case.profile, condition: r.case.condition,
    opaque: r.case.opaque, mapping: expected.mapping, raw: r.raw, action: r.action,
    accepted: r.accepted, waitMs: r.waitMs, inferenceMs: r.inferenceMs, totalMs: r.totalMs,
    inputTokens: r.transport?.stats?.prompt_eval_count,
    outputTokens: r.transport?.stats?.eval_count,
    finishReason: r.transport?.stats?.done_reason,
    status: r.transport?.status, error: r.error || null });
}
assert.deepEqual(summary(results).cells, completion.cells);
const distribution = values => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b), n = v.length;
  return n ? { min: v[0], median: n % 2 ? v[Math.floor(n / 2)] : (v[n / 2 - 1] + v[n / 2]) / 2,
    max: v[n - 1] } : null;
};
const report = { ...completion,
  validity: { accepted: rows.filter(r => r.accepted).length,
    noDecision: rows.filter(r => !r.accepted).length,
    allReturnedModels: [...new Set(results.map(r => r.transport?.stats?.model || null))],
    httpFailures: rows.filter(r => r.status !== 200).length },
  waitMs: distribution(rows.map(r => r.waitMs)),
  inferenceMs: distribution(rows.map(r => r.inferenceMs)),
  inputTokens: distribution(rows.map(r => r.inputTokens)),
  outputTokens: distribution(rows.map(r => r.outputTokens)), rows,
};
await writeFile(resolve(out, 'analysis.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
