// Offline timing sensitivity only: no provider, server or state mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tempoIdleMs } from '../../../runner/tempo.js';

const input = JSON.parse(readFileSync(new URL('./retained-timing.json', import.meta.url), 'utf8'));
const rows = input.samples.map((sample) => {
  const debtMs = sample.previousEndedAtMs === null ? 0
    : Math.max(0, tempoIdleMs(sample.previousBusyMs, input.speed)
      - Math.max(0, sample.queuedAtMs - sample.previousEndedAtMs));
  const projectedEnd = sample.queuedAtMs + debtMs;
  return { ...sample, debtMs,
    fitsPreModelCeiling: debtMs < input.transactionTimeoutMs,
    rightCensored: projectedEnd > input.endMs,
    observedMidNoiseInProjectedWait: input.observedMidNoiseMs.some((at) =>
      at >= sample.queuedAtMs && at <= projectedEnd),
  };
});
const sorted = rows.map((v) => v.debtMs).sort((a, b) => a - b);
const middle = Math.floor(sorted.length / 2);
const tea = rows.find((v) => v.purpose === 'meal_choice');
assert.equal(tea.debtMs, 2_276_794, 'retained tea throttle must reproduce exactly');
assert.equal(tea.observedMidNoiseInProjectedWait, true);
assert.equal(tea.fitsPreModelCeiling, false);
console.log(JSON.stringify({
  warning: 'Timing exposure at historical request instants, not a meal-success rate. Fixed latest debt and unchanged speed; future background work/traffic is not simulated. Observed noise flags are execution-dependent; other cancellations, stale-state changes, inference time and resource waits are omitted.',
  samples: rows.length, speed: input.speed,
  zeroDebt: rows.filter((v) => v.debtMs === 0).length,
  exceedsTransactionTimeout: rows.filter((v) => !v.fitsPreModelCeiling).length,
  medianDebtMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
  maximumDebtMs: sorted.at(-1),
  fullyObservedWaitWindows: rows.filter((v) => !v.rightCensored).length,
  fullyObservedWithoutMidNoise: rows.filter((v) => !v.rightCensored && !v.observedMidNoiseInProjectedWait).length,
  fitsCeilingAndNoObservedMidNoise: rows.filter((v) => v.fitsPreModelCeiling && !v.rightCensored && !v.observedMidNoiseInProjectedWait).length,
  tea,
}, null, 2));
