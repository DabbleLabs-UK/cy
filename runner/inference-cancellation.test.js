import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GenerationCancellationRegistry,
  abortWithReason,
  cancellationReason,
} from './inference-cancellation.js';

test('wing noise interrupts visible journal prose but leaves AWG running', () => {
  const registry = new GenerationCancellationRegistry();
  const journal = new AbortController();
  const awg = new AbortController();
  registry.register('visible', journal, { purpose: 'journal' });
  registry.register('awg', awg, { purpose: 'ambient_world_generation' });

  assert.equal(registry.abort('visible', 'WING_NOISE_MID'), true);
  assert.equal(journal.signal.aborted, true);
  assert.equal(cancellationReason(journal.signal), 'WING_NOISE_MID');
  assert.equal(awg.signal.aborted, false);
});

test('interactive and operator causes still preempt admitted AWG', () => {
  for (const reason of ['POSTCARD', 'WARDEN', 'PAUSE', 'SHUTDOWN', 'PROVIDER_CHANGE']) {
    const registry = new GenerationCancellationRegistry();
    const awg = new AbortController();
    registry.register('awg', awg, { purpose: 'ambient_world_generation' });
    assert.equal(registry.abortAll(reason), true);
    assert.equal(awg.signal.aborted, true);
    assert.equal(cancellationReason(awg.signal), reason);
  }
});

test('lease loss directly cancels its request with a preserved reason', () => {
  const controller = new AbortController();
  assert.equal(abortWithReason(controller, 'LEASE_LOSS'), true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(cancellationReason(controller.signal), 'LEASE_LOSS');
});

test('clearing an old controller cannot clear its replacement', () => {
  const registry = new GenerationCancellationRegistry();
  const oldController = new AbortController();
  const currentController = new AbortController();
  registry.register('visible', oldController, { purpose: 'journal' });
  registry.register('visible', currentController, { purpose: 'postcard' });
  assert.equal(registry.clear('visible', oldController), false);
  assert.equal(registry.has('visible'), true);
  assert.equal(registry.active('visible').purpose, 'postcard');
});
