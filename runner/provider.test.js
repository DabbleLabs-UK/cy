// provider.test.js - the pure, model-independent pieces of the provider layer:
// per-call cost accounting, refusal detection, and the DeepSeek SSE -> ollama-NDJSON
// transform. Self-checking: throws (non-zero exit) on any failure. No network.
//
//   node runner/provider.test.js

import assert from 'node:assert/strict';
import { computeCost, looksLikeRefusal, deepseekToNdjsonReader } from './provider.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

const FLASH = { input_cache_miss: 0.14, input_cache_hit: 0.0028, output: 0.28 }; // USD / 1e6
const PRO = { input_cache_miss: 0.435, input_cache_hit: 0.003625, output: 0.87 };
const FX = 0.79;

// ---- 1. computeCost: reported cache split, per-million pricing, GBP via FX ----
{
  const usage = {
    prompt_tokens: 1000,
    completion_tokens: 50,
    prompt_cache_hit_tokens: 800,
    prompt_cache_miss_tokens: 200,
  };
  const c = computeCost(usage, FLASH, FX);
  // miss 200*0.14 + hit 800*0.0028 + out 50*0.28, all /1e6
  const usd = (200 * 0.14 + 800 * 0.0028 + 50 * 0.28) / 1e6;
  assert.equal(c.tokensIn, 1000);
  assert.equal(c.tokensOut, 50);
  assert.equal(c.cachedIn, 800);
  assert.equal(c.uncachedIn, 200);
  assert.ok(Math.abs(c.costUsd - usd) < 1e-12, 'usd cost from the per-million rate card');
  assert.ok(Math.abs(c.costGbp - usd * FX) < 1e-12, 'gbp = usd * fx');
  ok('computeCost prices a reported cache split at cache-hit/miss rates and converts to GBP');
}

// ---- 2. computeCost: no cache split reported -> all prompt tokens at MISS rate --
{
  const c = computeCost({ prompt_tokens: 1000, completion_tokens: 0 }, FLASH, FX);
  const usd = (1000 * 0.14) / 1e6; // never under-count: charge it all as cache-miss
  assert.equal(c.cachedIn, 0);
  assert.equal(c.uncachedIn, 1000);
  assert.ok(Math.abs(c.costUsd - usd) < 1e-12);
  ok('computeCost charges all prompt tokens at the cache-MISS rate when no split is reported');
}

// ---- 3. computeCost: the Pro rate card is a distinct, higher price -------------
{
  const usage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 1_000_000 };
  const flash = computeCost(usage, FLASH, FX);
  const pro = computeCost(usage, PRO, FX);
  assert.ok(Math.abs(flash.costUsd - (0.14 + 0.28)) < 1e-9, 'flash: 1M miss + 1M out');
  assert.ok(Math.abs(pro.costUsd - (0.435 + 0.87)) < 1e-9, 'pro: 1M miss + 1M out');
  assert.ok(pro.costUsd > flash.costUsd, 'Pro is dearer than Flash');
  ok('computeCost uses the model-specific rate row (Flash cheaper than Pro)');
}

// ---- 4. looksLikeRefusal: real refusal openers fire ----------------------------
for (const t of [
  "I'm sorry, but I can't help with that request.",
  "I cannot assist with creating that.",
  "I'm unable to provide that information.",
  "As an AI, I won't be able to do this.",
  "I must decline.",
  "  I’m not comfortable continuing this.",
]) {
  assert.equal(looksLikeRefusal(t), true, `should flag: ${t}`);
}
ok('looksLikeRefusal flags genuine refusal openers');

// ---- 5. looksLikeRefusal: ordinary prose is NOT a refusal ----------------------
for (const t of [
  'i cannot sleep in here, the strip light again.',
  "i can't feel my hands this morning.",
  'sorry is a word they never say on the wing.',
  'the sorry state of the tray, no eggs again.',
  'i sat with what that makes me worth.',
  '',
  null,
]) {
  assert.equal(looksLikeRefusal(t), false, `should NOT flag: ${t}`);
}
ok('looksLikeRefusal leaves ordinary lowercase prose alone (no false positives)');

// ---- 6. deepseekToNdjsonReader: SSE -> ollama-shaped NDJSON + final cost line ---
function readerFrom(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    async read() {
      if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
      return { done: true, value: undefined };
    },
    cancel() {},
  };
}
async function drain(reader) {
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  return buf.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
{
  // Split the SSE across arbitrary byte boundaries to prove the line buffering works.
  const sse = [
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
    'data: {"choices":[{"delta":{"content":"lo"}}',
    ']}\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":50,"prompt_cache_hit_tokens":800,"prompt_cache_miss_tokens":200}}\n',
    'data: [DONE]\n',
  ];
  const reader = deepseekToNdjsonReader(readerFrom(sse), { model: 'deepseek-v4-flash', priceRow: FLASH, fx: FX });
  const lines = await drain(reader);
  // token lines then one done line
  assert.equal(lines[0].response, 'Hel');
  assert.equal(lines[1].response, 'lo');
  const done = lines[lines.length - 1];
  assert.equal(done.done, true, 'final line is the ollama-shaped done line');
  assert.equal(done.prompt_eval_count, 1000, 'prompt_eval_count carries the prompt tokens');
  assert.equal(done.eval_count, 50, 'eval_count carries the completion tokens');
  assert.equal(done.usage.cached_tokens, 800);
  assert.equal(done.usage.uncached_tokens, 200);
  const expUsd = (200 * 0.14 + 800 * 0.0028 + 50 * 0.28) / 1e6;
  assert.ok(Math.abs(done.cost.usd - expUsd) < 1e-12, 'done line carries the computed USD cost');
  assert.ok(Math.abs(done.cost.gbp - expUsd * FX) < 1e-12, 'done line carries the computed GBP cost');
  ok('deepseekToNdjsonReader turns SSE deltas into {response} lines + a done line with usage/cost');
}

// ---- 7. deepseekToNdjsonReader: a stream that ends with no [DONE] still closes --
{
  const sse = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n']; // source just ends
  const reader = deepseekToNdjsonReader(readerFrom(sse), { model: 'deepseek-v4-flash', priceRow: FLASH, fx: FX });
  const lines = await drain(reader);
  assert.equal(lines[0].response, 'hi');
  assert.equal(lines[lines.length - 1].done, true, 'synthesises a done line even without [DONE]');
  ok('deepseekToNdjsonReader always emits a terminal done line, even if the source just ends');
}

console.log(`\nprovider.test.js: all ${n} checks passed`);
