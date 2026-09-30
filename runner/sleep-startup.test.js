import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { Client } from './client.js';
import { scheduleTransitionCrossed } from './prompt.js';
import {
  markSomaThreeProcessContinuityUnknown,
  reconcileSoma,
  replaySomaObservedSleepRecords,
} from './soma.js';
import { threeProcessSleepinessSnapshot } from './three-process-sleepiness.js';
import { restoreStartupSleepHistory } from './sleep-startup.js';

const HOUR = 3600000;
const lightsOut = Date.parse('2026-01-03T22:30:00.000Z');
const records = [
  [0, 'sleep_period'], [8, 'awake'], [24, 'sleep_period'], [32, 'awake'],
].map(([hours, sleep_period], index) => ({
  event_id: `sleep-${index}`,
  occurred_at_ms: lightsOut + hours * HOUR,
  soma_input: { sleep_period, sleep_interruption: 'none' },
}));
const quietRestart = lightsOut + 33 * HOUR;

function runtime(raw = null) {
  const state = reconcileSoma(raw, { now: quietRestart });
  return {
    state,
    replayObservedSleepRecords: (history, options) => replaySomaObservedSleepRecords(state, history, options),
    markThreeProcessContinuityUnknown: (options) => markSomaThreeProcessContinuityUnknown(state, options),
  };
}

function logger() {
  const lines = { log: [], warn: [] };
  return { lines, log: (line) => lines.log.push(line), warn: (line) => lines.warn.push(line) };
}

test('available history restores LIVE state and repeated replay creates no duplicate history', async () => {
  const soma = runtime();
  const log = logger();
  const options = { soma, fetchHistory: async () => records, scheduleTransitionCrossed, now: quietRestart, log };
  const first = await restoreStartupSleepHistory(options);
  assert.deepEqual(first, { replayed: true, recordCount: 4, continuityMarkedUnknown: false });
  const before = JSON.stringify(soma.state.predictedSleepiness);
  await restoreStartupSleepHistory(options);
  assert.equal(JSON.stringify(soma.state.predictedSleepiness), before);
  assert.equal(threeProcessSleepinessSnapshot(soma.state.predictedSleepiness, quietRestart).publicLabel, 'LIVE');
});

test('timeout preserves checkpoint, current prediction and public history', async () => {
  const soma = runtime();
  await restoreStartupSleepHistory({
    soma, fetchHistory: async () => records, scheduleTransitionCrossed, now: quietRestart, log: logger(),
  });
  const checkpoint = JSON.parse(JSON.stringify(soma.state));
  const restarted = runtime(checkpoint);
  const log = logger();
  const result = await restoreStartupSleepHistory({
    soma: restarted,
    fetchHistory: async () => { throw new Error('The operation was aborted due to timeout'); },
    scheduleTransitionCrossed,
    now: quietRestart,
    log,
  });
  assert.deepEqual(result, { replayed: false, recordCount: 0, continuityMarkedUnknown: false });
  assert.deepEqual(restarted.state.predictedSleepiness, soma.state.predictedSleepiness);
  assert.equal(threeProcessSleepinessSnapshot(restarted.state.predictedSleepiness, quietRestart).publicLabel, 'LIVE');
  assert.match(log.lines.warn[0], /retained persisted LIVE state/);
});

test('timeout cannot bypass the unknown-gap guard after lights-out', async () => {
  const soma = runtime();
  await restoreStartupSleepHistory({
    soma, fetchHistory: async () => records, scheduleTransitionCrossed, now: quietRestart, log: logger(),
  });
  const processS = JSON.parse(JSON.stringify(soma.state.sleepHomeostasis));
  const processC = JSON.parse(JSON.stringify(soma.state.circadianProcessC));
  const afterNextLightsOut = lightsOut + 48.5 * HOUR;
  const result = await restoreStartupSleepHistory({
    soma,
    fetchHistory: async () => { throw new Error('timeout'); },
    scheduleTransitionCrossed,
    now: afterNextLightsOut,
    log: logger(),
  });
  assert.equal(result.continuityMarkedUnknown, true);
  assert.equal(threeProcessSleepinessSnapshot(soma.state.predictedSleepiness, afterNextLightsOut).publicLabel, 'CALIBRATING');
  assert.equal(threeProcessSleepinessSnapshot(soma.state.predictedSleepiness, afterNextLightsOut).predictedKss, null);
  assert.deepEqual(soma.state.sleepHomeostasis, processS);
  assert.deepEqual(soma.state.circadianProcessC, processC);
});

test('malformed and unexpectedly empty archives retain the valid checkpoint', async () => {
  const soma = runtime();
  await restoreStartupSleepHistory({
    soma, fetchHistory: async () => records, scheduleTransitionCrossed, now: quietRestart, log: logger(),
  });
  const before = JSON.stringify(soma.state.predictedSleepiness);
  for (const bad of [{ bad: true }, [null], [], [{ occurred_at_ms: quietRestart, soma_input: {} }]]) {
    const result = await restoreStartupSleepHistory({
      soma, fetchHistory: async () => bad, scheduleTransitionCrossed, now: quietRestart, log: logger(),
    });
    assert.equal(result.replayed, false);
    assert.equal(JSON.stringify(soma.state.predictedSleepiness), before);
  }
});

test('client rejects a malformed HTTP response instead of silently replaying zero records', async () => {
  const client = new Client({ apiBase: 'https://example.invalid', ingestKey: 'test', dryRun: false }, '.');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, records }) });
    assert.deepEqual(await client.fetchObservedSleepHistory(), records);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
    await assert.rejects(client.fetchObservedSleepHistory(), /malformed sleep history response/);
    globalThis.fetch = async () => { throw new Error('timeout'); };
    await assert.rejects(client.fetchObservedSleepHistory(), /timeout/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the private history endpoint uses indexed sleep types and projects only Soma input', async () => {
  const source = await readFile(new URL('../public/api/sleep-history.php', import.meta.url), 'utf8');
  assert.match(source, /WHERE event_type IN \('lights_on', 'lights_out', 'noise_night', 'regime_change'/);
  assert.match(source, /JSON_EXTRACT\(record, '\$\.soma_input'\) AS soma_input/);
  assert.doesNotMatch(source, /AS occurred_at_ms, record\b/);
  assert.doesNotMatch(source, /WHERE JSON_UNQUOTE\(JSON_EXTRACT\(record/);
});
