import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { Client } from './client.js';
import { cancellationReason } from './inference-cancellation.js';
import {
  effectiveAsleepForRegime,
  loadInitialRegime,
  requireInferenceEligibility,
  runDreamIfEligible,
} from './dream-regime.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('persisted Force Day is loaded before the first sleep decision without applying other controls early', async () => {
  const originalFetch = globalThis.fetch;
  const client = new Client({ dryRun: false, apiBase: 'https://example.invalid', ingestKey: 'test' }, 'unused');
  let callbackCount = 0;
  client.onRegimeChange = () => { callbackCount++; };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ regime: 'day', provider: 'deepseek', paused: true, speed: 30 }),
  });
  try {
    assert.equal(client.regimeLoaded, false);
    assert.equal(await loadInitialRegime(client), 'day');
    assert.equal(client.regimeLoaded, true);
    assert.equal(client.provider, 'ollama');
    assert.equal(client.paused, false);
    assert.equal(callbackCount, 0);
    assert.equal(effectiveAsleepForRegime(client.regime, 23 * 60), false);
    const restarted = new Client({ dryRun: false, apiBase: 'https://example.invalid', ingestKey: 'test' }, 'unused');
    assert.equal(await loadInitialRegime(restarted), 'day');
    assert.equal(effectiveAsleepForRegime(restarted.regime, 23 * 60), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('startup waits for a valid persisted regime after transport or malformed response failures', async () => {
  const originalFetch = globalThis.fetch;
  const client = new Client({ dryRun: false, apiBase: 'https://example.invalid', ingestKey: 'test' }, 'unused');
  let calls = 0;
  let waits = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new Error('temporarily unavailable');
    if (calls === 2) return { ok: true, json: async () => ({ regime: 'invalid' }) };
    return { ok: true, json: async () => ({ regime: 'night' }) };
  };
  try {
    assert.equal(await loadInitialRegime(client, {
      wait: async () => { waits++; assert.equal(client.regimeLoaded, false); },
      log: { warn() {} },
    }), 'night');
    assert.equal(calls, 3);
    assert.equal(waits, 2);
    assert.equal(effectiveAsleepForRegime(client.regime, 12 * 60), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dry-run startup retains its auto default when no optional tempo file exists', async () => {
  const client = new Client({ dryRun: true }, 'missing-dry-run-tempo-dir');
  assert.equal(await loadInitialRegime(client), 'auto');
  assert.equal(effectiveAsleepForRegime(client.regime, 23 * 60), true);
});

test('Force Day arriving during dream setup prevents any model request', async () => {
  let regime = 'auto';
  let requests = 0;
  const isEligible = () => effectiveAsleepForRegime(regime, 23 * 60);
  regime = 'day';
  const published = await runDreamIfEligible({
    isEligible,
    generate: async () => { requests++; return 'dream'; },
    publish: async () => true,
  });
  assert.equal(published, false);
  assert.equal(requests, 0);
});

test('Force Day during shared-model wait prevents inference from starting', async () => {
  let regime = 'auto';
  let modelStarts = 0;
  const waiting = deferred();
  const enteredWait = deferred();
  const controller = new AbortController();
  const isEligible = () => effectiveAsleepForRegime(regime, 23 * 60);
  const attempt = runDreamIfEligible({
    isEligible,
    generate: async (eligible) => {
      enteredWait.resolve();
      await waiting.promise;
      try {
        requireInferenceEligibility(eligible, controller);
        modelStarts++;
      } catch (error) {
        assert.equal(error.code, 'DREAM_WAKE');
      }
      return 'discarded';
    },
    publish: async () => { throw new Error('stale dream published'); },
  });
  await enteredWait.promise;
  regime = 'day';
  waiting.resolve();
  assert.equal(await attempt, false);
  assert.equal(modelStarts, 0);
  assert.equal(cancellationReason(controller.signal), 'DREAM_WAKE');
});

test('Force Day during inference discards a completed stale dream result', async () => {
  let regime = 'auto';
  let publications = 0;
  const generating = deferred();
  const enteredModel = deferred();
  const isEligible = () => effectiveAsleepForRegime(regime, 23 * 60);
  const attempt = runDreamIfEligible({
    isEligible,
    generate: async () => { enteredModel.resolve(); await generating.promise; return 'stale dream'; },
    publish: async () => { publications++; return true; },
  });
  await enteredModel.promise;
  regime = 'day';
  generating.resolve();
  assert.equal(await attempt, false);
  assert.equal(publications, 0);
});

test('last publication guard discards a wake during asynchronous dream screening', async () => {
  let regime = 'auto';
  const screening = deferred();
  const enteredScreen = deferred();
  const emitted = [];
  const isEligible = () => effectiveAsleepForRegime(regime, 23 * 60);
  const attempt = runDreamIfEligible({
    isEligible,
    generate: async () => 'valid dream',
    publish: async (result, eligible) => {
      enteredScreen.resolve();
      await screening.promise;
      if (!eligible()) return false;
      emitted.push(result);
      return true;
    },
  });
  await enteredScreen.promise;
  regime = 'day';
  screening.resolve();
  assert.equal(await attempt, false);
  assert.deepEqual(emitted, []);
});

test('normal auto night dream and Force Night still publish; daytime journal remains eligible', async () => {
  let published = 0;
  for (const regime of ['auto', 'night']) {
    const allowed = await runDreamIfEligible({
      isEligible: () => effectiveAsleepForRegime(regime, 23 * 60),
      generate: async () => 'dream',
      publish: async () => { published++; return true; },
    });
    assert.equal(allowed, true);
  }
  assert.equal(published, 2);
  assert.equal(effectiveAsleepForRegime('auto', 12 * 60), false);
  assert.equal(effectiveAsleepForRegime('day', 23 * 60), false);
});

test('runner wires startup loading before location/sleep reconciliation and guards both dream paths', async () => {
  const source = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('await loadInitialRegime(client)') < source.indexOf('vitals.locationRegime = reconcileLocationRegimeState'));
  assert.equal((source.match(/await runDreamIfEligible\(/g) || []).length, 2);
  assert.equal((source.match(/isEligible: dreamStillAllowed/g) || []).length, 2);
  assert.match(source, /if \(detail\.isEligible && !detail\.isEligible\(\)\) return false;/);
  assert.match(source, /requireInferenceEligibility\(isEligible, ac\);/);
});
