import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { BackgroundTempoGate, clampSpeed, tempoIdleMs } from './tempo.js';
import { cadencePhrase, tempoIdleMs as publicTempoIdleMs } from '../public/assets/tempo.js';

function realisedDuty(burstMs, idleMs) {
  return (100 * burstMs) / (burstMs + idleMs);
}

for (const burstMs of [1000, 75000, 178275]) {
  for (const speed of [1, 5, 31, 50, 100]) {
    const idleMs = tempoIdleMs(burstMs, speed);
    assert.ok(Math.abs(realisedDuty(burstMs, idleMs) - speed) < 0.01,
      `${speed}% remains the realised duty for a ${burstMs}ms generation`);
    assert.equal(publicTempoIdleMs(burstMs, speed), idleMs,
      'the visitor cadence preview mirrors the runner equation');
  }
}

const recentBurstMs = 178275;
const correctedIdleMs = tempoIdleMs(recentBurstMs, 31);
assert.equal(correctedIdleMs, 396806, 'the live 31% example receives its full required idle');
assert.ok(correctedIdleMs > 11829 * 30, 'the former 11.8s cap cannot silently turn 31% into near-continuous load');
assert.equal(cadencePhrase(recentBurstMs, 31), 'about every 10 min');
assert.equal(clampSpeed(0), 1);
assert.equal(clampSpeed(101), 100);

const gate = new BackgroundTempoGate();
const gateNow = 1_000_000;
const visibleIdle = tempoIdleMs(75000, 31);
assert.equal(gate.reserveVisibleIdle(visibleIdle, gateNow), gateNow + visibleIdle);
assert.equal(gate.canStart(gateNow + visibleIdle - 1), false,
  'background inference cannot fill a visible tempo quiet period');
assert.equal(gate.canStart(gateNow + visibleIdle), true);
const backgroundStarted = gateNow + visibleIdle;
const backgroundEnded = backgroundStarted + 10000;
assert.equal(gate.recordBackgroundWork(backgroundStarted, backgroundEnded, 31),
  backgroundEnded + tempoIdleMs(10000, 31));
assert.equal(gate.canStart(backgroundEnded), false,
  'a hidden model call earns its own tempo quiet before another may start');
gate.onTempoChange(31, 50);
assert.equal(gate.canStart(backgroundEnded), true,
  'speeding up releases an obsolete slower background reservation');
gate.reserveVisibleIdle(10000, gateNow);
gate.onTempoChange(50, 31);
assert.equal(gate.canStart(gateNow), false,
  'slowing down does not let queued background work burst through existing quiet');

const runSource = await readFile(new URL('./run.js', import.meta.url), 'utf8');
assert.match(runSource, /idleSilently\(idleMs, \{ breakOnTempo: true, allowAwg: true \}\)/,
  'a tempo change interrupts a long duty-cycle wait and that wait alone offers spare AWG capacity');
assert.match(runSource, /if \(nextIdleTempoSpeed !== idleTempoSpeed\) \{[\s\S]*?tempoEpoch\+\+;/,
  'only a real speed change interrupts the current duty-cycle wait');
assert.doesNotMatch(runSource, /client\.onTempo = \(t\) => \{\s*tempoEpoch\+\+;/,
  'viewer-count-only tempo events cannot interrupt the duty-cycle wait');
assert.doesNotMatch(runSource, /Math\.min\(MAX_TEMPO_IDLE_MS/,
  'the runtime does not reintroduce an absolute cap around the exact duty idle');
assert.match(runSource, /backgroundTempoGate\.reserveVisibleIdle\(idleMs, Date\.now\(\)\)/,
  'visible tempo quiet is reserved before background inference can use it');
assert.match(runSource, /canRunBackground: \(kind\) => inferPhase === 'idle'\s*&& backgroundTempoGate\.canStart\(Date\.now\(\)\)/,
  'memory background work is gated by the tempo reservation');
assert.match(runSource, /reason: 'TEMPO_RESERVED'/,
  'ambient world work cannot consume a reserved tempo quiet period');
assert.match(runSource, /backgroundTempoGate\.recordBackgroundWork\(startedAtMs, Date\.now\(\), client\.tempo\.speed\)/,
  'each background model call earns its own tempo quiet');

console.log('tempo.test.js: all checks passed');
