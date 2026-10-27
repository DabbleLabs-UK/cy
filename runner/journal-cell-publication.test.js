import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import * as character from './character-output.js';
import * as wardenModule from './warden.js';
import { applyBurstSeparator, buildPromptRequest } from './prompt.js';
import { LOCATIONS, reconcileLocationRegimeState, reconcileRegimeLocation } from './location-regime.js';
import { recordJournalTerminationDiagnostic } from './journal-termination-telemetry.js';
import { sourceFromExpression } from './autobiographical-memory.js';
import { beforeJournalCellPublication } from './fixtures/journal-cell-publication-source.mjs';
import { generationHitTokenLimit } from './run.js';

const BASE = '95daf45c95c8be398745bbf6baaf6d32493173d2';
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const old = path => execFileSync('git', ['show', `${BASE}:${path}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).replace(/\r\n/g, '\n');
const run = source('runner/run.js');
const stop = { done: true, done_reason: 'stop', eval_count: 34 };
const sentence = 'heard the bolt. still wonderin bout it rn';
const at = Date.parse('2026-10-27T14:14:00.000Z');

function extract(text, first, last) {
  const a = text.indexOf(first), b = text.indexOf(last, a);
  assert.ok(a >= 0 && b > a, `runtime boundary: ${first}`);
  return text.slice(a, b);
}

// Run actual collection, character repair, staging, final validation, publication,
// outer retry, occurrence bookkeeping and expression-memory admission bodies.
// Every provider/transport/persistence sink is in-memory: no runner main or I/O.
function fixture({ text = sentence, stats = stop, runtime = run, mode = 'journal',
  continuation = 'prior subjective thought. ',
  beforeReturn = () => {}, duringStage = () => {}, duringRepeat = () => {} } = {}) {
  const calls = { model: 0, text: [], continuation: [], output: [], memory: [],
    formMemory: [], spend: [], outcomes: [], inference: [], termination: [], finished: [],
    cadence: [], prompts: [], saved: [] };
  const vitals = { locationRegime: reconcileLocationRegimeState(null, { nowMs: at, date: '2026-10-27', minutes: 854 }),
    expressiveCadence: {}, recentOpeners: [], lastJournalAtMs: 0, journalSubjectKeys: [] };
  const append = extract(runtime, '  async function appendContext(', '  // Shrink the effective context tail');
  const chunks = extract(runtime, '  async function onChunk(', '  // Generate waking Cy prose');
  const stream = extract(runtime, '  async function streamGenerate(', '  // A one-shot, non-streaming generation');
  const loop = extract(runtime, '      for (;;) {\n        if (discards >= MAX_DISCARDS)', '      const burstMs = Date.now() - burstStart;');
  const occurrence = extract(runtime, '      // CYCLE OUTCOME: exactly one terminal outcome', '      // FAILED-ATTEMPT BACKOFF classification.');
  const memory = extract(runtime, "      // remember this burst's opening word", '      // roll the "did this burst carry a wing noise"');
  const make = runInNewContext(`(function() {
    let contextBuf = ${JSON.stringify(continuation)};
    let burstEmitted = '', burstStopped = false, burstAssistantFrameDetected = false;
    let burstAllowRepeat = false, wardenBlocksInGen = 0, burstTrimmed = 0;
    let burstStripRemoved = {}, burstAnnihilated = { scaffold: 0, narration: 0, stateNotation: 0 };
    let lastTextMs = 0, watchdogStep = 0, failedCyclesSinceEmit = 0, nonEmittingStreak = 0;
    let currentMemoryAbort = null, tokenCount = 0, lastPublishedWakingExpressionMs = 0;
    const memoryExpressionBuffer = [], MEMORY_EXPRESSION_BATCH_LIMIT = 1;
    const CONTEXT_HARD = 12000, CONTEXT_SOFT = 10000, contextPath = 'offline';
    const providerOverride = null;
    ${append}
    ${chunks}
    ${stream}
    async function cycle() {
      let discards = 0, assistantFrameDiscards = 0, tempBump = 0, penBump = 0;
      let attempted = false, produced = false, errored = false, refusedGen = false;
      let lastFull = '', lastResult = null, lastTail = '', lastOpts = null;
      const contextText = () => contextBuf;
      const trimContext = () => { throw new Error('unexpected repeat retry'); };
      const burstJournalTurn = { seenKeys: ['published-subject'] }, burstGroundedDirective = 'offline';
      ${loop}
      ${occurrence}
      ${memory}
      return { produced, lastFull, lastResult, discards, contextBuf, burstEmitted };
    }
    return { cycle, direct: () => streamGenerate({ system: '', prompt: 'CELL', opts: baseOpts,
      mode, journalContinuation: '', contextTail: '', attempt: 'journal-initial' }) };
  })()`, {
    ...wardenModule, ...character, LOCATIONS, vitals, mode, calls, generationHitTokenLimit,
    applyBurstSeparator, buildPromptRequest, sourceFromExpression,
    AbortController, console: { log() {}, warn() {}, error() {} },
    baseOpts: { num_predict: 93, temperature: 0.8, repeat_penalty: 1.1 },
    MAX_DISCARDS: 3, FOREGROUND_INFERENCE_TIMEOUT_MS: 420000,
    ZONE_A: '', directives: 'Authoritative location: CELL', allowRepeat: false,
    expressiveChoice: {}, EXPRESSIVE_CHOICE_MECHANISM: 'model',
    activeProvider: () => ({ id: 'ollama', model: 'offline',
      acquireSharedLease: async () => ({ release: async () => {} }),
      openStream: async request => { calls.model++; calls.prompts.push(request.prompt); return { ok: true, reader: {}, model: 'offline' }; },
    }),
    readNdjsonStream: async (_reader, handlers) => {
      await handlers.onToken(typeof text === 'function' ? text(calls.model) : text);
      handlers.onDone(stats); beforeReturn(vitals, calls);
      return { aborted: false };
    },
    inferenceCoordinator: { acquire: async () => ({ id: 'offline-request', begin: () => 1,
      setPhase() {}, finish: detail => calls.finished.push(detail) }) },
    InferenceWaitTrace: class { async measure(_name, fn) { return fn(); } snapshot() { return {}; } },
    inferenceMeta: value => value, inferenceStats: () => ({}),
    inferenceTempoPacer: { record() {} }, waitForInferenceTempo: async () => {},
    startAbortTimeout: () => () => {},
    generationCancellation: { abort() {}, register() {}, clear() {} },
    recordInferenceDiagnostic: event => calls.termination.push(event), recordJournalTerminationDiagnostic,
    recordInferenceOutcome: (...args) => calls.inference.push(args),
    recordSpend: async (...args) => calls.spend.push(args),
    recordOutcome: async name => calls.outcomes.push(name),
    warden: { newBuffer: () => new wardenModule.SentenceBuffer(),
      screenOut: () => { duringStage(vitals, calls); return { ok: true }; }, logBlock: async () => {} },
    emit: event => { if (event.kind === 'text') calls.text.push(event.payload.s); },
    saveContext: async (_path, value) => { calls.saved.push(value); calls.continuation.push(value); },
    soma: { observeOutput: (...args) => calls.output.push(args) },
    autobiographicalMemory: { interruptBackground() {}, queueSource: async value => calls.memory.push(value) },
    recordExpressiveJournal: (_state, value) => { calls.cadence.push(value); return value; },
    formMemoryAfterVisibleOutput: value => calls.formMemory.push(value),
    firstWord: text => text.trim().split(/\s+/)[0], randomUUID: () => 'offline-expression', tsNow: () => 'offline',
    logHoldbackDiscard: async () => duringRepeat(vitals, calls),
    logCharacterValidation: async () => {}, logPrompt: async () => {},
    logCapHit: async () => {}, logDiscard: async () => {}, logBurstStrip: async () => {},
    logAssistantFrameDiscard: async () => {}, logNarration: async () => {}, logStateNotation: async () => {},
    logAnnihilated: async () => {}, logWithinBurstRepeat: async () => {},
  });
  return { ...make, vitals, calls, initialContinuation: continuation };
}

function assertNoJournal(f, result) {
  assert.equal(result.produced, false);
  assert.equal(result.lastResult.journalLocationRejected, true);
  assert.equal(result.lastResult.aborted, true);
  assert.equal(result.lastResult.full, '');
  assert.equal(result.discards, 0);
  for (const key of ['text', 'continuation', 'output', 'memory', 'formMemory', 'cadence']) {
    assert.equal(f.calls[key].length, 0, key);
  }
  assert.equal(result.contextBuf, f.initialContinuation);
  assert.equal(f.vitals.lastJournalAtMs, 0);
  assert.equal(f.vitals.journalSubjectKeys.length, 0);
  assert.equal(f.vitals.recentOpeners.length, 0);
  assert.equal(f.calls.model, 1);
  assert.equal(f.calls.spend.every(args => args[2] === false), true);
  assert.equal(f.calls.inference.some(args => args[1] === 'rejected-journal-location'), true);
}

test('old production control publishes an in-flight CELL journal after real yard movement; repair does not', async () => {
  const move = vitals => {
    const moved = reconcileRegimeLocation(vitals.locationRegime,
      { nowMs: at + 60000, date: '2026-10-27', minutes: 855, asleep: false });
    assert.equal(moved.events.length, 2);
    vitals.locationRegime = moved.state;
  };
  const baseline = fixture({ runtime: old('runner/run.js'), beforeReturn: move });
  const before = await baseline.cycle();
  assert.equal(before.produced, true);
  assert.equal(baseline.calls.text.join(''), sentence);
  const repaired = fixture({ beforeReturn: move });
  assertNoJournal(repaired, await repaired.cycle());
  assert.equal(repaired.vitals.locationRegime.current.id, LOCATIONS.EXERCISE_YARD);
  assert.equal(JSON.stringify(repaired.vitals.locationRegime), JSON.stringify(baseline.vitals.locationRegime));
  assert.match(repaired.calls.prompts[0], /Authoritative location: CELL/);
});

test('a CELL journal has exactly the same publication, continuation and feedback as production', async () => {
  const a = fixture({ runtime: old('runner/run.js') }), b = fixture();
  const before = await a.cycle(), after = await b.cycle();
  assert.equal(before.lastFull, after.lastFull);
  assert.equal(after.lastFull, sentence);
  for (const key of ['text', 'continuation', 'memory', 'formMemory', 'outcomes']) {
    assert.equal(JSON.stringify(a.calls[key]), JSON.stringify(b.calls[key]), key);
  }
  assert.equal(b.calls.output.length, 1);
  assert.equal(b.calls.memory.length, 1);
  assert.equal(b.calls.cadence.length, 1);
  assert.equal(b.calls.model, 1);
});

for (const location of ['EXERCISE_YARD', 'SHOWER', 'ASSOCIATION', 'PHONE', 'WING_OR_LANDING', undefined]) {
  test(`current authoritative ${location} replaces the stale CELL prompt and fails closed`, async () => {
    const f = fixture({ beforeReturn: vitals => { vitals.locationRegime = { current: { id: location } }; } });
    assertNoJournal(f, await f.cycle());
    assert.equal(f.vitals.locationRegime.current.id, location);
  });
}

test('departure while awaited chunk staging runs is rechecked at the final commit', async () => {
  let staged = false;
  const f = fixture({ duringStage: vitals => {
    staged = true;
    vitals.locationRegime.current.id = LOCATIONS.EXERCISE_YARD;
  } });
  assertNoJournal(f, await f.cycle());
  assert.equal(staged, true, 'the post-collection check was still CELL');
});

test('location invalidation cannot trigger the existing character-repair inference', async () => {
  const f = fixture({ text: "Please proceed and write more of Cy's thoughts.",
    beforeReturn: vitals => { vitals.locationRegime.current.id = LOCATIONS.EXERCISE_YARD; } });
  assertNoJournal(f, await f.cycle());
});

test('departure during awaited repeat diagnostics cannot trigger outer replacement inference', async () => {
  const continuation = 'the trolley wheel kept squeaking along the corridor outside the cell';
  const f = fixture({ text: continuation, continuation,
    duringRepeat: vitals => { vitals.locationRegime.current.id = LOCATIONS.EXERCISE_YARD; } });
  assertNoJournal(f, await f.cycle());
});

test('truthful spent-inference and termination accounting remains, without published-journal status', async () => {
  const f = fixture({ beforeReturn: vitals => { vitals.locationRegime.current.id = LOCATIONS.PHONE; } });
  assertNoJournal(f, await f.cycle());
  assert.equal(f.calls.finished.length, 1);
  assert.equal(f.calls.termination.filter(e => e.event === 'journal-termination').length, 1);
  assert.equal(f.calls.termination.find(e => e.event === 'journal-termination').termination, 'stop');
  assert.equal(f.calls.spend.length, 1);
  assert.equal(f.calls.inference.some(args => args[1] === 'emitted'), false);
  assert.equal(f.calls.outcomes.includes('emitted'), false);
});

test('normal CELL character repair remains the existing two calls, not a new policy', async () => {
  const f = fixture({ text: n => n === 1 ? "Please write more of Cy's thoughts." : sentence });
  assert.equal((await f.cycle()).lastFull, sentence);
  assert.equal(f.calls.model, 2);
});

test('only journal location-result fencing changes production runtime; other boundaries are byte-identical', () => {
  assert.equal(beforeJournalCellPublication(run), old('runner/run.js'));
  for (const path of ['runner/prompt.js', 'runner/character-output.js', 'runner/warden.js',
    'runner/journal-termination-telemetry.js', 'runner/provider.js', 'runner/memory-runtime.js',
    'runner/autobiographical-memory.js', 'runner/location-regime.js', 'runner/exercise-admission.js',
    'runner/drawing-subject.js', 'runner/context-broker.js', 'lib/autobiographical_memory.php']) {
    assert.equal(source(path), old(path), path);
  }
});

test('nonjournal waking prose is not newly made CELL-only', async () => {
  const f = fixture({ mode: 'warden', beforeReturn: vitals => { vitals.locationRegime.current.id = LOCATIONS.EXERCISE_YARD; } });
  const result = await f.direct();
  assert.equal(result.full, sentence);
  assert.equal(result.journalLocationRejected, undefined);
});
