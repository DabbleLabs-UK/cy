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

  // ---- 5. non-emitting (wasted) spend is tracked as its own subset of the total ----
  const m4 = new SpendMeter(cfg, join(dir, 'spend4.json'));
  await m4.load();
  // a productive call (default): moves the grand total, NOT the non-emit series
  const p = m4.record({
    provider: 'deepseek', model: 'deepseek-v4-flash',
    usage: { prompt_tokens: 1000, completion_tokens: 40, cached_tokens: 0, uncached_tokens: 1000 },
    cost: { usd: 0.001, gbp: 0.0008 },
  });
  assert.equal(p.productive, true, 'defaults to productive');
  assert.equal(p.nonEmitCalls, 0, 'a productive call does not touch the non-emit series');
  assert.ok(Math.abs(p.nonEmitGbp) < 1e-12, 'non-emit total still zero after a productive call');
  // a non-emitting call: paid full price, produced nothing -> counted in BOTH series
  const w = m4.record({
    provider: 'deepseek', model: 'deepseek-v4-flash',
    usage: { prompt_tokens: 1500, completion_tokens: 5, cached_tokens: 0, uncached_tokens: 1500 },
    cost: { usd: 0.0009, gbp: 0.0007 },
    productive: false,
  });
  assert.equal(w.productive, false);
  assert.equal(w.nonEmitCalls, 1, 'the wasted call increments the non-emit call count');
  assert.ok(Math.abs(w.nonEmitGbp - 0.0007) < 1e-12, 'non-emit total captures exactly the wasted cost');
  assert.ok(Math.abs(w.totalGbp - (0.0008 + 0.0007)) < 1e-12, 'the grand total still includes both calls');
  assert.equal(m4.calls, 2, 'both calls counted in the grand call total');
  // persist + reload: the non-emit series survives a restart too
  await m4.save();
  const snap = m4.snapshot();
  assert.ok(Math.abs(snap.nonemit_gbp - 0.0007) < 1e-12, 'snapshot exposes the non-emit total');
  assert.equal(snap.nonemit_calls, 1);
  const m5 = new SpendMeter(cfg, join(dir, 'spend4.json'));
  await m5.load();
  assert.ok(Math.abs(m5.nonEmitGbp - 0.0007) < 1e-12, 'reloaded non-emit total equals the saved one');
  assert.equal(m5.nonEmitCalls, 1);
  assert.equal(m5.nonEmitTokensIn, 1500);
  ok('non-emitting spend is tracked, snapshotted and persisted as its own subset of the total');

  console.log(`\nspend.test.js: all ${n} checks passed`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
