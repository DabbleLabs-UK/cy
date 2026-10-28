import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Client } from './client.js';
import { beforeJournalMemoryLeadtime } from './fixtures/journal-memory-leadtime-source.mjs';

const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('historical source guards permit only the exact reviewed preparation wiring deltas', () => {
  for (const path of ['run.js', 'client.js']) {
    const current = readFileSync(new URL(`./${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const previous = execFileSync('git', ['show', `8363197d805e672ee59582ce0b1d0d88f14c3e48:runner/${path}`],
      { encoding: 'utf8' }).replace(/\r\n/g, '\n');
    assert.equal(beforeJournalMemoryLeadtime(current), previous, path);
  }
  assert.throws(() => beforeJournalMemoryLeadtime(source.replace(
    'autobiographicalMemory.observeJournalCue(recallRecord);', 'unreviewedMutation(recallRecord);')),
  /exact approved journal preparation wiring delta/);
});

test('observed cue capture is independent of formation and authorizes only on delivered records', () => {
  const remember = between('  function rememberEnvironmentRecord(record,', '  function captureEpisodeEvent');
  assert.ok(remember.indexOf('observeJournalCue(recallRecord)') < remember.indexOf('environmentFormationAdmission(record)'));
  assert.doesNotMatch(remember, /enqueueMemorySurfacing|requestWorkingContext|acknowledgeJournalCues/);
  const delivered = between('  client.onDelivered = (events)', '  // The checkpoint owns');
  assert.match(delivered, /autobiographicalMemory\.acknowledgeJournalCues\(events\)/);
  assert.doesNotMatch(source, /pendingMemoryQuery|refreshPendingMemory/);
});

test('startup recovery never creates a fresh recall cue and formation still receives its original source', () => {
  const remember = between('  function rememberEnvironmentRecord(record,', '  function captureEpisodeEvent');
  const calls = { observed: [], formation: [] };
  const wiring = new Function('autobiographicalMemory', 'sourceFromEnvironmentRecord', 'environmentFormationAdmission',
    `let journalCueObservationReady = false; ${remember}
     return { rememberEnvironmentRecord, ready() { journalCueObservationReady = true; } };`)(
    { observeJournalCue: value => calls.observed.push(value), queueSource: value => {
      calls.formation.push(value); return Promise.resolve();
    } }, record => record.source, () => ({ admit: true }),
  );
  const restored = { source: { sourceId: 'restored-source' } };
  wiring.rememberEnvironmentRecord(restored);
  assert.deepEqual(calls.observed, [], 'checkpoint-recovered delivery does not establish a new desired cue');
  assert.deepEqual(calls.formation, [restored.source], 'existing source formation remains available during recovery');
  wiring.ready();
  const original = { source: { sourceId: 'new-formation-source' } };
  const markedProjection = { source: { sourceId: 'new-projected-cue' }, consumed_by: ['soma-input-staging-v1'] };
  wiring.rememberEnvironmentRecord(original, markedProjection);
  assert.equal(calls.observed[0], markedProjection);
  assert.equal(calls.formation[1], original.source, 'recall projection cannot replace the formation source');
  wiring.rememberEnvironmentRecord(original, null);
  assert.equal(calls.observed.length, 1, 'missing outbound projection is not replaced by an unmarked record');
  assert.equal(calls.formation.length, 3);
  const recovery = source.indexOf('  recoverMeals(vitals.mealChoice, mealCallbacks);');
  const recoveryEnd = source.indexOf('  // YARD TURN END: startup reconciliation', recovery);
  const ready = source.indexOf('  journalCueObservationReady = true;');
  const tick = source.indexOf('  const tickTimer = setInterval(', recovery);
  assert.ok(recovery >= 0 && recovery < recoveryEnd && recoveryEnd < ready && ready < tick);
  assert.match(source.slice(recovery, recoveryEnd), /await checkpointMeals\(\);[\s\S]*?recoverYardTurns[\s\S]*?await checkpointYardTurns\(\);[\s\S]*?noteYardHistory\(record\)/);
  assert.equal((source.match(/journalCueObservationReady = true;/g) || []).length, 1);
  assert.match(source, /let journalCueObservationReady = false;/);
});

test('yard recall uses only the exact marked outbound projection while formation keeps its immutable source', () => {
  const yard = between('  async function checkpointYardTurns()', '  function yardTurnDiagnostic');
  const start = yard.indexOf('      remember: ');
  const end = yard.indexOf(',\n      remembered:', start);
  assert.ok(start >= 0 && end > start);
  const expression = yard.slice(start + '      remember: '.length, end);
  const calls = [];
  const remember = new Function('rememberEnvironmentRecord', `return ${expression};`)(
    (record, projection) => calls.push({ record, projection }),
  );
  const record = { world_event: { id: 'actual-yard-outcome' } };
  const marked = { world_event: { id: record.world_event.id }, consumed_by: ['soma-input-staging-v1'] };
  const unrelated = { world_event: { id: 'other-yard-outcome' }, consumed_by: ['soma-input-staging-v1'] };
  remember(record, { pendingEvents: [
    { kind: 'world_event_record', payload: unrelated },
    { kind: 'world_event_record', payload: marked },
  ] });
  assert.equal(calls[0].record, record);
  assert.equal(calls[0].projection, marked);
  remember(record, { pendingEvents: [{ kind: 'world_event_record', payload: unrelated }] });
  assert.equal(calls[1].projection, null);
  assert.equal(calls[1].record, record);
});

test('journal reservation retains idle admission while ordinary surfacing retains both quiet gates', () => {
  const body = between('    canRunBackground: (kind)', '    backgroundWaitMs:');
  const expression = body.slice(body.indexOf('=>') + 2).trim().replace(/,$/, '');
  const allowed = (kind, { idle = true, eligible = true, cell = true, asleep = false, quiet = 10, gate = false } = {}) => {
    const callback = new Function('inferPhase', 'genericMemoryAvailability', 'vitals', 'LOCATIONS',
      'effectiveAsleep', 'londonParts', 'inferenceTempoPacer', 'client', 'backgroundTempoGate',
      'currentMode', 'pendingPostcards', 'pendingWarden', 'isAwgDue', `return kind => (${expression});`)(
      idle ? 'idle' : 'busy', () => ({ allowed: eligible }), { locationRegime: { current: { id: cell ? 'CELL' : 'YARD' } }, worldSimulation: {} },
      { CELL: 'CELL' }, () => asleep, () => ({ mins: 0 }), { remaining: () => quiet },
      { paused: false, tempo: { speed: 30 } }, { canStart: () => gate }, 'journal', [], [], () => false,
    );
    return callback(kind);
  };
  assert.equal(allowed('journal_preparation'), true);
  assert.equal(allowed('surfacing'), false);
  assert.equal(allowed('formation'), false);
  assert.equal(allowed('surfacing', { quiet: 0, gate: true }), true);
  for (const denied of [{ idle: false }, { eligible: false }, { cell: false }, { asleep: true }]) {
    assert.equal(allowed('journal_preparation', denied), false);
  }
});

test('reservation dispatch is background, preemptible and fenced by the private current reservation', () => {
  const generation = between('    generate: (call) => rawGenerate', '    contextBroker:');
  assert.match(generation, /journalPreparationReservation: call\.journalPreparationReservation \|\| null/);
  assert.match(generation, /validJournalReservation\(call\.journalPreparationReservation\)/);
  assert.match(generation, /genericMemoryAvailability\(\{ ownInference: true \}\)\.allowed/);
  const raw = between('  async function rawGenerate', '  function brokerItems');
  assert.match(raw, /background && purpose === 'memory_surfacing'\s*&& autobiographicalMemory\.validJournalReservation\(journalPreparationReservation\)/);
  assert.match(raw, /inferenceCoordinator\.acquire/);
  assert.match(raw, /provider\.acquireSharedLease/);
  assert.equal((raw.match(/requireInferenceEligibility\(isEligible, ac\)/g) || []).length, 2);
  assert.match(raw, /backgroundTempoGate\.recordBackgroundWork/);
  assert.match(raw, /inferenceTempoPacer\.record/);
  assert.match(raw, /if \(!background && !awgInReservedIdle\)/);
  const wing = between("    recordIncident('wing',", '  async function fireScheduled(');
  assert.match(wing, /autobiographicalMemory\.interruptJournalPreparation\('wing-noise'\)/);
});

test('existing persisted opportunity anchor is bound before cadence advances', () => {
  const start = source.indexOf('autobiographicalMemory.beginJournalOpportunity(');
  assert.ok(start > 0);
  assert.match(source.slice(start, start + 300), /beginJournalOpportunity\(vitals\.expressiveCadence\.lastOpportunityAtMs\);\s*vitals\.expressiveCadence = recordExpressiveOpportunity/);
  const callback = between('    journalPreparationContext: () =>', '    onGenericService:');
  assert.match(callback, /const slotAnchorMs = vitals\.expressiveCadence\.lastOpportunityAtMs/);
  assert.match(callback, /dueAtMs: nowMs \+ wakingOpportunityWaitMs\(slotAnchorMs, nowMs, client\.tempo\.speed\)/);
  assert.doesNotMatch(callback, /inferPhase/);
});

test('subject alignment is selected once before synchronous journal-only consumption and freeze', () => {
  const freeze = between('      let burstJournalTurn = null;', '      const baseOpts =');
  assert.equal((freeze.match(/selectJournalTurn\(/g) || []).length, 1);
  assert.ok(freeze.indexOf('selectJournalTurn(') < freeze.indexOf('consumeJournalPreparation('));
  assert.ok(freeze.indexOf('consumeJournalPreparation(') < freeze.indexOf('buildCtx(cognition'));
  assert.match(freeze, /sourceEventId: burstJournalTurn\.sourceEventId/);
  assert.match(freeze, /wakingJournalContext: true,\s*journalMemory/);
  assert.doesNotMatch(freeze, /await|requestWorkingContext|enqueueMemorySurfacing/);
  assert.ok(freeze.indexOf('buildDirectives(') < freeze.indexOf('finishJournalOpportunity()'));
  const retry = between('      const baseOpts =', '      const burstMs =');
  assert.doesNotMatch(retry, /consumeJournalPreparation|selectJournalTurn|buildCtx\(/);
});

test('explicit empty journal memory does not fall back to global working state', () => {
  const line = source.match(/    const memories = postcardMemory[^;]+;/)[0];
  const resolve = new Function('postcardMemory', 'journalMemory', 'memoryCandidates', 'autobiographicalMemory',
    `${line} return memories;`);
  const global = [{ id: 'unrelated-global-memory' }];
  assert.deepEqual(resolve(null, { selected: [] }, [], { working: { selected: global } }), []);
  const journal = [{ id: 'cue-bound-memory' }];
  assert.deepEqual(resolve(null, { selected: journal }, [], { working: { selected: global } }), journal);
  assert.deepEqual(resolve(null, null, [], { working: { selected: global } }), global);
  assert.deepEqual(resolve({ enrichment: { selected: global } }, { selected: journal }, [], null), global);
  const ctx = between('  function buildCtx(', '  // ---- postcard mode:');
  assert.match(ctx, /const memory = brokerOptions\.journalMemory \|\| \(brokerOptions\.postcardMemory/);
  assert.match(ctx, /\.\.\.brokerOptions,/);
});

test('drawing and silence close without consuming journal preparation and closure precedes journal pacing', () => {
  for (const boundary of ["      if (selectedAction === 'draw')", "      if (selectedAction === 'silence')"]) {
    const start = source.indexOf(boundary, source.indexOf('const cycleInferenceStart = Date.now();'));
    assert.ok(start >= 0, boundary);
    assert.match(source.slice(start, start + boundary.length + 90), /finishJournalOpportunity\(\)/);
  }
  const chooser = between('      const choiceContext =', '      // Zone A is');
  assert.match(source, /if \(hasDrawRequest\) \{\s*autobiographicalMemory\.finishJournalOpportunity\(\{ closeUpcoming: true \}\);/,
    'an external drawing closes any upcoming admitted slot, not only an already-begun opportunity');
  assert.doesNotMatch(chooser, /consumeJournalPreparation|journalMemory:/);
  assert.match(source, /finally \{\s*autobiographicalMemory\.finishJournalOpportunity\(\);\s*releaseMaintenance\(\)/);
});

test('prepared API proof is optional for existing consumers and is carried exactly for journal preparation', async () => {
  const client = Object.create(Client.prototype);
  const sent = [];
  client._memoryRequest = async (action, value) => { sent.push({ action, value }); return {}; };
  await client.getPreparedMemorySet({ contextFingerprint: 'legacy' });
  await client.consumePreparedMemorySet({ preparedSetId: 1, generationRef: 'legacy' });
  assert.equal(Object.hasOwn(sent[0].value, 'journal_preparation'), false);
  assert.equal(Object.hasOwn(sent[1].value, 'journal_preparation'), false);
  const proof = { version: 'cy.journal-preparation.v1', slotKey: 'exact-slot', cue: { digest: 'exact-cue' } };
  await client.getPreparedMemorySet({ contextFingerprint: 'slot', journalPreparation: proof });
  await client.consumePreparedMemorySet({ preparedSetId: 2, generationRef: 'journal:2', journalPreparation: proof });
  assert.deepEqual(sent[2].value.journal_preparation, proof);
  assert.deepEqual(sent[3].value.journal_preparation, proof);
  await client.queryMemories({ query: { text: 'cue' }, journalPreparation: proof });
  assert.deepEqual(sent[4].value.journal_preparation, proof);
  await client.queryMemories({ query: { text: 'legacy' } });
  assert.equal(Object.hasOwn(sent[5].value, 'journal_preparation'), false);
});
