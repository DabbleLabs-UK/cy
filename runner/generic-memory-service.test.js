import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutobiographicalMemoryRuntime } from './memory-runtime.js';

const sender = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const intervalMs = 30 * 60 * 1000;
const idleSlot = { awgUsedSlot: false, idleBudgetMs: 5000 };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function sourceJob(id = 41) {
  return {
    id, claim_token: `claim-${id}`,
    source: {
      sourceType: 'ENVIRONMENT_EVENT', sourceId: `private-source-marker-${id}`,
      text: 'PRIVATE GENERIC SOURCE CONTENT', tags: ['door'],
      sourceVisibility: 'INTERNAL_ONLY',
    },
  };
}

function backend(now) {
  let nextAt = 0;
  let admitted = 0;
  const claims = [];
  return {
    claims,
    async claimGenericMemorySource(value) {
      claims.push(value);
      if (now() < nextAt) {
        return { job: null, admission: { reason: 'NOT_DUE', wait_ms: nextAt - now() }, depth: 100 };
      }
      nextAt = now() + intervalMs;
      admitted += 1;
      return {
        job: sourceJob(40 + admitted),
        admission: { reason: 'ADMITTED', wait_ms: intervalMs }, depth: 100,
      };
    },
  };
}

function runtime(overrides = {}) {
  const receipts = [];
  const surfaced = [];
  const diagnostics = [];
  const generatedCalls = [];
  const now = overrides.now || (() => 1_000_000);
  const durable = overrides.durable || backend(now);
  const r = new AutobiographicalMemoryRuntime({
    client: {
      async drainMemorySourceQueue() {},
      async claimMemorySource() { return { job: null, depth: 0 }; },
      async claimMemorySurfacing() { return { job: null, depth: 0 }; },
      claimGenericMemorySource: durable.claimGenericMemorySource,
      async queryMemories() { return { candidates: [] }; },
      async finishMemorySource(value) {
        receipts.push(value);
        return { status: 'PROCESSED', result_category: value.result_category };
      },
      async completeMemorySurfacing(value) { surfaced.push(value); },
      async recordMemoryQuery() {},
      ...overrides.client,
    },
    makeId: () => '00000000-0000-4000-8000-000000000012',
    generate: async (call) => {
      generatedCalls.push(call);
      return overrides.generate ? overrides.generate(call) : '{"decision":"NOTHING"}';
    },
    now,
    canRunBackground: overrides.canRunBackground || (() => true),
    backgroundWaitMs: () => 250,
    backgroundTimeoutMs: overrides.backgroundTimeoutMs || 100,
    providerInfo: () => ({ id: 'ollama', model: 'test-model' }),
    genericAvailability: overrides.genericAvailability || (() => ({ allowed: true, reason: 'IDLE_SLOT' })),
    onGenericService: (event) => diagnostics.push(event),
  });
  r.stopped = false;
  r.schedule = () => {};
  return { r, receipts, surfaced, diagnostics, generatedCalls, durable };
}

test('sustained recall ticks leave generic work for one explicit idle slot', async () => {
  const senderClaims = [];
  let recallCount = 0;
  const { r, receipts, durable, generatedCalls } = runtime({ client: {
    async claimMemorySource(value) { senderClaims.push(value); return { job: null, depth: 100 }; },
    async claimMemorySurfacing() { return { job: { id: 51, context: { text: 'recall' } }, depth: 1 }; },
  } });
  r.processSurfacing = async () => { recallCount += 1; };
  try {
    for (let i = 0; i < 50; i++) await r.tick();
    assert.equal(recallCount, 50);
    assert.equal(durable.claims.length, 0);
    assert.equal(receipts.length, 0);
    assert.ok(senderClaims.every((value) => value?.senderOnly === true), 'ordinary ticks must never claim unfiltered formation work');
    assert.equal((await r.serviceGenericDuringIdle(idleSlot)).status, 'NOTHING');
    await r.serviceGenericDuringIdle(idleSlot);
    for (let i = 0; i < 50; i++) await r.tick();
    assert.equal(durable.claims.length, 1, 'one idle admission must not drain the generic backlog');
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].claim_token, 'claim-41');
    assert.equal(receipts[0].provider, 'ollama');
    assert.equal(generatedCalls.length, 1);
    assert.equal(generatedCalls[0].genericFormation, true);
  } finally {
    r.stop();
  }
});

test('an empty ordinary tick never falls back to an unfiltered generic claim', async () => {
  const claims = [];
  const { r, durable } = runtime({ client: {
    async claimMemorySource(value) { claims.push(value); return { job: null, depth: 0 }; },
  } });
  try {
    await r.tick();
    assert.equal(claims.length, 1);
    assert.equal(claims[0].senderOnly, true);
    assert.equal(durable.claims.length, 0);
  } finally {
    r.stop();
  }
});

test('AWG first refusal blocks only a slot it actually used', async () => {
  const { r, durable, receipts } = runtime();
  try {
    await r.serviceGenericDuringIdle({ ...idleSlot, awgUsedSlot: true });
    assert.equal(durable.claims.length, 0);
    // An AWG cadence can be due without a runnable job; the caller reports no used slot.
    assert.equal((await r.serviceGenericDuringIdle(idleSlot)).status, 'NOTHING');
    assert.equal(durable.claims.length, 1);
    assert.equal(receipts.length, 1);
  } finally {
    r.stop();
  }
});

test('stopped, short idle, paused and occupied inference slots cannot claim generic work', async () => {
  for (const scenario of ['stopped', 'short-idle', 'PAUSED', 'INFERENCE_BUSY']) {
    const { r, durable, receipts } = runtime({
      genericAvailability: () => ({
        allowed: !['PAUSED', 'INFERENCE_BUSY'].includes(scenario), reason: scenario,
      }),
    });
    if (scenario === 'stopped') r.stopped = true;
    try {
      await r.serviceGenericDuringIdle({ ...idleSlot, idleBudgetMs: scenario === 'short-idle' ? 999 : 5000 });
      assert.equal(durable.claims.length, 0, scenario);
      assert.equal(receipts.length, 0, scenario);
    } finally {
      r.stop();
    }
  }
});

test('generic admission protects sender work during its claim and generation', async () => {
  for (const phase of ['claim', 'generation']) {
    const started = deferred();
    const release = deferred();
    let senderSignal;
    const { r, durable, receipts } = runtime({
      client: {
        async claimMemorySource({ senderOnly } = {}) {
          assert.equal(senderOnly, true);
          if (phase === 'claim') { started.resolve(); await release.promise; }
          return { job: { id: 81, claim_token: 'sender-81', source: {
            sourceType: 'POSTCARD', sourceId: 'postcard:81', text: 'My dog is called Alfie.',
            sourceVisibility: 'SENDER_RECALLABLE', subjectVisitorId: sender,
          } }, depth: 1 };
        },
      },
      generate: async ({ signal }) => {
        senderSignal = signal;
        if (phase === 'generation') { started.resolve(); await release.promise; }
        return '{"decision":"NOTHING"}';
      },
    });
    const tick = r.tick();
    try {
      await started.promise;
      await r.serviceGenericDuringIdle(idleSlot);
      assert.equal(durable.claims.length, 0, phase);
      if (senderSignal) assert.equal(senderSignal.aborted, false, 'generic admission must not preempt sender inference');
    } finally {
      release.resolve();
      await tick;
      r.stop();
    }
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].claim_token, 'sender-81');
    assert.equal(receipts[0].result_category, 'NOTHING');
  }
});

test('interactive work before admission cannot start a generic claim', async () => {
  const { r, durable } = runtime({
    genericAvailability: () => ({ allowed: false, reason: 'INTERACTIVE_PENDING' }),
  });
  try {
    r.interruptBackground('foreground');
    await r.serviceGenericDuringIdle(idleSlot);
    assert.equal(durable.claims.length, 0);
  } finally {
    r.stop();
  }
});

test('interactive work arriving during claim or retrieval prevents generic inference', async () => {
  for (const phase of ['claim', 'query']) {
    const started = deferred();
    const release = deferred();
    let allowed = true;
    let generations = 0;
    const { r, receipts } = runtime({
      genericAvailability: () => ({ allowed, reason: allowed ? 'IDLE_SLOT' : 'INTERACTIVE_PENDING' }),
      client: {
        async claimGenericMemorySource() {
          if (phase === 'claim') { started.resolve(); await release.promise; }
          return { job: sourceJob(), admission: { reason: 'ADMITTED', wait_ms: intervalMs }, depth: 1 };
        },
        async queryMemories() {
          if (phase === 'query') { started.resolve(); await release.promise; }
          return { candidates: [] };
        },
      },
      generate: async () => { generations += 1; return '{"decision":"NOTHING"}'; },
    });
    const service = r.serviceGenericDuringIdle(idleSlot);
    try {
      await started.promise;
      allowed = false;
      r.interruptBackground('foreground');
      release.resolve();
      await service;
      assert.equal(generations, 0, phase);
      assert.equal(receipts.length, 1, 'an admitted source must receive a canonical completion');
      assert.equal(receipts[0].result_category, 'PREEMPTED', phase);
      assert.deepEqual(receipts[0].operations, []);
    } finally {
      release.resolve();
      await service;
      r.stop();
    }
  }
});

test('interactive inference preempts generic formation through its canonical receipt', async () => {
  const started = deferred();
  const { r, receipts, durable } = runtime({
    generate: async ({ signal, background }) => new Promise((resolve, reject) => {
      assert.equal(background, true);
      signal.addEventListener('abort', () => reject(new DOMException('preempted', 'AbortError')), { once: true });
      started.resolve();
    }),
  });
  const service = r.serviceGenericDuringIdle(idleSlot);
  try {
    await started.promise;
    r.interruptBackground('foreground');
    assert.equal((await service).status, 'PREEMPTED');
    assert.equal(receipts[0].result_category, 'PREEMPTED');
    assert.deepEqual(receipts[0].operations, []);
    await r.serviceGenericDuringIdle(idleSlot);
    assert.equal(durable.claims.length, 1, 'preemption still consumes the admitted slot');
  } finally {
    r.interruptBackground('shutdown');
    await service;
    r.stop();
  }
});

test('generic reservation preempts optional surfacing without overlapping inference', async () => {
  const started = deferred();
  let running = 0;
  let maximumRunning = 0;
  let generations = 0;
  const { r, receipts, surfaced, durable } = runtime({
    client: {
      async claimMemorySurfacing() {
        return { job: { id: 90, subject_visitor_id: sender, context: { text: 'television' } }, depth: 1 };
      },
      async queryMemories({ limit }) {
        return { candidates: limit === 10 ? [{
          id: '00000000-0000-4000-8000-000000000011',
          type: 'PERSON', status: 'ACTIVE', privacyScope: 'SENDER_RECALLABLE',
          subjectVisitorId: sender, content: 'The sender asked about television.',
          consistencyStatus: 'CONSISTENT', version: 1, tags: ['television'],
        }] : [] };
      },
    },
    generate: async ({ signal }) => {
      generations += 1;
      running += 1;
      maximumRunning = Math.max(maximumRunning, running);
      try {
        if (generations === 1) {
          return await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('preempted', 'AbortError')), { once: true });
            started.resolve();
          });
        }
        return '{"decision":"NOTHING"}';
      } finally {
        running -= 1;
      }
    },
  });
  const tick = r.tick();
  try {
    await started.promise;
    assert.equal((await r.serviceGenericDuringIdle(idleSlot)).status, 'NOTHING');
    await tick;
    assert.equal(surfaced[0].result_category, 'PREEMPTED');
    assert.equal(receipts[0].result_category, 'NOTHING');
    assert.equal(durable.claims.length, 1);
    assert.equal(generations, 2);
    assert.equal(maximumRunning, 1);
  } finally {
    r.interruptBackground('shutdown');
    await tick;
    r.stop();
  }
});

test('concurrent idle calls cannot claim two generic jobs', async () => {
  const started = deferred();
  const release = deferred();
  let claims = 0;
  const { r, receipts } = runtime({ client: {
    async claimGenericMemorySource() {
      claims += 1;
      started.resolve();
      await release.promise;
      return { job: sourceJob(), admission: { reason: 'ADMITTED', wait_ms: intervalMs }, depth: 100 };
    },
  } });
  const first = r.serviceGenericDuringIdle(idleSlot);
  let second;
  try {
    await started.promise;
    second = r.serviceGenericDuringIdle(idleSlot);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(claims, 1);
    release.resolve();
    await Promise.all([first, second]);
    assert.equal(receipts.length, 1);
  } finally {
    release.resolve();
    await Promise.all([first, second]);
    r.stop();
  }
});

test('a timed out generic attempt consumes the locally cached service slot', async () => {
  const { r, receipts, durable } = runtime({
    backgroundTimeoutMs: 10,
    generate: async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true });
    }),
  });
  try {
    assert.equal((await r.serviceGenericDuringIdle(idleSlot)).status, 'TIMEOUT');
    assert.equal(receipts[0].result_category, 'TIMEOUT');
    await r.serviceGenericDuringIdle(idleSlot);
    assert.equal(durable.claims.length, 1);
    assert.equal(receipts.length, 1);
  } finally {
    r.stop();
  }
});

test('a restarted runtime respects the same backend cadence and caches its refusal', async () => {
  let now = 1_000_000;
  const durable = backend(() => now);
  const first = runtime({ durable, now: () => now });
  const second = runtime({ durable, now: () => now });
  try {
    assert.equal((await first.r.serviceGenericDuringIdle(idleSlot)).status, 'NOTHING');
    first.r.stop();
    await second.r.serviceGenericDuringIdle(idleSlot);
    await second.r.serviceGenericDuringIdle(idleSlot);
    assert.equal(second.receipts.length, 0);
    assert.equal(durable.claims.length, 2, 'the restarted process must cache the backend refusal');
    now += intervalMs;
    assert.equal((await second.r.serviceGenericDuringIdle(idleSlot)).status, 'NOTHING');
    assert.equal(second.receipts.length, 1);
    assert.equal(durable.claims.length, 3);
  } finally {
    first.r.stop();
    second.r.stop();
  }
});

test('generic service diagnostics contain outcomes without source or error content', async () => {
  for (const fail of [false, true]) {
    const { r, diagnostics } = runtime({
      generate: async () => {
        if (fail) throw new Error('PRIVATE GENERIC ERROR BODY');
        return '{"decision":"NOTHING"}';
      },
    });
    try {
      await r.serviceGenericDuringIdle(idleSlot);
      assert.ok(diagnostics.length > 0);
      const serialized = JSON.stringify(diagnostics);
      for (const content of ['PRIVATE GENERIC SOURCE CONTENT', 'private-source-marker-', 'PRIVATE GENERIC ERROR BODY', 'claim-41']) {
        assert.equal(serialized.includes(content), false, `service diagnostics leaked ${content}`);
      }
    } finally {
      r.stop();
    }
  }
});

test('generic formation retains the canonical PERSON provenance guard', async () => {
  const { r, receipts } = runtime({
    client: {
      async claimGenericMemorySource() {
        const job = sourceJob();
        job.source.sourceType = 'CY_EXPRESSION';
        return { job, admission: { reason: 'ADMITTED', wait_ms: intervalMs }, depth: 1 };
      },
    },
    generate: async () => '{"decision":"CREATE","type":"PERSON","content":"The sender owns a dog."}',
  });
  try {
    assert.equal((await r.serviceGenericDuringIdle(idleSlot)).status, 'INVALID');
    assert.equal(receipts[0].result_category, 'INVALID');
    assert.deepEqual(receipts[0].operations, []);
  } finally {
    r.stop();
  }
});

test('slow surfacing settlement keeps the next optional recall from taking the reserved slot', async () => {
  const started = deferred();
  const release = deferred();
  let surfacingCalls = 0;
  let senderClaims = 0;
  const { r, durable } = runtime({ client: {
    async claimMemorySource() { senderClaims += 1; return { job: null, depth: 0 }; },
    async claimMemorySurfacing() { return { job: { id: 91, context: { text: 'recall' } }, depth: 1 }; },
  } });
  r.processSurfacing = async () => {
    surfacingCalls += 1;
    started.resolve();
    await release.promise;
  };
  const tick = r.tick();
  let service;
  try {
    await started.promise;
    service = r.serviceGenericDuringIdle(idleSlot);
    assert.equal((await service).status, 'RECALL_SETTLING');
    assert.equal(durable.claims.length, 0, 'generic admission must wait for active recall to settle');
    release.resolve();
    await tick;
    await r.tick();
    assert.equal(surfacingCalls, 1, 'replenished optional recall must not steal the reserved idle slot');
    assert.ok(senderClaims >= 2, 'a deferred generic reservation must not suppress sender checks');
    assert.equal((await r.serviceGenericDuringIdle(idleSlot)).status, 'NOTHING');
    assert.equal(durable.claims.length, 1);
  } finally {
    release.resolve();
    await Promise.all([tick, service]);
    r.stop();
  }
});
