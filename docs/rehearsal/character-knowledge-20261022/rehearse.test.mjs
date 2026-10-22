import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cases } from './cases.mjs';
import { prepare, publicProjection, execute } from './rehearse.mjs';
import { validatePostcardCandidate } from '../../../runner/postcard-inference.js';

test('fixed synthetic packet keeps actual postcard limits and leaves known gaps unfilled', () => {
  assert.equal(cases.length, 16);
  assert.equal(new Set(cases.map(c => c.id)).size, 16);
  for (const c of cases) {
    const p = prepare(c);
    assert.equal(p.inbound.ok, true);
    assert.equal(p.opts.num_predict, 64);
    assert.equal(p.opts.temperature, 0.72);
    assert.equal(p.opts.top_p, 0.86);
    assert.ok(p.prompt.includes(`Current location: ${c.location}.`));
    assert.doesNotMatch(p.system, /digital prison/);
    assert.ok(p.system.includes('Unknown unless independently established'));
  }
  assert.deepEqual(prepare(cases[14]).controlInbound, { ok: false, reason: 'injection' });
  assert.match(prepare(cases[7]).prompt, /a picture: a blue kite in a clear sky/);
  assert.match(prepare(cases[13]).prompt, /Prior subjective writing, possibly mistaken or outdated/);
});

test('output projection retains Cy prose; raw validation rejects editorial text before projection', () => {
  assert.equal(publicProjection('im cy. still here.').text, 'im cy. still here.');
  assert.equal(validatePostcardCandidate('36 words left (and this will end here)').ok, false);
});

test('retained real batch used the exact fixed prompt/options and exposes all raw outputs', async () => {
  const read = async file => JSON.parse(await readFile(new URL(`./baseline-18ce5d8/${file}`, import.meta.url), 'utf8'));
  const manifest = await read('manifest.json');
  const evidence = await read('provider-evidence.json');
  const rows = await read('results.json');
  assert.equal(evidence.length, 16);
  assert.deepEqual(manifest.requests, cases.map(prepare));
  for (let i = 0; i < cases.length; i++) {
    const request = evidence[i].request;
    assert.equal(evidence[i].caseId, cases[i].id);
    assert.equal(request.messages[0].content, manifest.requests[i].system);
    assert.equal(request.messages[1].content, manifest.requests[i].prompt);
    assert.equal(request.temperature, manifest.requests[i].opts.temperature);
    assert.equal(request.top_p, manifest.requests[i].opts.top_p);
    assert.equal(request.max_tokens, manifest.requests[i].opts.num_predict);
    assert.deepEqual(request.stop, manifest.requests[i].opts.stop.slice(0, 4));
    assert.equal(rows[i].attempts.length, 1);
    const raw = evidence[i].rawStream.split('\n').filter(line => line.startsWith('data: {'))
      .map(line => JSON.parse(line.slice(6))).map(part => part.choices?.[0]?.delta?.content || '').join('');
    assert.equal(raw, rows[i].attempts[0].candidate);
    assert.equal(raw.trim(), rows[i].accepted);
  }
});

test('complete offline mock exercises stream, one repair, local ledger and all 16 cases without paid calls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cy-knowledge-mock-'));
  const original = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const request = JSON.parse(init.body);
    assert.equal(request.stream, true);
    const text = sends++ === 0 ? '36 words left (and this will end here)'
      : 'im cy 7734 at hmp thinkpad. your card got here.';
    return new Response([
      `data: ${JSON.stringify({ model: 'synthetic-mock', choices: [{ delta: { content: text }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ model: 'synthetic-mock', choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2000, completion_tokens: 17 } })}`,
      'data: [DONE]', '',
    ].join('\n'), { status: 200 });
  };
  try {
    const out = join(dir, 'mock');
    await execute(out, { readKey: () => 'synthetic-key-not-real' });
    assert.equal(sends, 17, 'one invalid initial gets one normal repair, never a new case');
    const completion = JSON.parse(await readFile(join(out, 'completion.json')));
    assert.equal(completion.cases, 16);
    const rows = JSON.parse(await readFile(join(out, 'results.json')));
    assert.equal(rows[0].attempts.length, 2);
    assert.ok(rows.every(r => r.accepted));
    const evidence = await readFile(join(out, 'provider-evidence.json'), 'utf8');
    assert.doesNotMatch(evidence, /synthetic-key-not-real|Authorization/);
    assert.ok(JSON.parse(evidence).every(r => typeof r.rawStream === 'string'));
    const ledger = JSON.parse(await readFile(join(out, 'ledger.json')));
    assert.equal(ledger.filter(r => r.action === 'reserve').length, 17);
    assert.equal(ledger.filter(r => r.action === 'settle').length, 17);
    assert.equal(ledger.filter(r => r.action === 'outcome').length, 16);
  } finally { globalThis.fetch = original; await rm(dir, { recursive: true, force: true }); }
});
