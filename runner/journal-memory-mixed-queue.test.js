import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { AutobiographicalMemoryRuntime } from './memory-runtime.js';

const BASE = '5aedc3b2c1df89f6b623cdffc921ae9d4bce8e01';
const priorSource = execFileSync('git', ['show', `${BASE}:runner/memory-runtime.js`], { encoding: 'utf8' });
const priorImportable = priorSource.replace(/from '(\.\/[^']+)'/g,
  (text, relative) => `from '${new URL(relative, import.meta.url).href}'`);
const { AutobiographicalMemoryRuntime: PriorRuntime } = await import(
  'data:text/javascript;base64,' + Buffer.from(priorImportable).toString('base64'));
const memory = { id: '00000000-0000-4000-8000-000000000001', type: 'EPISODIC', status: 'ACTIVE',
  privacyScope: 'INTERNAL_ONLY', subjectVisitorId: null, originKind: 'ENVIRONMENT_EVENT',
  consistencyStatus: 'UNCERTAIN', content: 'Cy remembers a question during exercise.', tags: ['yard'] };
const record = id => ({ world_event: { id, timestamp: '2026-10-28T12:00:00.000Z',
  event_type: 'observed_question', event_family: 'social', world: { context: { location: 'CELL' } } },
observation: { summary: 'A synthetic observed question.' }, consumed_by: ['soma-input-staging-v1'] });

function setup({ Runtime = AutobiographicalMemoryRuntime, reserved = true, ordinary = true,
  reservationGate = true, jobKind = 'ordinary', action = null, alter = null } = {}) {
  const calls = { claims: [], models: [], completions: [], queries: 0, enqueues: 0, sender: 0 };
  const gates = { ordinary, reservationGate, sender: false };
  let nextId = 40, lastJournal = null, jobs = [jobKind];
  const runtime = new Runtime({
    now: () => 1000000, makeId: () => '00000000-0000-4000-8000-000000000002',
    journalPreparationContext: reserved ? () => ({ eligible: true, slotAnchorMs: 900000, dueAtMs: 1060000 }) : null,
    canRunBackground: kind => kind === 'surfacing' ? gates.ordinary
      : kind === 'journal_preparation' ? gates.reservationGate : gates.sender,
    client: {
      async enqueueMemorySurfacing(value) {
        calls.enqueues++;
        lastJournal = { id: ++nextId, context: structuredClone(value.context), context_fingerprint: value.context_fingerprint,
          subject_visitor_id: null, sender_scope_key: '' };
        return { queued: true };
      },
      async claimMemorySource() { calls.sender++; return { job: null }; },
      async claimMemorySurfacing(input) {
        calls.claims.push(input);
        const expectedKind = Runtime === PriorRuntime && reserved ? 'journal_preparation' : 'surfacing';
        assert.equal(runtime.activeWorkKind, expectedKind, 'pending claim classification');
        action?.('claim', runtime, calls, gates);
        const kind = jobs.shift();
        if (!kind) return { job: null };
        const job = kind === 'journal' ? structuredClone(lastJournal) : { id: ++nextId,
          context: { generationRef: 'other:1', text: 'question', groundedContext: 'A question.' },
          context_fingerprint: 'c'.repeat(64), subject_visitor_id: null, sender_scope_key: '' };
        if (alter) alter(job, lastJournal);
        return { job };
      },
      async queryMemories() {
        calls.queries++; action?.('query', runtime, calls, gates);
        return { candidates: [memory], journal_candidate_versions: { [memory.id]: 1 } };
      },
      async completeMemorySurfacing(value) {
        calls.completions.push(value); return { status: value.result_category };
      },
      async getPreparedMemorySet() { return { prepared_set: null }; },
      async recordMemoryQuery() {},
    },
    generate: async call => {
      calls.models.push({ kind: runtime.activeWorkKind,
        reservation: !!call.journalPreparationReservation, background: call.background,
        valid: call.journalPreparationReservation ? runtime.validJournalReservation(call.journalPreparationReservation) : false });
      return new Promise((resolve, reject) => {
        call.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
        action?.('model', runtime, calls, gates);
        if (!call.signal.aborted) resolve('{"memoryRefs":["C1"]}');
      });
    },
  });
  runtime.stopped = false; runtime.schedule = () => {};
  if (reserved) {
    runtime.observeJournalCue(record('env-scope-control'));
    runtime.acknowledgeJournalCues([{ kind: 'world_event_record', payload: record('env-scope-control') }]);
  }
  return { runtime, calls, gates, setJobs: value => { jobs = [...value]; } };
}
const noise = stage => stage === 'model';
const noiseAction = (stage, runtime) => { if (noise(stage)) runtime.interruptJournalPreparation('wing-noise'); };

test('pinned old candidate reproduces ordinary PREPARED versus erroneous PREEMPTED', async () => {
  // The unchanged prior implementation labels the pending claim from a reservation.
  const oldRun = async reserved => {
    const f = setup({ Runtime: PriorRuntime, reserved, action: noiseAction });
    await f.runtime.tick(); f.runtime.stop(); return f.calls;
  };
  assert.equal((await oldRun(false)).completions[0].result_category, 'PREPARED');
  assert.equal((await oldRun(true)).completions[0].result_category, 'PREEMPTED');
});

test('same ordinary job has identical ordinary cancellation and call contract with or without a reservation', async () => {
  const results = [];
  for (const reserved of [false, true]) {
    const f = setup({ reserved, action: noiseAction }); await f.runtime.tick(); f.runtime.stop();
    assert.equal(f.calls.completions[0].result_category, 'PREPARED');
    assert.equal(f.calls.claims[0].journal_preparation_only, undefined);
    results.push({ models: f.calls.models, selected: f.calls.completions[0].selected_memories });
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0].models, [{ kind: 'surfacing', reservation: false, background: true, valid: false }]);
});

for (const ordinary of [true, false]) {
  test(`verified claimed journal job receives its own reservation when ordinary gate is ${ordinary}`, async () => {
    const f = setup({ ordinary, jobKind: 'journal' }); await f.runtime.tick();
    assert.deepEqual(f.calls.models, [{ kind: 'journal_preparation', reservation: true, background: true, valid: true }]);
    assert.equal(f.calls.completions[0].result_category, 'PREPARED');
    assert.equal(!!f.calls.claims[0].journal_preparation_only, !ordinary);
    assert.equal(f.calls.enqueues, 1); await f.runtime.tick(); assert.equal(f.calls.enqueues, 1);
    assert.equal(f.calls.models.length, 1); f.runtime.stop();
  });
}
test('actual journal job retains journal-only wing-noise cancellation', async () => {
  const f = setup({ jobKind: 'journal', action: noiseAction }); await f.runtime.tick();
  assert.equal(f.calls.models[0].kind, 'journal_preparation');
  assert.equal(f.calls.completions[0].result_category, 'SUPERSEDED');
  assert.equal(f.runtime.journalPreparation.slot.reason, 'wing-noise'); f.runtime.stop();
});
test('noise during unresolved claim cannot invalidate or grant a journal reservation', async () => {
  const f = setup({ jobKind: 'ordinary', action: (stage, runtime) => {
    if (stage === 'claim') runtime.interruptJournalPreparation('wing-noise');
  } });
  await f.runtime.tick(); assert.equal(f.runtime.journalPreparation.current(), true);
  assert.equal(f.calls.completions[0].result_category, 'PREPARED'); f.runtime.stop();
});
test('new cue during ordinary surfacing cannot trigger journal-only supersession cancellation', async () => {
  const f = setup({ action: (stage, runtime) => { if (stage === 'model') runtime.observeJournalCue(record('env-new')); } });
  await f.runtime.tick(); assert.equal(f.calls.completions[0].result_category, 'PREPARED'); f.runtime.stop();
});
test('ordinary row unexpectedly returned to a quiet-only claim is not upgraded or dispatched', async () => {
  const f = setup({ ordinary: false }); await f.runtime.tick();
  assert.equal(f.calls.claims[0].journal_preparation_only, true);
  assert.equal(f.calls.queries, 0); assert.equal(f.calls.models.length, 0);
  assert.equal(f.calls.completions[0].result_category, 'PREEMPTED'); f.runtime.stop();
});
test('ordinary admission closing during claim or retrieval cannot borrow a concurrent reservation', async () => {
  for (const boundary of ['claim', 'query']) {
    const f = setup({ action: (stage, runtime, calls, gates) => { if (stage === boundary) gates.ordinary = false; } });
    await f.runtime.tick(); assert.equal(f.calls.models.length, 0);
    assert.equal(f.calls.queries, boundary === 'claim' ? 0 : 1);
    assert.equal(f.calls.completions[0].result_category, 'PREEMPTED'); f.runtime.stop();
  }
});
for (const field of ['fingerprint', 'cue', 'scope', 'sender', 'senderScope', 'reference', 'missing', 'visitor']) {
  test(`unverified journal binding fails closed without special treatment: ${field}`, async () => {
    const f = setup({ jobKind: 'journal', alter: job => {
      if (field === 'fingerprint') job.context_fingerprint = 'd'.repeat(64);
      if (field === 'cue') job.context.journalPreparation.cue.digest = 'd'.repeat(64);
      if (field === 'scope') job.context.journalPreparation.cue.scope = 'SENDER';
      if (field === 'sender') job.subject_visitor_id = 'a'.repeat(32);
      if (field === 'senderScope') job.sender_scope_key = 'a'.repeat(32);
      if (field === 'reference') job.context.generationRef = 'other:1';
      if (field === 'missing') delete job.context.journalPreparation;
      if (field === 'visitor') job.context.currentVisitorId = 'a'.repeat(32);
    } });
    await f.runtime.tick(); assert.equal(f.calls.queries, 0); assert.equal(f.calls.models.length, 0);
    assert.equal(f.calls.completions[0].result_category, 'SUPERSEDED'); f.runtime.stop();
  });
}
for (const order of [['ordinary', 'journal'], ['journal', 'ordinary']]) {
  test(`mixed queue ordering preserves each claimed class: ${order.join(',')}`, async () => {
    const f = setup(); f.setJobs(order); await f.runtime.tick(); await f.runtime.tick();
    assert.deepEqual(f.calls.models.map(m => m.kind), order.map(k => k === 'journal' ? 'journal_preparation' : 'surfacing'));
    assert.equal(f.calls.enqueues, 1); assert.equal(f.calls.completions.length, 2); f.runtime.stop();
  });
}
test('restart has no desire: ordinary recovery stays ordinary and old journal binding cannot regain a token', async () => {
  const prior = setup(); await prior.runtime.admitJournalPreparation();
  const oldContext = structuredClone(prior.runtime.journalPreparation.slot.binding);
  const f = setup({ reserved: false, action: noiseAction });
  await f.runtime.tick(); assert.equal(f.calls.completions[0].result_category, 'PREPARED');
  assert.equal(f.calls.models[0].kind, 'surfacing');
  assert.equal(f.runtime.journalReservationForJob({ context: { generationRef: `journal:${oldContext.slotAnchorMs}`,
    journalPreparation: oldContext }, context_fingerprint: oldContext.slotKey, subject_visitor_id: null }), null);
  prior.runtime.stop(); f.runtime.stop();
});
test('sender formation first refusal still precedes either surfacing class', async () => {
  const f = setup(); f.gates.sender = true;
  f.runtime.client.claimMemorySource = async () => { f.calls.sender++; return { job: { id: 99 } }; };
  let formed = 0; f.runtime.processFormation = async () => { formed++; };
  await f.runtime.tick(); assert.equal(formed, 1); assert.equal(f.calls.claims.length, 0);
  assert.equal(f.calls.models.length, 0); f.runtime.stop();
});
