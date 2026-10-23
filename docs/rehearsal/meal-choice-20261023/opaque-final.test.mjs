import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CASES, packet, summarize } from './opaque-final.mjs';
import { decode } from './order-diagnostic.mjs';
import { prepare } from './fixtures.mjs';
import { makeProviders } from '../../../runner/provider.js';
import { decideMeal } from '../../../runner/meal-choice.js';
import { consequenceCallbacks, failureChecks } from './rehearse.mjs';

test('32 predeclared cases independently balance meaning, display, enum and body', () => {
  assert.equal(CASES.length, 32);
  assert.equal(new Set(CASES.map(c => c.id)).size, 32);
  for (const eatId of ['A', 'B']) for (const displayOrder of ['AB', 'BA']) {
    for (const enumOrder of ['AB', 'BA']) for (const profile of ['EMPTY', 'FULL']) {
      assert.equal(CASES.filter(c => c.eatId === eatId && c.displayOrder === displayOrder
        && c.enumOrder === enumOrder && c.profile === profile).length, 2);
    }
  }
  const features = c => [c.profile, c.eatId, c.displayOrder, c.enumOrder];
  assert.deepEqual(CASES.slice(16).map(features), CASES.slice(0, 16).map(features).reverse());
});

test('only choices keys/order and schema labels/order change; meanings and corrected prompt remain intact', () => {
  for (const c of CASES) {
    const p = packet(c), source = prepare(c).call;
    const shown = JSON.parse(p.call.prompt), original = JSON.parse(source.prompt);
    assert.equal(p.call.system, source.system);
    assert.equal(Object.hasOwn(shown, 'response'), false);
    assert.deepEqual(Object.keys(shown.choices), c.displayOrder.split(''));
    assert.deepEqual(p.call.format.properties.action.enum, c.enumOrder.split(''));
    for (const id of ['A', 'B']) assert.equal(shown.choices[id], original.choices[p.mapping[id]]);
    delete shown.choices; delete original.choices;
    assert.deepEqual(shown, original);
    const format = structuredClone(p.call.format);
    format.properties.action.enum = ['eat', 'decline'];
    assert.deepEqual(format, source.format);
    assert.deepEqual(p.options, prepare(c).opts);
  }
});

test('matched empty/full differ only in existing bodily indication; no hunger or motives invented', () => {
  for (const c of CASES.filter(c => c.profile === 'EMPTY')) {
    const a = packet(c), b = packet({ ...c, profile: 'FULL' });
    assert.equal(a.call.prompt.replace('fullness: empty.', 'fullness: full.'), b.call.prompt);
    assert.deepEqual(a.call.format, b.call.format);
    assert.deepEqual(a.options, b.options);
    assert.doesNotMatch(a.call.prompt + b.call.prompt, /hungr|diet|prefer|KSS|calibrat|normaliz|distention|synthetic|fixture/i);
  }
});

test('strict diagnostic decoder has no default and maps both opaque IDs to real actions', () => {
  for (const c of CASES) for (const id of ['A', 'B']) {
    const p = packet(c);
    assert.equal(decode(JSON.stringify({ action: id }), p.mapping), p.mapping[id]);
  }
  for (const raw of ['', 'A', '{"action":"eat"}', '{"action":"C"}', '{"action":"A","why":"x"}']) {
    assert.equal(decode(raw, { A: 'eat', B: 'decline' }), null);
  }
});

test('classification distinguishes semantic preference, raw-ID bias, display bias and enum bias', () => {
  for (const rule of ['meaning', 'id', 'display', 'enum']) {
    const r = CASES.map(c => {
      const p = packet(c), rawId = rule === 'meaning' ? c.eatId : rule === 'id' ? 'A'
        : rule === 'display' ? p.display[0] : p.enumeration[0];
      return { case: c, packet: p, rawId, accepted: true, action: p.mapping[rawId] };
    });
    const s = summarize(r);
    assert.equal(s.opportunities, 32);
    assert.equal(s.semantic.eat, rule === 'meaning' ? 32 : 16);
    assert.equal(s.opaqueId.A, rule === 'id' ? 32 : 16);
    assert.equal(s.displayPosition.first, rule === 'display' ? 32 : 16);
    assert.equal(s.enumPosition.first, rule === 'enum' ? 32 : 16);
  }
});

test('opaque adapter reaches unchanged canonical eat/decline effects, not label-dependent actions', async () => {
  for (const eatId of ['A', 'B']) for (const returned of ['A', 'B']) {
    const c = { ...CASES[0], eatId }, p = prepare(c), expected = packet(c);
    const result = { checkpoints: [], lifecycle: [] };
    const accepted = await decideMeal(p.state, p.episode, { ...consequenceCallbacks(p, result),
      characterContext: p.characterContext,
      generate: async () => JSON.stringify({ action: decode(JSON.stringify({ action: returned }), expected.mapping) }),
    });
    assert.equal(accepted, true);
    assert.equal(p.episode.decision.action, expected.mapping[returned]);
    assert.equal(result.consequence.intakeCount, 1);
    assert.equal(result.consequence.feeding[0].intakeOutcome,
      expected.mapping[returned] === 'eat' ? 'FULLY_CONSUMED' : 'REFUSED');
  }
});

test('failures still produce unknown consumption; no real networking', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail('offline failure check tried networking');
  try {
    const failures = await failureChecks();
    assert.equal(failures.length, 7);
    for (const r of failures) {
      assert.equal(r.phase, 'NO_DECISION');
      assert.equal(r.intake.intakeOutcome, 'UNKNOWN');
      assert.equal(r.intake.consumedFraction, null);
    }
  } finally { globalThis.fetch = original; }
});

test('actual provider wire bytes match retained request across independent enum/display orders (mock HTTP)', async () => {
  let received;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = Buffer.concat(chunks).toString('utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ response: '{"action":"A"}', done: true, done_reason: 'stop' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const c of CASES.slice(0, 16)) {
      const p = packet(c), provider = makeProviders({ model: p.wireBody.model,
        ollamaUrl: `http://127.0.0.1:${server.address().port}` }).ollama;
      await provider.rawGenerate({ ...p.call, opts: p.options, purpose: 'meal_choice' });
      assert.equal(received, JSON.stringify(p.wireBody));
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
