import assert from 'node:assert/strict';
import test from 'node:test';

import { InferenceCoordinator } from './inference-coordinator.js';

test('serializes requests and keeps telemetry busy until the owner finishes', async () => {
  const phases = [];
  const events = [];
  let now = 1000;
  const coordinator = new InferenceCoordinator({
    now: () => now,
    onPhase: (phase) => phases.push(phase),
    onEvent: (event) => events.push(event),
  });
  const first = await coordinator.acquire({ purpose: 'journal', phase: 'eval' });
  let secondGranted = false;
  const secondPromise = coordinator.acquire({ purpose: 'memory', background: true, phase: 'gen' })
    .then((lease) => { secondGranted = true; return lease; });
  await Promise.resolve();
  assert.equal(secondGranted, false);
  first.setPhase('gen');
  now = 1500;
  first.finish({ result: 'emitted' });
  const second = await secondPromise;
  assert.equal(secondGranted, true);
  assert.deepEqual(phases, ['eval', 'gen']);
  now = 1700;
  second.finish({ result: 'rejected' });
  assert.equal(phases.at(-1), 'idle');
  assert.equal(events.filter((event) => event.event === 'start').length, 2);
  assert.equal(events.filter((event) => event.event === 'end').length, 2);
});

test('foreground overtakes queued background work', async () => {
  const coordinator = new InferenceCoordinator();
  const owner = await coordinator.acquire({ purpose: 'owner' });
  const order = [];
  const backgroundPromise = coordinator.acquire({ purpose: 'ambient_world_generation', background: true })
    .then((lease) => { order.push('awg'); return lease; });
  const foregroundPromise = coordinator.acquire({ purpose: 'postcard', background: false })
    .then((lease) => { order.push('postcard'); return lease; });
  owner.finish();
  const foreground = await foregroundPromise;
  assert.deepEqual(order, ['postcard']);
  foreground.finish();
  const background = await backgroundPromise;
  assert.deepEqual(order, ['postcard', 'awg']);
  background.finish();
});

test('an aborted queued request never reaches the provider slot', async () => {
  const coordinator = new InferenceCoordinator();
  const owner = await coordinator.acquire({ purpose: 'journal' });
  const controller = new AbortController();
  const queued = coordinator.acquire({ purpose: 'memory', background: true }, controller.signal);
  controller.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  owner.finish();
  assert.equal(coordinator.owner, null);
  assert.equal(coordinator.queue.length, 0);
});

test('a deferred owner remains idle until provider work actually begins', async () => {
  const phases = [];
  const events = [];
  let now = 1000;
  const coordinator = new InferenceCoordinator({
    now: () => now,
    onPhase: (phase) => phases.push(phase),
    onEvent: (event) => events.push(event),
  });
  const background = await coordinator.acquire({ purpose: 'memory', phase: 'gen' });
  now = 1010;
  const foregroundPromise = coordinator.acquire({
    purpose: 'journal', phase: 'eval', deferStart: true,
  });
  now = 1100;
  background.finish({ result: 'nonempty' });
  const foreground = await foregroundPromise;
  assert.equal(phases.at(-1), 'idle');
  assert.equal(events.filter((event) => event.event === 'start').length, 1);
  now = 1500;
  assert.equal(foreground.begin(), 1500);
  assert.equal(phases.at(-1), 'eval');
  const start = events.find((event) => event.event === 'start' && event.purpose === 'journal');
  assert.equal(start.queue_ms, 90);
  assert.equal(start.pacing_ms, 400);
  now = 1700;
  foreground.finish({ result: 'emitted' });
  const end = events.find((event) => event.event === 'end' && event.purpose === 'journal');
  assert.equal(end.duration_ms, 200);
  assert.equal(phases.at(-1), 'idle');
});

test('abort reason survives into inference end telemetry', async () => {
  const events = [];
  const coordinator = new InferenceCoordinator({ onEvent: (event) => events.push(event) });
  const lease = await coordinator.acquire({ purpose: 'ambient_world_generation', background: true });
  lease.finish({ result: 'aborted', abort_reason: 'POSTCARD' });
  const end = events.find((event) => event.event === 'end');
  assert.equal(end.result, 'aborted');
  assert.equal(end.abort_reason, 'POSTCARD');
});
