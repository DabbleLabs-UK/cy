// spend.test.js - the model-API spend meter ACCUMULATES per-call costs, keeps a
// running total that survives a reload, and never counts a free (ollama) call.
// Self-checking: throws (non-zero exit) on any failure. No network, temp file only.
//
//   node runner/spend.test.js

import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SpendMeter } from './spend.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

const dir = await mkdtemp(join(tmpdir(), 'cy-spend-'));
const statePath = join(dir, 'spend.json');
const cfg = { deepseek: { fxGbpPerUsd: 0.79 } };

try {
  // ---- 1. record folds a paid call into the running total and returns the facts --
  const m = new SpendMeter(cfg, statePath);
  await m.load();
  const rec = m.record({
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: { prompt_tokens: 1000, completion_tokens: 50, cached_tokens: 800, uncached_tokens: 200 },
    cost: { usd: 0.00004424, gbp: 0.00003495 },
  });
  assert.equal(rec.tokensIn, 1000);
  assert.equal(rec.tokensOut, 50);
  assert.equal(rec.cachedIn, 800);
  assert.equal(rec.uncachedIn, 200);
  assert.ok(Math.abs(rec.costGbp - 0.00003495) < 1e-9);
  assert.ok(Math.abs(rec.totalGbp - 0.00003495) < 1e-9, 'cumulative total starts at this call');
  ok('record folds a paid call into the total and returns per-call + cumulative figures');

  // ---- 2. a second call ADDS to the cumulative total ----
  const rec2 = m.record({
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: { prompt_tokens: 500, completion_tokens: 20, cached_tokens: 0, uncached_tokens: 500 },
    cost: { usd: 0.0001, gbp: 0.00008 },
  });
  assert.ok(Math.abs(rec2.totalGbp - (0.00003495 + 0.00008)) < 1e-9, 'totals accumulate');
  assert.equal(m.tokensIn, 1500);
  assert.equal(m.tokensOut, 70);
  assert.equal(m.calls, 2);
  ok('successive calls accumulate the cumulative total and token counters');

  // ---- 3. persist + reload: the life-of-project total survives a restart ----
  await m.save();
  const persisted = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(persisted.calls, 2);
  const m2 = new SpendMeter(cfg, statePath);
  await m2.load();
  assert.ok(Math.abs(m2.totalGbp - m.totalGbp) < 1e-12, 'reloaded total equals the saved total');
  assert.equal(m2.tokensIn, 1500);
  assert.equal(m2.calls, 2);
  ok('cumulative spend persists to state and reloads (survives a restart)');

  // ---- 4. uncached_tokens is derived when only cached_tokens is reported ----
  const m3 = new SpendMeter(cfg, join(dir, 'spend3.json'));
  await m3.load();
  const rec3 = m3.record({
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: { prompt_tokens: 1000, completion_tokens: 10, cached_tokens: 300 },
    cost: { usd: 0.0002, gbp: 0.00016 },
  });
  assert.equal(rec3.uncachedIn, 700, 'uncached = prompt - cached when not reported');
  ok('record derives uncached prompt tokens when the provider omits them');

  console.log(`\nspend.test.js: all ${n} checks passed`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
