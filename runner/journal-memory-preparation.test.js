import assert from 'node:assert/strict';
import test from 'node:test';
import { JournalMemoryPreparation, journalMemoryCue, journalPreparationContext } from './journal-memory-preparation.js';
import { AutobiographicalMemoryRuntime } from './memory-runtime.js';
import { filterMemoriesBeforePrompt } from './autobiographical-memory.js';
import { journalFromWorking } from './fixtures/memory-status-journal.mjs';
import { selectAvailableExpressiveAction } from './expressive-choice.js';

const record = (id = 'event-one', summary = 'Bill asked a question in the yard.') => ({
  world_event: { id, timestamp: '2026-10-28T12:00:00.000Z', event_type: 'yard_contact_responded',
    event_family: 'social', world: { context: { location: 'yard' } } },
  observation: { summary }, consumed_by: ['soma-input-staging-v1'],
});
const memory = { id: '00000000-0000-4000-8000-000000000001', type: 'EPISODIC', status: 'ACTIVE',
  privacyScope: 'INTERNAL_ONLY', subjectVisitorId: null, originKind: 'ENVIRONMENT_EVENT',
  consistencyStatus: 'UNCERTAIN', content: 'Cy remembers a question during exercise.', tags: ['yard'] };
function setup() {
  let now = 1000000;
  const availability = { eligible: true, slotAnchorMs: 900000, dueAtMs: now + 300000 };
  const lane = new JournalMemoryPreparation({ now: () => now, availability: () => availability });
  const observe = (value = record()) => { lane.observe(value); lane.acknowledge([{ kind: 'world_event_record', payload: value }]); };
  const prepared = (selected = [memory]) => ({ id: 'set-one', context_fingerprint: lane.slot.binding.slotKey,
    journal_preparation: structuredClone(lane.slot.binding), subject_visitor_id: null,
    selected_memories: filterMemoriesBeforePrompt(selected), expires_at: new Date(now + 900000).toISOString() });
  return { lane, availability, observe, prepared, now: () => now, advance: n => { now += n; } };
}

test('unacknowledged or noncanonical experience cannot authorize preparation', () => {
  const f = setup(); f.lane.observe(record()); assert.equal(f.lane.admit(), null);
  f.lane.acknowledge([{ kind: 'event', payload: record() }]); assert.equal(f.lane.admit(), null);
  f.lane.acknowledge([{ kind: 'world_event_record', payload: record('other') }]); assert.equal(f.lane.admit(), null);
  assert.equal(journalMemoryCue({ ...record(), consumed_by: [] }), null);
  assert.equal(journalMemoryCue({ ...record(), world_event: { ...record().world_event, event_type: 'postcard' } }), null);
});
test('exact canonical acknowledgement works in either callback ordering', () => {
  for (const ackFirst of [false, true]) {
    const f = setup(); const events = [{ kind: 'world_event_record', payload: record() }];
    if (ackFirst) f.lane.acknowledge(events);
    f.lane.observe(record()); if (!ackFirst) f.lane.acknowledge(events);
    const ctx = f.lane.admit();
    assert.equal(ctx.journalPreparation.cue.sourceEventId, 'event-one');
    assert.equal(ctx.location, 'yard', 'original event location, not live CELL eligibility');
    assert.equal(ctx.currentVisitorId, null); assert.equal(ctx.recentExpressionText, '');
    assert.equal(ctx.groundedContext, ctx.text); assert.equal(ctx.journalPreparation.cue.digest.length, 64);
    assert.deepEqual(ctx, journalPreparationContext(ctx.journalPreparation));
  }
});
test('latest cue coalesces before admission; newer unacknowledged cue cannot inherit old acknowledgement', () => {
  const f = setup(); f.observe(); f.lane.observe(record('new', 'A new grounded event.'));
  assert.equal(f.lane.admit(), null); f.observe(record('new', 'A new grounded event.'));
  assert.equal(f.lane.admit().journalPreparation.cue.sourceEventId, 'new');
});
test('one immutable attempt allowance; a newer cue invalidates without buying same-slot work', () => {
  const f = setup(); f.observe(); const a = f.lane.admit(); const token = f.lane.reservation();
  assert.equal(f.lane.admit(), null); f.observe(record('new'));
  assert.equal(f.lane.desiredFingerprint(), null); assert.equal(f.lane.validReservation(token), false);
  assert.equal(f.lane.admit(), null); assert.equal(a.journalPreparation.cue.sourceEventId, 'event-one');
});
test('lookahead uses unchanged TTL less work ceiling, not arbitrary cue recency', () => {
  const f = setup(); f.observe(); f.availability.dueAtMs = f.now() + 780001;
  assert.equal(f.lane.admit(), null); f.advance(1); assert.ok(f.lane.admit());
});
test('slot opening preserves exact anchor while live cadence moves forward; consume once', () => {
  const f = setup(); f.observe(); f.lane.admit(); f.lane.begin(900000);
  f.availability.slotAnchorMs = f.now(); assert.ok(f.lane.acceptPrepared(f.prepared()));
  const options = { sourceEventId: 'event-one', eligible: true, generationRef: 'journal-prose:1000000' };
  const consumed = f.lane.consume(options); assert.equal(consumed.selected.length, 1);
  assert.equal(f.lane.consume(options).selected.length, 0);
  assert.equal(consumed.inspection.consumedBy, options.generationRef);
  f.lane.finish(); assert.equal(f.lane.desiredFingerprint(), null);
  assert.equal(f.lane.admit(), null, 'already handled cue cannot fill a later opportunity');
});
for (const why of ['wrong-slot', 'wrong-source', 'wrong-digest', 'expiry', 'ineligible', 'not-revalidated']) {
  test(`consumption fails closed: ${why}`, () => {
    const f = setup(); f.observe(); f.lane.admit();
    f.lane.begin(why === 'wrong-slot' ? 800000 : 900000);
    const set = f.prepared();
    if (why === 'wrong-digest') set.journal_preparation.cue.digest = 'f'.repeat(64);
    if (why !== 'not-revalidated') f.lane.acceptPrepared(set);
    if (why === 'expiry') f.advance(900001);
    const result = f.lane.consume({ sourceEventId: why === 'wrong-source' ? 'other' : 'event-one',
      eligible: why !== 'ineligible', generationRef: 'j' });
    assert.equal(result.selected.length, 0);
  });
}
for (const changes of [{ status: 'ARCHIVED' }, { status: undefined }, { privacyScope: 'SENDER_RECALLABLE', subjectVisitorId: 'a'.repeat(32) },
  { privacyScope: 'UNKNOWN' }]) {
  test(`final insertion applies existing strict eligibility: ${JSON.stringify(changes)}`, () => {
    const f = setup(); f.observe(); f.lane.admit(); f.lane.begin(900000);
    const set = f.prepared(); set.selected_memories = [{ ...set.selected_memories[0], ...changes }];
    f.lane.acceptPrepared(set);
    assert.equal(f.lane.consume({ sourceEventId: 'event-one', eligible: true }).selected.length, 0);
  });
}
test('draw/silence/closure cannot expose memory or carry it into an unrelated journal', () => {
  const f = setup(); f.observe(); f.lane.admit(); f.lane.begin(900000); f.lane.acceptPrepared(f.prepared());
  f.lane.finish(); f.availability.slotAnchorMs = 1000000;
  f.lane.begin(1000000); assert.equal(f.lane.consume({ sourceEventId: 'event-one', eligible: true }).selected.length, 0);
  assert.equal(f.lane.admit(), null);
});
test('restart has no desire and no private prepared memory', () => {
  const f = setup(); f.observe(); f.lane.admit(); f.lane.acceptPrepared(f.prepared());
  const restarted = new JournalMemoryPreparation({ now: f.now, availability: () => f.availability });
  assert.equal(restarted.desiredFingerprint(), null); assert.equal(restarted.admit(), null);
});

function runtimeFixture({ query = [memory], fail = false, quiet = true } = {}) {
  const f = setup(); const calls = { enqueue: [], claim: [], model: [], complete: [], consume: [] };
  let set = null, job = null, readGate = null;
  const client = {
    async claimMemorySource() { return { job: null }; },
    async enqueueMemorySurfacing(v) { calls.enqueue.push(v); job = { id: 1, context: v.context,
      context_fingerprint: v.context_fingerprint, subject_visitor_id: null }; return { queued: true }; },
    async claimMemorySurfacing(v) { calls.claim.push(v); const result = job; job = null; return { job: result }; },
    async queryMemories() { return { candidates: query,
      journal_candidate_versions: Object.fromEntries(query.map(m => [m.id, 1])) }; },
    async completeMemorySurfacing(v) { calls.complete.push(v);
      if (['PREPARED', 'NO_CANDIDATES'].includes(v.result_category)) set = { id: v.prepared_set_id,
        journal_preparation: structuredClone(f.runtime.journalPreparation.slot.binding), context_fingerprint: calls.enqueue[0].context_fingerprint,
        selected_memories: v.selected_memories, subject_visitor_id: null, expires_at: new Date(f.now() + 900000).toISOString() };
      return { status: v.result_category }; },
    async getPreparedMemorySet() { if (readGate) await readGate; return { prepared_set: set }; },
    async consumePreparedMemorySet(v) { calls.consume.push(v); }, async recordMemoryQuery() {},
  };
  f.runtime = new AutobiographicalMemoryRuntime({ client, now: f.now, makeId: () => 'set-early',
    journalPreparationContext: () => f.availability,
    canRunBackground: kind => kind === 'journal_preparation' || (!quiet && kind === 'surfacing'),
    generate: async call => { calls.model.push(call); if (fail) throw new Error('provider unavailable'); return '{"memoryRefs":["C1"]}'; },
    contextBroker: () => { throw new Error('mutable broker must not be consulted'); },
  });
  f.runtime.stopped = false;
  f.runtime.schedule = () => {};
  f.runtime.observeJournalCue(record()); f.runtime.acknowledgeJournalCues([{ kind: 'world_event_record', payload: record() }]);
  return { ...f, calls, client, blockRead: value => { readGate = value; } };
}
test('historical-style lead time prepares before expression, stays private, and reaches journal prompt without waiting', async () => {
  const f = runtimeFixture(); await f.runtime.tick();
  assert.equal(f.calls.model.length, 1); assert.equal(f.calls.claim[0].journal_preparation_only, true);
  assert.equal(f.calls.complete[0].journal_candidate_versions[memory.id], 1);
  assert.ok(f.calls.model[0].journalPreparationReservation);
  assert.equal(f.runtime.working.selected.length, 0, 'chooser/drawing/postcard default lane is untouched');
  assert.doesNotMatch(f.calls.model[0].prompt, /event-one|1000000|Soma|current.time|recent.expression/i);
  f.advance(90000); f.runtime.beginJournalOpportunity(900000);
  await new Promise(resolve => setImmediate(resolve));
  const consumed = f.runtime.consumeJournalPreparation({ sourceEventId: 'event-one', generationRef: 'journal-prose:1', eligible: true });
  assert.equal(consumed.selected.length, 1); assert.equal(f.calls.consume.length, 1);
  const rendered = journalFromWorking({ consumeWorking: () => consumed, working: consumed });
  assert.match(rendered.prompt, /Cy remembers a question/);
  assert.equal(f.calls.model.length, 1, 'frozen prose retries have no additional memory selection');
  f.runtime.finishJournalOpportunity(); f.runtime.stop();
});
test('asynchronous canonical read unfinished at freeze omits rather than waiting or later changing context', async () => {
  const f = runtimeFixture(); await f.runtime.tick(); let release;
  f.runtime.journalPreparation.invalidateReady();
  f.blockRead(new Promise(resolve => { release = resolve; }));
  f.runtime.beginJournalOpportunity(900000);
  const frozen = f.runtime.consumeJournalPreparation({ sourceEventId: 'event-one', eligible: true });
  assert.equal(frozen.selected.length, 0); release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(frozen.selected.length, 0); assert.equal(f.runtime.journalPreparation.slot.ready, null);
  assert.equal(f.calls.model.length, 1); f.runtime.stop();
});
test('provider error consumes allowance; no retry inference, no global activation', async () => {
  const f = runtimeFixture({ fail: true }); await f.runtime.tick(); await f.runtime.tick();
  assert.equal(f.calls.model.length, 1); assert.equal(f.calls.complete[0].result_category, 'ERROR');
  assert.equal(f.runtime.working.selected.length, 0); f.runtime.stop();
});
test('zero candidates remains zero without model work', async () => {
  const f = runtimeFixture({ query: [] }); await f.runtime.tick();
  assert.equal(f.calls.model.length, 0); assert.equal(f.calls.complete[0].result_category, 'NO_CANDIDATES');
  f.runtime.stop();
});
test('an external drawing closes an upcoming private set without opening another slot', async () => {
  const f = runtimeFixture(); await f.runtime.tick();
  assert.ok(f.runtime.journalPreparation.slot.ready);
  f.runtime.finishJournalOpportunity({ closeUpcoming: true });
  assert.equal(f.runtime.desiredJournalFingerprint(), null);
  await f.runtime.tick(); assert.equal(f.calls.model.length, 1); f.runtime.stop();
});
test('an old existing slot is not resurrected after a lost acknowledgement/restart', async () => {
  const f = runtimeFixture(); f.client.enqueueMemorySurfacing = async () => ({ queued: false });
  await f.runtime.tick(); assert.equal(f.calls.model.length, 0);
  assert.equal(f.runtime.desiredJournalFingerprint(), null); f.runtime.stop();
});

test('new contract cannot use a same-slot different-cue job even before candidate retrieval', async () => {
  const f = runtimeFixture(); await f.runtime.admitJournalPreparation();
  const context = structuredClone(f.calls.enqueue[0].context);
  context.journalPreparation.cue.sourceEventId = 'cross-bound';
  let queried = false; f.client.queryMemories = async () => { queried = true; return { candidates: [memory] }; };
  await f.runtime.processSurfacing({ id: 2, context, context_fingerprint: context.journalPreparation.slotKey });
  assert.equal(queried, false); assert.equal(f.calls.model.length, 0);
  assert.equal(f.calls.complete[0].result_category, 'SUPERSEDED'); f.runtime.stop();
});
test('foreground/noise/pause/shutdown interrupt one background attempt without re-asking', async () => {
  for (const reason of ['foreground', 'noise', 'pause', 'shutdown']) {
    const f = runtimeFixture(); let started;
    const began = new Promise(resolve => { started = resolve; });
    f.runtime.generate = async call => {
      f.calls.model.push(call); started();
      return new Promise((resolve, reject) => call.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true }));
    };
    const work = f.runtime.tick(); await began;
    if (reason === 'noise') f.runtime.interruptJournalPreparation('wing-noise');
    else f.runtime.interruptBackground(reason);
    await work;
    await f.runtime.tick(); assert.equal(f.calls.model.length, 1);
    assert.equal(f.calls.complete[0].result_category, reason === 'noise' ? 'SUPERSEDED' : 'PREEMPTED');
    assert.equal(f.runtime.working.selected.length, 0); f.runtime.stop();
  }
});
test('existing timeout still bounds the only preparation attempt', async () => {
  const f = runtimeFixture(); f.runtime.backgroundTimeoutMs = 10;
  f.runtime.generate = async call => {
    f.calls.model.push(call);
    return new Promise((resolve, reject) => call.signal.addEventListener('abort', () =>
      reject(Object.assign(new Error('timeout'), { name: 'AbortError' })), { once: true }));
  };
  await f.runtime.tick(); await f.runtime.tick();
  assert.equal(f.calls.complete[0].result_category, 'TIMEOUT'); assert.equal(f.calls.model.length, 1); f.runtime.stop();
});
test('a canonical read started before opportunity opening cannot masquerade as final revalidation', async () => {
  const f = runtimeFixture(); await f.runtime.tick(); let release;
  f.runtime.journalPreparation.invalidateReady();
  f.blockRead(new Promise(resolve => { release = resolve; }));
  const before = f.runtime.revalidateJournalPreparation();
  f.runtime.journalPreparation.begin(900000);
  release(); await before;
  assert.equal(f.runtime.journalPreparation.slot.ready, null);
  assert.equal(f.runtime.consumeJournalPreparation({ sourceEventId: 'event-one', eligible: true }).selected.length, 0);
  f.runtime.stop();
});
test('the actual deterministic journal choice consumes prevalidated READY without awaiting a refresh', async () => {
  const f = runtimeFixture(); await f.runtime.tick(); let release;
  f.blockRead(new Promise(resolve => { release = resolve; }));
  f.runtime.beginJournalOpportunity(900000);
  const choice = await selectAvailableExpressiveAction({ availableActions: [{ id: 'journal' }, { id: 'silence' }] }, {
    generate: () => { throw new Error('deterministic ordinary choice must not call a model'); },
  });
  assert.equal(choice.selectedAction, 'journal');
  const result = f.runtime.consumeJournalPreparation({ sourceEventId: 'event-one', eligible: true, generationRef: 'journal-prose:1' });
  assert.equal(result.selected.length, 1);
  assert.equal(f.calls.model.length, 1, 'only the existing optional preparation inference');
  release(); await new Promise(resolve => setImmediate(resolve)); f.runtime.stop();
});
test('known canonical mutation clears readiness and fences in-flight snapshots without creating a new attempt', async () => {
  const f = runtimeFixture(); await f.runtime.tick(); f.runtime.beginJournalOpportunity(900000);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.runtime.journalPreparation.slot.ready);
  f.runtime.journalPreparation.invalidateReady();
  assert.equal(f.runtime.consumeJournalPreparation({ sourceEventId: 'event-one', eligible: true }).selected.length, 0);
  assert.equal(f.calls.model.length, 1); f.runtime.stop();
});
test('an explicit negative canonical refresh clears an older READY snapshot before freeze', async () => {
  const f = runtimeFixture(); await f.runtime.tick();
  assert.ok(f.runtime.journalPreparation.slot.ready);
  f.client.getPreparedMemorySet = async () => ({ prepared_set: null });
  f.runtime.beginJournalOpportunity(900000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.runtime.journalPreparation.slot.ready, null);
  assert.equal(f.runtime.consumeJournalPreparation({ sourceEventId: 'event-one', eligible: true }).selected.length, 0);
  f.runtime.stop();
});
test('a rejected positive refresh cannot leave an older READY snapshot usable', async () => {
  const f = runtimeFixture(); await f.runtime.tick();
  const bad = structuredClone(f.runtime.journalPreparation.slot.ready);
  bad.journal_preparation.cue.digest = '0'.repeat(64);
  f.client.getPreparedMemorySet = async () => ({ prepared_set: bad });
  f.runtime.beginJournalOpportunity(900000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.runtime.journalPreparation.slot.ready, null);
  assert.equal(f.runtime.consumeJournalPreparation({ sourceEventId: 'event-one', eligible: true }).selected.length, 0);
  f.runtime.stop();
});
test('frozen selector construction has no UTF-16 truncation or injected mutable-context dependency', async () => {
  const f = runtimeFixture(); const unicode = record('unicode', 'x'.repeat(10) + '\u{1f30d}'.repeat(590));
  f.runtime.observeJournalCue(unicode); f.runtime.acknowledgeJournalCues([{ kind: 'world_event_record', payload: unicode }]);
  await f.runtime.admitJournalPreparation();
  const context = f.calls.enqueue[0].context;
  context.groundedContext = 'DO NOT INSERT MUTABLE SOMA/HISTORY';
  context.publicSituation = 'DO NOT INSERT LIVE CLOCK';
  await f.runtime.processSurfacing({ id: 1, context, context_fingerprint: context.journalPreparation.slotKey });
  assert.equal(f.calls.model.length, 1);
  assert.match(f.calls.model[0].prompt, new RegExp('\\u{1f30d}'.repeat(590), 'u'));
  assert.doesNotMatch(f.calls.model[0].prompt, /DO NOT INSERT/); f.runtime.stop();
});
