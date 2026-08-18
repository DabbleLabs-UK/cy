// abort.test.js - the in-flight generation is cancelled IMMEDIATELY on arrival.
//
// The cancellation path in run.js is: an inbound postcard/notice calls
// currentAbort.abort(); the AbortController.signal aborts the ollama fetch; the
// pending reader.read() rejects; the stream reader returns { aborted:true } AT
// ONCE rather than draining the rest of the in-flight generation. This exercises
// the extracted, dependency-free readNdjsonStream over a MOCK reader (no live
// model), asserting the read stops the instant the signal aborts and delivers no
// further tokens.
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/abort.test.js

import assert from 'node:assert/strict';
import { readNdjsonStream } from './run.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

const enc = new TextEncoder();
const chunk = (obj) => enc.encode(JSON.stringify(obj) + '\n');

// A settle-within deadline: the read must resolve promptly after abort, never
// hang waiting for the (never-resolving) generation to finish.
function within(ms, promise) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`did not settle within ${ms}ms`)), ms)),
  ]);
}

// ---- 1. normal completion: every token delivered, the done line captured ----
await (async () => {
  const reads = [
    { value: chunk({ response: 'hel' }), done: false },
    { value: chunk({ response: 'lo' }), done: false },
    { value: chunk({ response: '', done: true, eval_count: 2 }), done: false },
    { done: true },
  ];
  let i = 0;
  const reader = { read: async () => reads[i++] };
  const tokens = [];
  let stats = null;
  const res = await readNdjsonStream(reader, {
    signal: { aborted: false },
    onToken: async (t) => { tokens.push(t); return false; },
    onDone: (o) => { stats = o; },
  });
  assert.deepEqual(tokens, ['hel', 'lo'], 'both response tokens delivered in order');
  assert.equal(stats && stats.eval_count, 2, 'the final done line was captured for counters');
  assert.equal(res.ended, true, 'a clean end returns { ended:true }');
  ok('normal stream: every token delivered and the done line captured');
})();

// ---- 2. abort BEFORE any token: returns { aborted:true } at once ----
await (async () => {
  const ac = new AbortController();
  // read() never resolves on its own; it rejects the instant the signal aborts.
  const reader = {
    read: () =>
      new Promise((resolve, reject) => {
        if (ac.signal.aborted) return reject(new Error('aborted'));
        ac.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  };
  let tokenCalls = 0;
  const p = readNdjsonStream(reader, {
    signal: ac.signal,
    onToken: async () => { tokenCalls++; return false; },
  });
  // nothing has arrived; now an inbound postcard aborts the in-flight generation
  ac.abort();
  const res = await within(500, p);
  assert.equal(res.aborted, true, 'an aborted read returns { aborted:true }');
  assert.equal(tokenCalls, 0, 'no tokens were delivered from the cancelled stream');
  ok('abort with nothing in flight cancels at once (no hang, no tokens)');
})();

// ---- 3. abort MID-STREAM: tokens already read are kept, then it stops dead ----
// The reader hands back two tokens in one chunk, then the next read hangs. On the
// second token onToken triggers the abort (as an inbound postcard would); the
// loop must NOT drain any further - the very next read sees the aborted signal.
await (async () => {
  const ac = new AbortController();
  let served = false;
  const reader = {
    read: () => {
      if (!served) {
        served = true;
        return Promise.resolve({
          value: enc.encode(
            JSON.stringify({ response: 'A' }) + '\n' + JSON.stringify({ response: 'B' }) + '\n',
          ),
          done: false,
        });
      }
      // subsequent reads hang until the signal aborts, then reject
      return new Promise((resolve, reject) => {
        if (ac.signal.aborted) return reject(new Error('aborted'));
        ac.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  };
  const tokens = [];
  const res = await within(500, readNdjsonStream(reader, {
    signal: ac.signal,
    onToken: async (t) => {
      tokens.push(t);
      if (t === 'B') ac.abort(); // an inbound postcard cuts across the thought
      return false;
    },
  }));
  assert.deepEqual(tokens, ['A', 'B'], 'tokens read before the abort are kept');
  assert.equal(res.aborted, true, 'once aborted, the next read stops the stream dead');
  ok('abort mid-stream keeps what was read and cancels the rest immediately');
})();

// ---- 4. the near-repeat "break" path stops the read without an abort ----
await (async () => {
  const reads = [
    { value: chunk({ response: 'x' }), done: false },
    { value: chunk({ response: 'y' }), done: false },
    { done: true },
  ];
  let i = 0;
  const reader = { read: async () => reads[i++] };
  const tokens = [];
  const res = await readNdjsonStream(reader, {
    signal: { aborted: false },
    onToken: async (t) => { tokens.push(t); return t === 'x'; }, // stop after first
  });
  assert.deepEqual(tokens, ['x'], 'onToken returning truthy stops the read immediately');
  assert.equal(res.broke, true, 'an early stop returns { broke:true }');
  ok('onToken can stop the read early (the near-repeat break path)');
})();

console.log(`\nabort.test.js: all ${n} checks passed`);
