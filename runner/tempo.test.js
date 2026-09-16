import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BackgroundTempoGate,
  InferenceTempoPacer,
  clampSpeed,
  remainingTempoIdleMs,
  tempoIdleMs,
} from './tempo.js';
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
assert.equal(remainingTempoIdleMs(60000, 30, 45000), 95000,
  'a chosen 45s silence counts toward, but cannot erase, the 30% tempo rest');
assert.equal(remainingTempoIdleMs(10000, 50, 15000), 0,
  'quiet already longer than the required rest needs no additional wait');
const requestPacer = new InferenceTempoPacer();
requestPacer.record(1000, 61000);
assert.equal(requestPacer.remaining(61000, 30), 140000,
  'a completed one-minute request requires its own 30% duty-cycle quiet');
assert.equal(requestPacer.remaining(106000, 30), 95000,
  'elapsed quiet is deducted rather than charged twice');
assert.equal(requestPacer.remaining(61000, 100), 0,
  'full tempo leaves no deliberate inter-request quiet');

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
assert.match(runSource, /canRunBackground: \(kind\) => inferPhase === 'idle'[\s\S]*?inferenceTempoPacer\.remaining\(Date\.now\(\), client\.tempo\.speed\) <= 0[\s\S]*?backgroundTempoGate\.canStart\(Date\.now\(\)\)/,
  'memory background work respects per-request pacing and the tempo reservation');
assert.match(runSource, /reason: 'TEMPO_RESERVED'/,
  'ambient world work cannot consume a reserved tempo quiet period');
assert.match(runSource, /backgroundTempoGate\.recordBackgroundWork\(startedAtMs, endedAtMs, client\.tempo\.speed\)/,
  'each background model call earns its own tempo quiet');
assert.match(runSource, /const cycleInferenceStart = Date\.now\(\);[\s\S]*?chooseExpressiveAction\(/,
  'the visible burst timer starts before model-mediated action selection');
assert.match(runSource, /const burstStart = cycleInferenceStart;/,
  'action-selection inference is included in the measured visible burst');
assert.match(runSource, /waitForInferenceTempo\(ac\.signal, purpose \|\| mode\)[\s\S]*?inferenceCoordinator\.acquire/,
  'streaming requests pay inter-request tempo before taking the provider slot');
assert.match(runSource, /if \(!background\) await waitForInferenceTempo\(ac\.signal, purpose\)[\s\S]*?inferenceCoordinator\.acquire/,
  'foreground non-streaming requests pay inter-request tempo before taking the provider slot');
assert.match(runSource, /const tempoIdle = completedAttempt\s*\? inferenceTempoPacer\.remaining/,
  'the cycle tail charges only the final request remainder, not the whole multi-call wall time');
assert.match(runSource, /if \(hasDrawRequest\)[\s\S]*?paceCompletedInferenceCycle\(cycleInferenceStart, \{ reason: 'drawing-tempo' \}\)/,
  'an explicit drawing request earns tempo quiet after all of its model calls');
assert.match(runSource, /if \(selectedAction === 'draw'\)[\s\S]*?paceCompletedInferenceCycle\(cycleInferenceStart, \{ reason: 'drawing-tempo' \}\)/,
  'a model-selected drawing earns tempo quiet instead of immediately starting another cycle');
assert.match(runSource, /async function streamGenerate[\s\S]*?autobiographicalMemory\.interruptBackground\('foreground'\)[\s\S]*?inferenceCoordinator\.acquire[\s\S]*?provider\.openStream/,
  'foreground prose preempts hidden memory work and owns the coordinator before opening a stream');
assert.match(runSource, /async function rawGenerate[\s\S]*?inferenceCoordinator\.acquire[\s\S]*?provider\.rawGenerate/,
  'non-streaming production inference owns the coordinator before reaching the provider');
assert.match(runSource, /let attempted = false;[\s\S]*?attempted = true;[\s\S]*?streamGenerate\(/,
  'the runner records whether the prose provider was actually invoked');
assert.match(runSource, /const completedAttempt = attempted && !interruptAbort;/,
  'only a real inbound interrupt bypasses post-attempt pacing');
assert.match(runSource, /const tempoIdle = completedAttempt\s*\? inferenceTempoPacer\.remaining\(Date\.now\(\), client\.tempo\.speed\) : 0;/,
  'rejected, repeated, empty, and failed completed attempts retain the final request tempo quiet');
assert.match(runSource, /const failureBackoff = nonEmittingFailure && nonEmittingStreak > 0[\s\S]*?BACKOFF_BASE_MS/s,
  'all providers receive bounded backoff after a genuine non-emitting failure');
assert.match(runSource, /if \(completedAttempt && idleMs > 0\) \{[\s\S]*?await idleSilently\(idleMs, \{ breakOnTempo: true, allowAwg: true \}\);/,
  'completed local attempts are paced before another model call can begin');
assert.doesNotMatch(runSource, /const metered = !activeProvider\(\)\.local;/,
  'local Ollama failures are no longer exempt from failure pacing');

console.log('tempo.test.js: all checks passed');
