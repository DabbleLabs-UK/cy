import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaintenanceGate } from './maintenance-gate.js';
import { AutobiographicalMemoryRuntime } from './memory-runtime.js';
import { Client } from './client.js';
import { loadPostcardSenderContinuity } from './postcard-memory.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'cy-maintenance-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const gate = new MaintenanceGate({ directory });
  return { directory, gate,
    hold: () => writeFileSync(join(directory, 'request.json'), JSON.stringify({ version: 1, id: 'fixture' })),
    resume: () => rmSync(join(directory, 'request.json')) };
}

test('default off performs no filesystem work and releases idempotently', () => {
  const gate = new MaintenanceGate({ directory: '', fs: new Proxy({}, { get() { throw new Error('unexpected I/O'); } }) });
  const release = gate.enter();
  assert.equal(gate.active, 1);
  release(); release();
  assert.equal(gate.active, 0);
});

test('startup remains held before recovery, then its full initialization is counted if hold returns', t => {
  const { directory, gate, hold, resume } = fixture(t);
  hold();
  assert.equal(gate.enter(), null, 'startup cannot load or recover live state yet');
  assert.equal(gate.refresh().state, 'held');
  resume();
  const finishStartup = gate.enter();
  hold();
  assert.equal(gate.refresh().state, 'draining', 'in-progress startup is not a false held acknowledgement');
  assert.equal(JSON.parse(readFileSync(join(directory, 'cy-status.json'), 'utf8')).active, 1);
  finishStartup();
  assert.equal(gate.refresh().state, 'held');
});

test('request drains admitted work, blocks new work, survives restart, explicitly resumes', t => {
  const { directory, gate, hold, resume } = fixture(t);
  const release = gate.enter();
  hold();
  assert.equal(gate.refresh().state, 'draining');
  assert.equal(gate.enter(), null);
  assert.equal(gate.active, 1);
  release();
  assert.equal(gate.refresh().state, 'held');
  assert.equal(new MaintenanceGate({ directory }).enter(), null);
  const persisted = JSON.parse(readFileSync(join(directory, 'cy-status.json'), 'utf8'));
  assert.equal(persisted.requestId, 'fixture');
  assert.equal(persisted.active, 0);
  assert.deepEqual(Object.keys(persisted).sort(), ['active', 'pid', 'requestId', 'state', 'updatedAt', 'version']);
  resume();
  const next = gate.enter();
  assert.equal(typeof next, 'function');
  next();
});

test('malformed requests and status write failures fail closed, never claim held', t => {
  const { directory, gate } = fixture(t);
  writeFileSync(join(directory, 'request.json'), '{');
  assert.equal(gate.refresh().state, 'error');
  assert.equal(gate.enter({ drainExisting: true }), null);
  const failing = new MaintenanceGate({ directory, fs: {
    statSync() { return { isDirectory: () => true }; },
    readFileSync() { throw Object.assign(new Error(), { code: 'ENOENT' }); },
    writeFileSync() { throw new Error('denied'); },
  } });
  assert.equal(failing.refresh().state, 'error');
  assert.equal(failing.enter(), null);
  const missing = new MaintenanceGate({ directory: join(directory, 'absent') });
  assert.equal(missing.refresh().state, 'error');
  assert.equal(missing.enter(), null);
});

test('already-claimed inbox units must settle before held', t => {
  const { gate, hold } = fixture(t);
  let pending = 1;
  gate.additionalActive = () => pending;
  hold();
  assert.equal(gate.refresh().state, 'draining');
  const finish = gate.enter({ drainExisting: true });
  pending = 0;
  assert.equal(gate.refresh().state, 'draining');
  finish();
  assert.equal(gate.refresh().state, 'held');
});

test('memory hold is before claims, provider timers and cadence bookkeeping; admitted work drains', async t => {
  const { gate, hold, resume } = fixture(t);
  let claims = 0;
  let finished = 0;
  let releaseWork;
  const work = new Promise(resolve => { releaseWork = resolve; });
  const runtime = new AutobiographicalMemoryRuntime({ maintenance: gate, client: {
    async claimMemorySource() { claims++; return { job: { id: 1 } }; },
    async claimMemorySurfacing() { throw new Error('unexpected claim'); },
  }, makeId: () => 'fixture', generate: () => { throw new Error('unexpected inference'); } });
  runtime.stopped = false;
  runtime.schedule = () => {};
  runtime.processFormation = async () => { await work; finished++; };
  const active = runtime.runTick();
  await Promise.resolve();
  hold();
  assert.equal(gate.refresh().state, 'draining');
  await runtime.runTick();
  assert.equal((await runtime.serviceAgedSenderBeforeExpression()).reason, 'MAINTENANCE');
  assert.equal((await runtime.serviceGenericDuringIdle({ idleBudgetMs: 5000 })).reason, 'MAINTENANCE');
  assert.equal(claims, 1);
  assert.equal(runtime.lastReservedSenderAt, 0);
  assert.equal(runtime.nextGenericAt, 0);
  assert.equal(runtime.interruptReason, null);
  releaseWork(); await active;
  assert.equal(finished, 1);
  assert.equal(gate.refresh().state, 'held');
  resume();
  await runtime.runTick();
  assert.equal(claims, 2);
});

test('held inbox never fetches or consumes queued input; admitted inbox remains counted', async t => {
  const { directory, gate, hold, resume } = fixture(t);
  const client = new Client({ dryRun: true }, directory);
  client.maintenance = gate;
  let polls = 0;
  let releasePoll;
  client.pollAdmittedInbox = async () => { polls++; await new Promise(resolve => { releasePoll = resolve; }); };
  const admitted = client.pollInbox();
  hold();
  assert.equal(gate.refresh().state, 'draining');
  await client.pollInbox();
  assert.equal(polls, 1);
  releasePoll(); await admitted;
  assert.equal(gate.refresh().state, 'held');
  resume();
});

test('orchestrator holds before startup recovery and wraps the full generation iteration', () => {
  const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('while (!releaseStartup)') < source.indexOf('await loadVitals(vitalsPath)'));
  assert.ok(source.indexOf('releaseStartup();') > source.indexOf('client.start();'));
  assert.match(source, /drainExisting: pendingPostcards.length > 0 \|\| pendingWarden.length > 0/);
  assert.match(source, /finally \{ releaseMaintenance\(\); \}/);
  assert.match(source, /if \(maintenanceState === 'held' \|\| maintenanceState === 'error'\) return/);
  assert.match(source, /const releaseSync = maintenance.enter\(\)/);
  assert.match(source, /persistence\?\.pending \|\| persistence\?\.inProgress/);
});

test('status failure at the final admission acknowledgement refuses dispatch', t => {
  const { directory } = fixture(t);
  let writes = 0;
  const gate = new MaintenanceGate({ directory, fs: {
    statSync: () => ({ isDirectory: () => true }),
    readFileSync() { throw Object.assign(new Error(), { code: 'ENOENT' }); },
    writeFileSync() { if (++writes === 2) throw new Error('disk failed'); },
    renameSync() {},
  } });
  assert.equal(gate.enter(), null);
  assert.equal(gate.active, 0);
  assert.equal(gate.error, true);
});

test('a claimed postcard drains its canonical memory read while new inference admissions are held', async t => {
  const { directory, gate, hold } = fixture(t);
  const client = new Client({ dryRun: true }, directory);
  client.maintenance = gate;
  gate.additionalActive = () => client.maintenancePending();
  const finishTurn = gate.enter();
  hold();
  const continuity = await loadPostcardSenderContinuity({ client, visitorId: 'fixture-sender' });
  assert.equal(continuity.ready, true);
  assert.equal(continuity.status, 'NO_STORED_MEMORIES');
  assert.equal(gate.refresh().state, 'draining');
  // Existing primary inference/result handling belongs to finishTurn, not a
  // new provider admission. Publish/flush is represented by the normal client.
  client.enqueue({ kind: 'postcard_out', payload: { id: 'fixture-postcard' } });
  finishTurn();
  assert.equal(gate.refresh().state, 'draining');
  await client.flush();
  assert.equal(gate.refresh().state, 'held');
  const events = readFileSync(client.eventsPath, 'utf8');
  assert.match(events, /fixture-postcard/);
  await client.flush();
  assert.equal(readFileSync(client.eventsPath, 'utf8'), events, 'held does not repeat delivery');
});

test('detached context preparation stays draining after its foreground deadline', async t => {
  const { gate, hold } = fixture(t);
  let completeRead;
  const read = new Promise(resolve => { completeRead = resolve; });
  let enqueued = 0;
  const runtime = new AutobiographicalMemoryRuntime({ maintenance: gate, client: {
    getPreparedMemorySet: () => read,
    async enqueueMemorySurfacing() { enqueued++; },
  }, makeId: () => 'fixture' });
  runtime.schedule = () => {};
  gate.additionalActive = () => runtime.pendingPreparations;
  await runtime.requestWorkingContext({ text: 'fixture' }, { deadlineMs: 1 });
  hold();
  assert.equal(gate.refresh().state, 'draining');
  completeRead({ prepared_set: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(enqueued, 1);
  assert.equal(gate.refresh().state, 'held');
});

test('durable delivery files and failed delivery keep maintenance unresolved', async t => {
  const { directory, gate, hold } = fixture(t);
  const client = new Client({ dryRun: true }, directory);
  client.maintenance = gate;
  gate.additionalActive = () => client.maintenancePending();
  writeFileSync(client.queuePath, '{"kind":"text"}\n');
  hold();
  assert.equal(gate.refresh().state, 'draining');
  writeFileSync(client.queuePath, '');
  client.enqueue({ kind: 'text', payload: { text: 'fixture' } });
  client._appendEvents = async () => { throw new Error('fixture disk failure'); };
  await assert.rejects(client.flush());
  assert.equal(gate.refresh().state, 'draining');
});
