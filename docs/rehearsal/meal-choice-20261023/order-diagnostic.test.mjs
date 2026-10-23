import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MAIN, EXTRA, packet, transform, decode, needsOpaque } from './order-diagnostic.mjs';
import { prepare } from './fixtures.mjs';
import { makeProviders } from '../../../runner/provider.js';
import { parseMealChoice } from '../../../runner/meal-choice.js';
import { CASES as NO_HINT, probePacket } from './no-response-probe.mjs';

test('predeclared main is a balanced 24-call two-by-two matrix with time-interleaved orders', () => {
  assert.equal(MAIN.length, 24);
  for (const condition of ['A', 'B']) for (const profile of ['EMPTY', 'FULL']) {
    assert.equal(MAIN.filter(c => c.condition === condition && c.profile === profile).length, 6);
  }
  assert.equal(new Set(MAIN.map(c => c.id)).size, 24);
  assert.ok(MAIN.every(c => c.meal === 'lunch' && !c.injury));
});

test('production arm is byte-identical; reversal changes only all three alternative presentations', () => {
  for (const c of MAIN) {
    const original = prepare(c).call, p = packet(c), parsed = JSON.parse(p.call.prompt);
    if (c.condition === 'A') assert.deepEqual(p.call, original);
    const expected = c.condition === 'A' ? ['eat', 'decline'] : ['decline', 'eat'];
    assert.deepEqual(Object.keys(parsed.choices), expected);
    assert.deepEqual(p.call.format.properties.action.enum, expected);
    if (Object.hasOwn(JSON.parse(original.prompt), 'response')) {
      assert.equal(parsed.response.action, expected.join(' | '));
    } else assert.equal(Object.hasOwn(parsed, 'response'), false);
    const restored = transform(p.call, { condition: 'A', opaque: false }).call;
    assert.deepEqual(restored, original);
    assert.equal(p.call.system, original.system);
  }
});

test('matched prompts differ only in supported empty/full bodily indication, never invented hunger', () => {
  for (const condition of ['A', 'B']) {
    const empty = packet(MAIN.find(c => c.condition === condition && c.profile === 'EMPTY'));
    const full = packet(MAIN.find(c => c.condition === condition && c.profile === 'FULL'));
    assert.equal(empty.call.prompt.replace('fullness: empty.', 'fullness: full.'), full.call.prompt);
    assert.deepEqual(empty.options, full.options);
    assert.deepEqual(empty.call.format, full.call.format);
    assert.doesNotMatch(empty.call.prompt + full.call.prompt, /hungr|KSS|calibrat|normaliz|distention/i);
  }
});

test('unchanged parser accepts eat and decline equally, and has no fallback on invalid output', () => {
  for (const action of ['eat', 'decline']) assert.equal(parseMealChoice(JSON.stringify({ action })), action);
  for (const raw of ['', 'eat', '{"action":"partial"}', '{"action":"decline","why":"test"}']) {
    assert.equal(parseMealChoice(raw), null);
    assert.equal(decode(raw, { eat: 'eat', decline: 'decline' }), null);
  }
});

test('optional opaque controls are balanced and preserve descriptions with explicit semantic translation', () => {
  assert.equal(EXTRA.length, 8);
  for (const condition of ['A', 'B']) for (const profile of ['EMPTY', 'FULL']) {
    assert.equal(EXTRA.filter(c => c.condition === condition && c.profile === profile).length, 2);
  }
  for (const c of EXTRA) {
    const p = packet(c), prompt = JSON.parse(p.call.prompt), original = JSON.parse(p.sourceCall.prompt);
    assert.deepEqual(p.labels, ['A', 'B']);
    assert.deepEqual(p.call.format.properties.action.enum, ['A', 'B']);
    for (const label of p.labels) {
      assert.equal(prompt.choices[label], original.choices[p.mapping[label]]);
      assert.equal(decode(JSON.stringify({ action: label }), p.mapping), p.mapping[label]);
    }
    assert.equal(decode('{"action":"eat"}', p.mapping), null);
  }
});

test('optional work is admitted only after 24 valid unanimous semantic choices', () => {
  const r = MAIN.map(c => ({ case: c, accepted: true, action: 'eat' }));
  assert.equal(needsOpaque(r), true);
  assert.equal(needsOpaque(r.slice(1)), false);
  assert.equal(needsOpaque(r.map((v, i) => i ? v : { ...v, accepted: false })), false);
  assert.equal(needsOpaque(r.map((v, i) => i ? v : { ...v, action: 'decline' })), false);
});

test('one correction candidate removes only the redundant response hint in eight fixed matched cases', () => {
  assert.equal(NO_HINT.length, 8);
  for (const condition of ['A', 'B']) for (const profile of ['EMPTY', 'FULL']) {
    assert.equal(NO_HINT.filter(c => c.condition === condition && c.profile === profile).length, 2);
  }
  for (const c of NO_HINT) {
    const p = probePacket(c), original = packet(c), body = JSON.parse(p.call.prompt);
    assert.equal(Object.hasOwn(body, 'response'), false);
    body.response = JSON.parse(original.call.prompt).response;
    assert.equal(JSON.stringify(body), original.call.prompt);
    assert.deepEqual(p.call.format, original.call.format);
    assert.equal(p.call.system, original.call.system);
    assert.deepEqual(p.options, original.options);
    // After the one-field runtime correction, the real helper/ordering transform
    // must produce the exact same wire request tested by the correction probe.
    if (!Object.hasOwn(JSON.parse(prepare(c).call.prompt), 'response')) {
      assert.deepEqual(p.wireBody, packet(c).wireBody);
    }
  }
});

test('real provider serializes exactly the retained wire request (mock HTTP only, no model)', async () => {
  let received;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { path: req.url, bytes: Buffer.concat(chunks).toString('utf8') };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ response: '{"action":"decline"}', done: true, done_reason: 'stop' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const c of [MAIN[0], MAIN[1], EXTRA[0], EXTRA[1]]) {
      const p = packet(c), provider = makeProviders({ model: p.wireBody.model,
        ollamaUrl: `http://127.0.0.1:${server.address().port}` }).ollama;
      await provider.rawGenerate({ ...p.call, opts: p.options, purpose: 'meal_choice' });
      assert.equal(received.path, '/api/generate');
      assert.equal(received.bytes, JSON.stringify(p.wireBody));
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
