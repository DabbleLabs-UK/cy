import assert from 'node:assert/strict';

import { recordCompletedSilence } from './silence.js';

let clock = 1_000_000;
let releaseIdle;
const waiting = new Promise((resolve) => { releaseIdle = resolve; });
const emitted = [];

const result = recordCompletedSilence(198, {
  idle: async (ms) => {
    assert.equal(ms, 198_000, 'the selected duration controls the requested wait');
    await waiting;
  },
  emit: (event) => emitted.push(event),
  reason: 'soma: fatigue is stronger',
  now: () => clock,
});

await Promise.resolve();
assert.equal(emitted.length, 0, 'silence is not published while the quiet period is still in progress');

clock += 7_900;
releaseIdle();
assert.equal(await result, 7, 'an interrupted silence records only the time that actually elapsed');
assert.deepEqual(emitted, [{
  kind: 'silence',
  payload: { seconds: 7, reason: 'soma: fatigue is stronger' },
}], 'the completed event can be rendered as a truthful span ending at its event timestamp');

assert.equal(await recordCompletedSilence(0, {
  idle: async () => assert.fail('zero duration must not wait'),
  emit: () => assert.fail('zero duration must not emit'),
  now: () => clock,
}), 0);

console.log('silence.test.js: all checks passed');
