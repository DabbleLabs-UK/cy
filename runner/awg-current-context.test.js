import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import * as location from './location-regime.js';
import * as awg from './ambient-world-generator.js';
import { OFFICERS } from './cast.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { observeEnvironmentRecord } from './grounded-environment-transition.js';
import * as somaModule from './soma.js';
import { beforeAwgCurrentContext, beforeAwgLocationFence } from './fixtures/awg-current-context-source.mjs';

const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
const BASE = '8952baf86dc47e86c7536c84b5f390c762086884';
const at = Date.parse('2026-10-28T08:00:23.212Z');
const copy = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function body(text) {
  const start = text.indexOf('  async function runAwgDuringIdle(');
  const end = text.indexOf('  // Interruptible idle:', start);
  assert.ok(start >= 0 && end > start);
  return text.slice(start, end);
}
function proposal(search = false) {
  return {
    decision: 'EVENT', eventFamily: search ? 'OFFICER_ACTIVITY' : 'SOCIAL_REQUEST',
    participants: ['cy', search ? 'bailey' : 'bill'],
    objective: { eventType: search ? 'cell_search' : 'social_request',
      summary: search ? 'Miss Bailey begins a cell search.' : 'Bill asks Cy a question.' },
    objects: [], observations: [{ observerId: 'cy', access: 'CY_DIRECT',
      summary: search ? 'Miss Bailey begins a cell search.' : 'Bill asks me a question.' }],
    informationClaims: [], thread: { action: 'NONE', id: null, summary: null },
  };
}

// Execute the actual production caller and real parser/materialiser/validator.
// Provider, checkpoint and consequence sinks are isolated in-memory doubles.
function fixture({ runtime = source, search = false, checkpoint = null, raw = null, providerError = null } = {}) {
  const started = deferred(), response = deferred();
  const calls = { model: 0, accounting: [], records: [], history: [], soma: [], social: [],
    memory: [], expression: [], events: [], saves: [], searchProjection: [] };
  const clock = { now: at, minutes: 480, asleep: false, running: true, regimeEpoch: 0 };
  const vitals = { worldSimulation: awg.reconcileWorldSimulationState(null),
    locationRegime: location.reconcileLocationRegimeState(null, { nowMs: at, minutes: 480 }) };
  const somaState = somaModule.reconcileSoma(null, { now: at });
  const client = { paused: false };
  let serial = 0;
  const sandbox = {
    ...location, ...awg, vitals, client, OFFICERS, clock,
    Date: class extends Date { static now() { return clock.now; } },
    console: { log() {}, warn() {}, error() {} },
    maintenance: { refresh: () => ({ state: 'running' }) }, worldMirrorReady: true,
    autobiographicalMemory: null, pendingPostcards: [], pendingWarden: [], inferPhase: 'idle',
    recentWorldHistory: calls.history, STATE_DIR: 'offline', CONTEXT_CONSUMERS: { AWG: 'AWG' },
    backgroundTempoGate: { claimAwgReservation: () => true },
    buildBrokerContext: () => ({ ok: true, rendering: 'grounded world', inspection: { summary: {} } }),
    plausibleCastAtLocation: () => [{ key: 'bill' }, { key: 'bailey' }],
    captureAwgRequest: () => null, captureAwgResponse: (_dir, response) => response,
    captureAwgOutcome() { throw new Error('capture not armed'); },
    options: () => ({ num_predict: 192 }), config: { threads: 4 },
    activeProvider: () => ({ id: 'offline', model: 'fixture' }),
    rawGenerate: async request => {
      calls.model++; started.resolve();
      const value = await response.promise;
      calls.accounting.push({ purpose: request.purpose, completed: true });
      if (providerError) throw providerError;
      return JSON.stringify(value);
    },
    randomUUID: () => `offline-${++serial}`,
    tsNow: date => new Date(date || clock.now).toISOString(),
    londonParts: () => ({ mins: clock.minutes }), effectiveAsleep: () => clock.asleep,
    reconcileObjectIncidentThreads() {},
    emit: event => calls.events.push(copy(event)),
    saveVitals: async (_path, value) => {
      calls.saves.push(copy(value));
      if (checkpoint) await checkpoint(value, calls, clock);
    },
    vitalsPath: 'offline', reportPersistenceError: (_where, error) => { throw error; },
    createEnvironmentEvent: (kind, options) => {
      if (kind === 'cell_search') calls.searchProjection.push({ ...copy(options), occurredAt: options.timestamp });
      return createEnvironmentEvent(kind, options);
    },
    createEnvironmentRecord: (...args) => {
      const record = createEnvironmentRecord(...args); calls.records.push(record); return record;
    },
    observeEnvironmentRecord: (soma, record) => {
      calls.soma.push(record); return observeEnvironmentRecord(soma, record);
    },
    soma: Object.fromEntries([
      ['observeFeedingRecord', 'observeSomaFeedingRecord'],
      ['observeSomaticRecord', 'observeSomaSomaticRecord'],
      ['observeSocialContactRecord', 'observeSomaSocialContactRecord'],
      ['observeControllabilityRecord', 'observeSomaControllabilityRecord'],
      ['observeCurrentDefensiveContextRecord', 'observeSomaCurrentDefensiveContextRecord'],
      ['observeThreatLearningRecord', 'observeSomaThreatLearningRecord'],
    ].map(([method, fn]) => [method, record => somaModule[fn](somaState, record)])),
    journalSubjectFromWorldRecord: () => null,
    rememberEnvironmentRecord: record => calls.memory.push(record),
    captureEpisodeEvent: event => { calls.searchProjection.push(copy(event)); return {}; },
    publishEpisodeEvent() {},
    // Old control uses this after its checkpoint, so expose its real transition.
    beginCellSearch: (now, { actor }) => {
      const started = location.startCellSearchEpisode(vitals.locationRegime, {
        nowMs: now, actorId: actor?.key, actorName: actor?.name });
      vitals.locationRegime = started.state;
      calls.searchProjection.push(started.event);
    },
  };
  Object.defineProperty(sandbox, 'running', { get: () => clock.running });
  Object.defineProperty(sandbox, 'regimeEpoch', { get: () => clock.regimeEpoch });
  const capture = runtime.slice(runtime.indexOf('  function captureEnvironmentEvent('),
    runtime.indexOf('  function rememberEnvironmentRecord('));
  const publisher = runtime.slice(runtime.indexOf('  function publishEpisodeEvent('),
    runtime.indexOf('  function queueExerciseEvent('));
  const api = runInNewContext(`(function() { ${capture}\n${publisher}\nreturn { run: ${body(runtime)}, captureEnvironmentEvent }; })()`, sandbox);
  return { vitals, clock, calls, client, somaState, capture: api.captureEnvironmentEvent, async start() {
    const result = api.run(600000, {});
    await started.promise;
    return { result, finish() { response.resolve(raw || proposal(search)); } };
  } };
}
function move(f, id) {
  f.clock.now += 1000;
  f.vitals.locationRegime.current = { ...f.vitals.locationRegime.current, id,
    entered_at: new Date(f.clock.now).toISOString() };
  f.vitals.locationRegime.lastTransitionAt = new Date(f.clock.now).toISOString();
}
async function complete(f, change = () => {}) {
  const pending = await f.start();
  change(f);
  pending.finish();
  return pending.result;
}
function assertDiscard(f, result) {
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.run.rejectionReason, 'STALE_LOCATION_REGIME');
  assert.equal(result.applied, null);
  for (const key of ['records', 'history', 'soma', 'social', 'memory', 'expression', 'searchProjection']) {
    assert.equal(f.calls[key].length, 0, key);
  }
  assert.equal(f.calls.events.filter(event => event.kind !== 'awg_run_record').length, 0);
  assert.equal(f.calls.model, 1, 'no repair or replacement');
  assert.equal(f.calls.accounting.length, 1, 'spent inference remains accounted');
  assert.equal(f.vitals.worldSimulation.recentAccepted.length, 0);
  assert.equal(f.vitals.worldSimulation.threads.length, 0);
  assert.equal(f.vitals.worldSimulation.objects.length, 0);
  assert.deepEqual(Array.from(result.run.createdWorldEventIds), []);
  assert.deepEqual(Array.from(result.run.threadChanges), []);
  assert.equal(f.vitals.worldSimulation.lastRunAt, new Date(at).toISOString());
  assert.equal(f.vitals.worldSimulation.recentRuns.at(-1).validationStatus, 'REJECTED');
}

test('unchanged CELL context commits through the existing world/publication path', async () => {
  const f = fixture(); const result = await complete(f);
  assert.equal(result.status, 'ACCEPTED', JSON.stringify(result.run));
  assert.equal(f.calls.records.length, 1);
  assert.equal(f.calls.events.filter(event => event.kind === 'event').length, 1);
  assert.equal(f.calls.model, 1);
  assert.equal(f.calls.saves.length, 1);
});
test('natural association failure shape is rejected, without holding movement', async () => {
  const f = fixture();
  const result = await complete(f, f => move(f, 'ASSOCIATION'));
  assert.equal(f.vitals.locationRegime.current.id, 'ASSOCIATION');
  assertDiscard(f, result);
});
test('CELL -> YARD -> CELL is not the original eligible entry', async () => {
  const f = fixture();
  assertDiscard(f, await complete(f, f => { move(f, 'EXERCISE_YARD'); move(f, 'CELL'); }));
});
test('natural Bailey search failure shape cannot commit an incompatible interaction', async () => {
  const f = fixture();
  const result = await complete(f, f => {
    f.clock.now = Date.parse('2026-10-28T08:04:52.670Z');
    f.vitals.locationRegime = location.startCellSearchEpisode(f.vitals.locationRegime, {
      nowMs: f.clock.now, actorId: 'bailey', actorName: 'Miss Bailey' }).state;
  });
  assertDiscard(f, result);
  assert.equal(f.vitals.locationRegime.searchEpisode.actor_id, 'bailey');
});
for (const kind of ['search', 'lockdown']) {
  for (const completed of [false, true]) {
    test(`${kind} starting${completed ? ' and ending' : ''} during inference invalidates CELL work`, async () => {
      const f = fixture();
      const result = await complete(f, f => {
        const field = kind === 'search' ? 'searchEpisode' : 'lockdownEpisode';
        f.vitals.locationRegime[field] = { id: 'new-restriction', started_at: new Date(at + 1000).toISOString(),
          status: completed ? 'COMPLETE' : 'ACTIVE' };
      });
      assertDiscard(f, result);
    });
  }
}
for (const kind of ['sleep', 'regime round-trip', 'pause', 'shutdown']) {
  test(`${kind} during inference cannot commit a stale result`, async () => {
    const f = fixture();
    assertDiscard(f, await complete(f, f => {
      if (kind === 'sleep') f.clock.asleep = true;
      if (kind === 'regime round-trip') f.clock.regimeEpoch += 2;
      if (kind === 'pause') f.client.paused = true;
      if (kind === 'shutdown') f.clock.running = false;
    }));
  });
}
test('ordinary links, observation counters and body drift do not invalidate eligibility', async () => {
  const f = fixture();
  const result = await complete(f, f => {
    f.vitals.hunger = 0.4;
    f.vitals.locationRegime = location.registerEpisodeEvent(f.vitals.locationRegime, 'unrelated-observation');
    f.vitals.locationRegime.current.reason = 'same entry, diagnostic wording';
  });
  assert.equal(result.status, 'ACCEPTED');
});
test('accepted occurrence retains commit time when movement occurs during checkpoint delivery', async () => {
  const saved = deferred(), release = deferred();
  const f = fixture({ checkpoint: async () => { saved.resolve(); await release.promise; } });
  const p = await f.start(); p.finish(); await saved.promise;
  assert.equal(f.calls.events.filter(event => event.kind !== 'awg_run_record').length, 0,
    'checkpoint still precedes external delivery');
  assert.equal(f.calls.memory.length, 0, 'formation not admitted before checkpoint');
  move(f, 'ASSOCIATION'); release.resolve();
  assert.equal((await p.result).status, 'ACCEPTED');
  assert.equal(f.calls.records[0].world_event.timestamp, new Date(at).toISOString());
  assert.equal(f.calls.events.find(event => event.kind === 'event').ts, new Date(at).toISOString());
  assert.equal(f.vitals.locationRegime.current.id, 'ASSOCIATION');
});
test('generated search is established before checkpoint, never started later off-cell', async () => {
  const saved = deferred(), release = deferred();
  const f = fixture({ search: true, checkpoint: async () => { saved.resolve(); await release.promise; } });
  const p = await f.start(); p.finish(); await saved.promise;
  assert.equal(f.vitals.locationRegime.searchEpisode.status, 'ACTIVE');
  assert.equal(f.calls.saves[0].locationRegime.searchEpisode.started_at, new Date(at).toISOString());
  move(f, 'ASSOCIATION'); release.resolve();
  assert.equal((await p.result).status, 'ACCEPTED');
  assert.equal(f.calls.searchProjection[0].occurredAt, new Date(at).toISOString());
  assert.equal(f.vitals.locationRegime.current.id, 'ASSOCIATION');
});
test('delayed search delivery cannot register against newer search or regime episodes', async () => {
  const saved = deferred(), release = deferred();
  const f = fixture({ search: true, checkpoint: async () => { saved.resolve(); await release.promise; } });
  const p = await f.start(); p.finish(); await saved.promise;
  const committedId = f.vitals.locationRegime.searchEpisode.id;
  f.vitals.locationRegime.searchEpisode.status = 'COMPLETE';
  f.vitals.locationRegime = location.startCellSearchEpisode(f.vitals.locationRegime, {
    nowMs: at + 60000, actorId: 'locke', actorName: 'Mr Locke', makeId: () => 'new-search' }).state;
  f.vitals.locationRegime.lockdownEpisode = { id: 'later-lockdown', linked_event_ids: [] };
  f.vitals.locationRegime.activeRoutineEpisode = { id: 'later-routine', event_ids: [] };
  f.vitals.locationRegime.activeExerciseEpisode = { id: 'later-exercise', event_ids: [] };
  f.vitals.locationRegime.activeRegimeEpisode = { id: 'later-regime', event_ids: [] };
  release.resolve(); await p.result;
  assert.equal(f.calls.searchProjection[0].world.search_episode.id, committedId);
  assert.deepEqual(f.vitals.locationRegime.searchEpisode.linked_event_ids, []);
  assert.deepEqual(f.vitals.locationRegime.lockdownEpisode.linked_event_ids, []);
  assert.deepEqual(f.vitals.locationRegime.activeRoutineEpisode.event_ids, []);
  assert.deepEqual(f.vitals.locationRegime.activeExerciseEpisode.event_ids, []);
  assert.deepEqual(f.vitals.locationRegime.activeRegimeEpisode.event_ids, []);
});
test('delayed search receipt attaches only to its own still-current search identity', async () => {
  const f = fixture({ search: true });
  assert.equal((await complete(f)).status, 'ACCEPTED');
  assert.deepEqual(f.vitals.locationRegime.searchEpisode.linked_event_ids,
    [f.calls.records[0].world_event.id]);
});
test('checkpoint delay cannot deliver an old opening back into a completed real Soma search context', async () => {
  const saved = deferred(), release = deferred();
  const f = fixture({ search: true, checkpoint: async () => { saved.resolve(); await release.promise; } });
  const p = await f.start(); p.finish(); await saved.promise;
  const id = f.vitals.locationRegime.searchEpisode.id;
  const key = `custody:cell_search:${id}`;
  assert.ok(Object.keys(f.somaState.currentDefensiveContext.contexts).some(item => item.includes(key)));
  while (f.vitals.locationRegime.searchEpisode.status === 'ACTIVE') {
    f.clock.now += 15000;
    const next = location.advanceCellSearchEpisode(f.vitals.locationRegime, { nowMs: f.clock.now, force: true });
    f.vitals.locationRegime = next.state;
    if (next.event) {
      const event = next.event;
      const record = createEnvironmentRecord(createEnvironmentEvent('cell_search', {
        id: `scheduler:${event.eventType}`, timestamp: event.occurredAt, eventType: event.eventType,
        world: event.world, observation: event.observation,
      }));
      somaModule.observeSomaCurrentDefensiveContextRecord(f.somaState, record);
    }
  }
  const before = copy(f.somaState.currentDefensiveContext);
  assert.equal(Object.keys(before.contexts).some(item => item.includes(key)), false);
  const observations = f.calls.soma.length;
  release.resolve(); await p.result;
  assert.deepEqual(f.somaState.currentDefensiveContext, before, 'delivery cannot re-observe the opening');
  assert.equal(f.calls.soma.length, observations);
});
test('checkpoint failure delivers no world/public records or memory input', async () => {
  const f = fixture({ checkpoint: async () => { throw new Error('offline checkpoint failure'); } });
  await assert.rejects(complete(f), /offline checkpoint failure/);
  assert.equal(f.calls.events.filter(event => event.kind !== 'awg_run_record').length, 0);
  assert.equal(f.calls.memory.length, 0);
  assert.equal(f.calls.model, 1);
});
test('ordinary canonical capture defaults still publish and remember without a buffer', async () => {
  const f = fixture();
  f.capture('ambient_world_event', { eventType: 'ordinary_event', summary: 'A key turned.' });
  assert.equal(f.calls.events.filter(event => event.kind === 'world_event_record').length, 1);
  assert.equal(f.calls.memory.length, 1);
});
test('historical source guards reverse only the exact separately tested AWG regions', () => {
  const old = path => execFileSync('git', ['show', `${BASE}:${path}`], { encoding: 'utf8', maxBuffer: 2 ** 23 })
    .replace(/\r\n/g, '\n');
  const text = source.replace(/\r\n/g, '\n');
  assert.equal(beforeAwgCurrentContext(text), old('runner/run.js'));
  assert.equal(beforeAwgLocationFence(readFileSync(new URL('./location-regime.js', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')), old('runner/location-regime.js'));
  assert.throws(() => beforeAwgCurrentContext(text.replace('    const committedAt = tsNow();',
    '    const committedAt = unsafeClock();')), /exact approved AWG context-boundary delta/);
  assert.notEqual(beforeAwgCurrentContext(text.replace('  async function streamGenerate(',
    '  async function unreviewedJournalChange(')), old('runner/run.js'));
});
test('restart state carries no prepared candidate/fence and shutdown rejects old completion', async () => {
  const f = fixture(); const persisted = copy(f.vitals.worldSimulation);
  const p = await f.start();
  const restored = awg.reconcileWorldSimulationState(persisted);
  assert.deepEqual(restored.recentAccepted, []);
  assert.equal('applied' in restored, false);
  assert.equal('admittedLocationFence' in restored, false);
  f.clock.running = false; p.finish(); assertDiscard(f, await p.result);
});
for (const outcome of ['NO_EVENT', 'REJECTED', 'FAILED']) {
  test(`${outcome} adopts only attempt metadata, preserving concurrent live world state`, async () => {
    const f = fixture({
      raw: outcome === 'NO_EVENT' ? { decision: 'NO_EVENT' }
        : outcome === 'REJECTED' ? { ...proposal(), objective: {
          eventType: 'social_request', summary: 'Bill asks Cy a question in the exercise yard.' } } : null,
      providerError: outcome === 'FAILED' ? new Error('offline provider failure') : null,
    });
    const result = await complete(f, f => {
      f.vitals.worldSimulation.objects.push({ id: 'live-object', type: 'note', status: 'ACTIVE', location: 'cell' });
      f.vitals.locationRegime = location.startCellSearchEpisode(f.vitals.locationRegime, {
        nowMs: at + 1000, actorId: 'bailey', actorName: 'Miss Bailey' }).state;
    });
    assert.equal(result.status, outcome, JSON.stringify(result.run));
    assert.equal(f.vitals.worldSimulation.objects[0].id, 'live-object');
    assert.equal(f.vitals.locationRegime.searchEpisode.actor_id, 'bailey');
    assert.equal(f.calls.records.length, 0);
    assert.equal(f.calls.model, 1);
  });
}
test('decisive authority check and logical world/search commit contain no async yield', () => {
  const text = body(source);
  const begin = text.indexOf("if (result.status === 'ACCEPTED' && (!admittedLocationFence");
  const end = text.indexOf('if (awgCaptureDir) captureAwgOutcome', begin);
  assert.ok(begin > 0 && end > begin);
  assert.doesNotMatch(text.slice(begin, end), /\bawait\b/);
  assert.match(text.slice(begin, end), /awgLocationFence\(vitals.locationRegime\)/);
  assert.ok(text.indexOf('captureEnvironmentEvent(') < text.indexOf('await saveVitals'));
  assert.ok(text.indexOf('await saveVitals') < text.indexOf('for (const publication of publications)'));
  assert.doesNotMatch(text.slice(text.indexOf('await saveVitals')), /beginCellSearch\(/);
});
test('unchanged production control reproduces both natural stale commit shapes offline', async () => {
  const old = execFileSync('git', ['show', `${BASE}:runner/run.js`], { encoding: 'utf8', maxBuffer: 2 ** 23 });
  for (const mutate of [f => move(f, 'ASSOCIATION'), f => {
    f.vitals.locationRegime = location.startCellSearchEpisode(f.vitals.locationRegime, {
      nowMs: at + 1000, actorId: 'bailey', actorName: 'Miss Bailey' }).state;
  }]) {
    const f = fixture({ runtime: old });
    assert.equal((await complete(f, mutate)).status, 'ACCEPTED');
    assert.equal(f.calls.records.length, 1, 'old source published the stale event');
  }
});
