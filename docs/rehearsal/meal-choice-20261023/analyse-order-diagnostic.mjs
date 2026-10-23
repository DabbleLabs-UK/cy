// Offline-only verification of fixed counterbalanced diagnostic evidence.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MAIN, EXTRA, packet, needsOpaque, decode, sha256, summary } from './order-diagnostic.mjs';
import { parseMealChoice } from '../../../runner/meal-choice.js';
import { CASES as NO_HINT, probePacket } from './no-response-probe.mjs';

const out = resolve(process.argv[2]);
const read = async name => JSON.parse(await readFile(resolve(out, name), 'utf8'));
const manifest = await read('manifest.json'), results = await read('results.json');
const completion = await read('completion.json'), optional = await read('optional-decision.json');
const sends = (await readFile(resolve(out, 'sends.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
// Historical packets include the subsequently removed answer hint. Verify that
// this is their ONLY difference from current helper output, not a prompt repair.
function withoutAnswerHint(value) {
  const next = JSON.parse(JSON.stringify(value));
  for (const name of ['sourceCall', 'call', 'wireBody']) {
    const slot = next[name];
    if (!slot) continue;
    const prompt = JSON.parse(slot.prompt);
    if (Object.hasOwn(prompt, 'response')) {
      assert.deepEqual(prompt.response, { action: slot.format.properties.action.enum.join(' | ') });
      delete prompt.response;
      slot.prompt = JSON.stringify(prompt);
    }
  }
  return next;
}
assert.deepEqual(manifest.main.map(withoutAnswerHint), MAIN.map(packet).map(withoutAnswerHint));
assert.deepEqual(manifest.optional.map(withoutAnswerHint), EXTRA.map(packet).map(withoutAnswerHint));
assert.equal(optional.run, needsOpaque(results.slice(0, 24)));
assert.equal(completion.optionalRan, optional.run);
const cases = optional.run ? [...MAIN, ...EXTRA] : MAIN;
const capturedPackets = optional.run ? [...manifest.main, ...manifest.optional] : manifest.main;
assert.equal(results.length, cases.length);
assert.deepEqual(results.map(r => r.id), cases.map(c => c.id));
assert.ok(sends.length <= cases.length && sends.length <= 32);
assert.equal(sends.length, completion.sends);
assert.equal(new Set(sends.map(s => s.id)).size, sends.length);
assert.deepEqual(sends.map(s => s.ordinal), sends.map((_, i) => i + 1));
const rows = [];
for (let i = 0; i < results.length; i++) {
  const r = results[i], expected = capturedPackets[i], sent = sends.find(s => s.id === r.id);
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

if (process.argv[3]) {
  const probeOut = resolve(process.argv[3]);
  const probeRead = async name => JSON.parse(await readFile(resolve(probeOut, name), 'utf8'));
  const probeManifest = await probeRead('manifest.json'), probeResults = await probeRead('results.json');
  const probeCompletion = await probeRead('completion.json');
  const probeSends = (await readFile(resolve(probeOut, 'sends.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(probeManifest.requests.map(withoutAnswerHint), NO_HINT.map(probePacket).map(withoutAnswerHint));
  assert.deepEqual(probeResults.map(r => r.id), NO_HINT.map(c => c.id));
  assert.equal(probeCompletion.sends, probeSends.length);
  assert.ok(probeSends.length <= 8 && sends.length + probeSends.length <= 32);
  assert.equal(new Set([...sends, ...probeSends].map(s => s.id)).size, sends.length + probeSends.length);
  assert.deepEqual(probeSends.map(s => s.ordinal), probeSends.map((_, i) => i + 1));
  for (const r of probeResults) {
    const index = NO_HINT.findIndex(c => c.id === r.id);
    const expected = probeManifest.requests[index];
    assert.deepEqual(probePacket(NO_HINT[index]).wireBody, expected.wireBody,
      'current helper must reproduce the tested no-hint request byte-for-byte');
    assert.deepEqual(r.packet, expected);
    const sent = probeSends.find(s => s.id === r.id);
    if (sent) {
      assert.deepEqual(sent.body, expected.wireBody);
      assert.equal(sent.bodySha256, sha256(JSON.stringify(expected.wireBody)));
    }
    if (r.transport) {
      assert.equal(r.raw, r.transport.text);
      assert.equal(r.raw, r.transport.stats.response);
    }
    if (r.accepted) {
      assert.equal(parseMealChoice(r.raw), r.action);
      assert.equal(r.consequence.intakeCount, 1);
      assert.equal(r.consequence.feeding[0].intakeOutcome, r.action === 'eat' ? 'FULLY_CONSUMED' : 'REFUSED');
      assert.equal(r.checkpoints.at(-1).episodes[0].phase, 'APPLIED');
    } else assert.equal(r.action, 'NO_DECISION');
  }
  assert.deepEqual(summary(probeResults).cells, probeCompletion.cells);
  const probeReport = { ...probeCompletion,
    combinedSends: sends.length + probeSends.length,
    accepted: probeResults.filter(r => r.accepted).length,
    inferenceMs: distribution(probeResults.map(r => r.inferenceMs)),
    waitMs: distribution(probeResults.map(r => r.waitMs)),
    inputTokens: distribution(probeResults.map(r => r.transport?.stats?.prompt_eval_count)),
    rows: probeResults.map(r => ({ id: r.id, profile: r.case.profile, condition: r.case.condition,
      raw: r.raw, action: r.action, waitMs: r.waitMs, inferenceMs: r.inferenceMs,
      inputTokens: r.transport?.stats?.prompt_eval_count, outputTokens: r.transport?.stats?.eval_count,
      status: r.transport?.status, finishReason: r.transport?.stats?.done_reason, error: r.error || null })),
  };
  await writeFile(resolve(probeOut, 'analysis.json'), JSON.stringify(probeReport, null, 2) + '\n');
  console.log(JSON.stringify(probeReport, null, 2));
}
