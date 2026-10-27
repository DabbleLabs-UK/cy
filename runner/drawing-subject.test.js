import assert from 'node:assert/strict';
import test from 'node:test';
import { beforeJournalTerminationTelemetry } from './fixtures/journal-termination-source.mjs';
import { beforeJournalCellPublication } from './fixtures/journal-cell-publication-source.mjs';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { drawingSubjectRequest, parseDrawingSubject, DRAWING_SUBJECT_FORMAT } from './drawing-subject.js';
import * as drawing from './draw.js';
import { InferenceCoordinator } from './inference-coordinator.js';
import { InferenceWaitTrace } from './inference-wait.js';
import { GenerationCancellationRegistry, abortWithReason, cancellationReason, cancellationError } from './inference-cancellation.js';
import { requireInferenceEligibility } from './dream-regime.js';
import { withAbortTimeout } from './run.js';

const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function extract(text, start, end) {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `missing function boundary: ${start}`);
  return text.slice(first, last).trim();
}
const drawCode = extract(source, 'async function doDraw(', '  // ---- inbox:');
const rawCode = extract(source, 'async function rawGenerate(', '  function brokerItems(');
const AT = Date.parse('2026-10-25T14:00:00.000Z');
const packet = { sections: [
  { id: 'mandatory_current_state', items: [{ sourceId: 'state:cell', provenanceClass: 'WORLD FACT', content: 'Cy is in CELL.' }] },
  { id: 'grounded_soma', items: [{ sourceId: 'soma:grounded', provenanceClass: 'WORLD FACT', content: 'His hands feel cold.' }] },
  { id: 'recent_events', items: [{ sourceId: 'd77ad096-9879-4ea5-b48e-735d0ec6f2bc', provenanceClass: 'WORLD FACT', content: 'He saw the yard fence.' }] },
  { id: 'autobiographical_memory', items: [{ sourceId: 'memory:yard', provenanceClass: 'MEMORY', epistemicDetail: 'fallible', content: 'He recalls the yard fence.' }] },
  { id: 'recent_expression', items: [{ sourceId: 'old:journal', provenanceClass: 'PRIOR SUBJECTIVE THOUGHT', content: 'LONG_RAW_JOURNAL_TAIL '.repeat(300) }] },
  { id: 'cast_context', items: [{ sourceId: 'cast:eligible', provenanceClass: 'WORLD FACT', content: 'ELIGIBLE_CAST_DESCRIPTION' }] },
] };

test('private request projects filtered grounding and memory, never prose continuation or journal directives', () => {
  const call = drawingSubjectRequest({ packet, requestedSubject: 'the yard fence',
    contextTail: 'LONG_RAW_JOURNAL_TAIL', recentExpression: 'CONTINUE_PREVIOUS_THOUGHT',
    directive: 'ONE_SUBJECT: develop this whole entry' });
  const request = call.system + call.prompt;
  assert.doesNotMatch(request, /LONG_RAW_JOURNAL_TAIL|CONTINUE_PREVIOUS_THOUGHT|ONE_SUBJECT|whole entry|running commentary|train.of.thought|ELIGIBLE_CAST_DESCRIPTION/);
  const payload = JSON.parse(call.prompt);
  assert.deepEqual(payload.sources.map((item) => item.content), ['Cy is in CELL.', 'His hands feel cold.', 'He saw the yard fence.', 'He recalls the yard fence.']);
  assert.doesNotMatch(call.prompt, /state:cell|soma:grounded|d77ad096-9879-4ea5-b48e-735d0ec6f2bc|memory:yard/);
  assert.equal(payload.sources.some((item) => Object.hasOwn(item, 'ref')), false);
  assert.equal(payload.sources[3].uncertainty, 'fallible');
  assert.equal(payload.sources[3].origin, 'MEMORY');
  assert.equal(payload.requestedSubject, 'the yard fence');
  assert.deepEqual(call.format, DRAWING_SUBJECT_FORMAT);
  assert.equal(call.format.additionalProperties, false);
  assert.deepEqual(call.format.required, ['subject']);
});

for (const subject of ['the yard fence', 'a bent spoon', 'Mr. Keyes walking the landing', 'six marks on the cell wall']) {
  test(`complete drawable subject accepted without extraction: ${subject}`, () => {
    assert.deepEqual(parseDrawingSubject(JSON.stringify({ subject })), { ok: true, reason: 'accepted', subject });
  });
}

const naturalFailures = [
  'dont know wot its for anyway | maybe just my mind playn but ca',
  'i mewling at some 1 else 2 | <the plan of my cell',
  'thats da gate | . cant get dis idea outta me dont know y its so',
  'trolley | im stuck now thinkn bout mr locke searching ma cell',
  'no wot I mean? mr keyes walks around',
];
for (const text of naturalFailures) {
  test(`natural prose is rejected both raw and as a complete subject: ${text.slice(0, 28)}`, () => {
    for (const raw of [text, JSON.stringify({ subject: text })]) {
      const result = parseDrawingSubject(raw);
      assert.equal(result.ok, false);
      assert.equal(result.subject, null);
    }
  });
}

for (const value of [
  { subject: 'the yard\nfence' }, { subject: 'the fence', explanation: 'why' },
  { subject: 'a fence followed by more arbitrary reflection about life' },
  { subject: 'x'.repeat(61) }, { subject: 'I remember Bill' },
  { subject: 'continue this entry' }, { subject: 'drawing of the gate' },
  { subject: '' }, { subject: null }, [], null,
]) test(`invalid contract is rejected rather than shortened: ${JSON.stringify(value)}`, () => {
  const result = parseDrawingSubject(JSON.stringify(value));
  assert.equal(result.ok, false);
  assert.equal(result.subject, null);
});

function drawFixture({ intent = { ok: true, text: '{"subject":"the yard fence"}' }, contextOk = true, dsl = 'L 10,10 80,10\nL 80,10 80,80\nL 80,80 10,80' } = {}) {
  const calls = { generate: [], diagnostics: [], events: [], append: [], observe: [], consume: [], broker: [], failures: [] };
  const vitals = { expressiveCadence: { failures: 0 }, monotony: 0.5 };
  class Clock extends Date { static now() { return AT; } }
  const env = { ...drawing, Date: Clock, currentMode: 'journal', lastPublishedWakingExpressionMs: 0,
    vitals, config: { threads: 4 }, NUM_CTX: 3072, FOREGROUND_INFERENCE_TIMEOUT_MS: 420_000,
    pendingDrawRequests: [], drawingSubjectRequest, parseDrawingSubject,
    autobiographicalMemory: { consumeWorking: (ref) => calls.consume.push(ref), observe: (...args) => calls.observe.push(args) },
    soma: { groundedDirective: () => ({ directive: 'grounded', context: 'body' }), observeOutput: (...args) => calls.observe.push(args) },
    CONTEXT_CONSUMERS: { CY_PROSE: 'CY_PROSE' },
    buildBrokerContext: (...args) => { calls.broker.push(args); return { ok: contextOk, packet }; },
    options: (_v, _t, _m, opts) => opts, logPrompt: async () => {},
    rawGenerate: async (request) => { calls.generate.push(request); return calls.generate.length === 1 ? intent : dsl; },
    recordInferenceDiagnostic: (record) => calls.diagnostics.push(record), tsNow: () => new Date(AT).toISOString(),
    recordExpressiveDrawingFailure: (state) => ({ ...state, failures: state.failures + 1 }),
    recordExpressiveDrawing: (state) => ({ ...state, drawings: 1 }),
    emit: (event) => calls.events.push(event), logDrawFail: async (...args) => calls.failures.push(args),
    clamp: (value) => Math.min(1, Math.max(0, value)),
    context: { append: (...args) => calls.append.push(args) },
    ctxBuffer: { append: (...args) => calls.append.push(args) },
    appendContext: async (...args) => calls.append.push(args),
    streamGenerate: () => assert.fail('drawing preparation must never use waking prose streaming'),
    buildCtx: () => assert.fail('drawing preparation must never construct journal context'),
  };
  const draw = runInNewContext(`(${drawCode})`, env);
  return { calls, vitals, env, draw };
}

function assertPrivate(f) {
  assert.equal(f.calls.events.length, 0);
  assert.equal(f.calls.append.length, 0);
  assert.equal(f.calls.observe.length, 0);
  assert.equal(f.calls.generate.filter((call) => call.attempt !== 'drawing-intent').length, 0);
}

for (const intent of [
  { ok: true, text: 'im stuck now thinkn bout mr locke' },
  { ok: true, text: '{"subject":"I am thinking"}' },
  { ok: false, text: '', error: 'provider unavailable' },
  { ok: false, text: '', aborted: true, modelStarted: false, abortReason: 'WING_NOISE_MID' },
  { ok: false, text: '', aborted: true, modelStarted: true, abortReason: 'WING_NOISE_MID' },
]) test(`actual doDraw keeps failed or cancelled intent private: ${JSON.stringify(intent)}`, async () => {
  const f = drawFixture({ intent });
  assert.equal(await f.draw(), intent.aborted ? 'aborted' : 'empty');
  assertPrivate(f);
  assert.equal(f.calls.generate.length, 1);
  assert.equal(f.vitals.expressiveCadence.failures, 1);
  assert.equal(f.calls.diagnostics.length, 1);
  assert.equal(f.calls.generate[0].purpose, 'drawing');
  assert.equal(f.calls.generate[0].attempt, 'drawing-intent');
  assert.equal(f.calls.generate[0].returnMeta, true);
  assert.equal(f.calls.generate[0].opts.num_predict, 40);
  if (intent.aborted) assert.equal(f.calls.diagnostics[0].status,
    intent.modelStarted ? 'interrupted-during-subject' : 'interrupted-before-subject');
});

test('actual doDraw context failure makes no inference or public/feedback material', async () => {
  const f = drawFixture({ contextOk: false });
  assert.equal(await f.draw(), 'empty');
  assertPrivate(f);
  assert.equal(f.calls.generate.length, 0);
  assert.equal(f.calls.diagnostics[0].reason, 'context-unavailable');
});

test('actual doDraw valid subject reaches unchanged DSL and publishes only drawing events', async () => {
  const f = drawFixture();
  assert.equal(await f.draw(), 'emitted');
  assert.deepEqual(f.calls.events.map((event) => event.kind), ['draw', 'draw_saved']);
  assert.equal(f.calls.events[0].payload.title, 'the yard fence');
  assert.equal(f.calls.events[1].payload.subject, 'the yard fence');
  assert.equal(f.calls.events[1].payload.stroke_count, 3);
  assert.equal(f.calls.generate[1].prompt, drawing.drawDslPrompt('the yard fence', { badly: false }));
  assert.equal(f.calls.generate[1].opts.num_predict, 320);
  assert.equal(f.calls.append.length, 0);
  assert.equal(f.calls.observe.length, 0);
  assert.equal(f.calls.broker[0][1].recentExpression, '');
});

for (const dsl of ['', 'nothing drawable', 'T 10 10 "journal instead"']) test(`downstream DSL failure never substitutes prose: ${dsl}`, async () => {
  const f = drawFixture({ dsl });
  assert.equal(await f.draw(), 'empty');
  assert.equal(f.calls.generate.length, 2);
  assert.equal(f.calls.events.length, 0);
  assert.equal(f.calls.append.length, 0);
  assert.equal(f.calls.observe.length, 0);
  assert.equal(f.calls.failures.length, 1);
});

function rawFixture() {
  const calls = { waits: [], provider: [], shared: [], release: 0, spend: [], pacing: [], diagnostics: [] };
  const hooks = {};
  const registry = new GenerationCancellationRegistry();
  const coordinator = new InferenceCoordinator();
  const provider = { model: 'mock-no-inference', id: 'mock',
    acquireSharedLease: async (request) => { calls.shared.push(request); if (hooks.shared) await hooks.shared(request);
      return { release: async () => { calls.release++; if (hooks.release) await hooks.release(); } }; },
    rawGenerate: async (request) => { calls.provider.push(request); if (hooks.provider) return hooks.provider(request);
      return { ok: true, text: '{"subject":"the yard fence"}' }; },
  };
  const env = { AbortController, DOMException, InferenceWaitTrace, generationCancellation: registry,
    activeProvider: () => provider, autobiographicalMemory: null, currentMemoryAbort: null,
    abortWithReason, cancellationReason, cancellationError, inferenceCoordinator: coordinator,
    inferenceMeta: (request) => request, requireInferenceEligibility, withAbortTimeout,
    waitForInferenceTempo: async (signal, purpose) => { calls.waits.push(purpose); signal.throwIfAborted(); },
    recordSpend: async (...args) => { calls.spend.push(args); if (hooks.spend) await hooks.spend(); }, inferenceStats: () => ({}),
    inferenceTempoPacer: { record: (...args) => calls.pacing.push(args) },
    recordInferenceDiagnostic: (record) => calls.diagnostics.push(record),
  };
  const raw = runInNewContext(`(${rawCode})`, env);
  const call = (extra = {}) => raw({ system: 'subject only', prompt: '{}', opts: { num_predict: 40 },
    purpose: 'drawing', attempt: 'drawing-intent', returnMeta: true, ...extra });
  return { calls, hooks, registry, coordinator, call };
}

test('actual drawing intent raw path retains Tempo, coordinator and shared resource admission', async () => {
  const f = rawFixture();
  const owner = await f.coordinator.acquire({ purpose: 'postcard' });
  const pending = f.call();
  await nextTurn();
  assert.equal(f.calls.provider.length, 0);
  assert.equal(f.calls.shared.length, 0);
  owner.finish();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.deepEqual(f.calls.waits, ['drawing', 'drawing']);
  assert.equal(f.calls.shared[0].purpose, 'drawing');
  assert.equal(f.calls.shared[0].preemptible, false);
  assert.equal(f.calls.release, 1);
  assert.equal(f.calls.spend[0][2], false);
  assert.equal(f.calls.pacing.length, 1);
});

for (const stage of ['coordinator', 'arbiter', 'provider']) test(`actual drawing raw cancellation at ${stage} rejects even a late provider success`, async () => {
  const f = rawFixture();
  let owner;
  if (stage === 'coordinator') owner = await f.coordinator.acquire({ purpose: 'postcard' });
  if (stage === 'arbiter') f.hooks.shared = ({ signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(cancellationError(signal)), { once: true });
  });
  if (stage === 'provider') f.hooks.provider = async () => {
    f.registry.abort('visible', 'WING_NOISE_MID');
    return { ok: true, text: '{"subject":"the yard fence"}' };
  };
  const pending = f.call();
  await nextTurn();
  if (stage !== 'provider') f.registry.abort('visible', 'WING_NOISE_MID');
  const result = await pending;
  owner?.finish();
  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.equal(result.abortReason, 'WING_NOISE_MID');
  assert.equal(result.modelStarted, stage === 'provider');
  assert.equal(result.text, '');
  assert.equal(f.calls.provider.length, stage === 'provider' ? 1 : 0);
  assert.equal(f.calls.spend.length, 0);
});

for (const stage of ['spend', 'release']) test(`drawing intent cancelled during awaited ${stage} cannot return its completed subject`, async () => {
  const f = rawFixture();
  f.hooks[stage] = async () => {
    await nextTurn();
    f.registry.abort('visible', 'INTERACTIVE_INBOX');
  };
  const result = await f.call();
  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.equal(result.abortReason, 'INTERACTIVE_INBOX');
  assert.equal(result.modelStarted, true);
  assert.equal(result.text, '');
  assert.equal(f.calls.provider.length, 1);
  assert.equal(f.calls.spend.length, 1);
  assert.equal(f.calls.release, 1);
});

test('journal context and Tempo stay identical outside tested repeat/finalization boundaries', () => {
  const baseline = execFileSync('git', ['show', '227b294:runner/run.js'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  for (const [start, end] of [
    ['async function waitForInferenceTempo(', '  soma.observe('],
    ['function buildCtx(', '  async function doPostcard('],
    ['async function doPostcard(', '  async function doWarden('],
  ]) assert.equal(extract(source, start, end), extract(baseline, start, end));
  // The journal-repeat fix carries the already-rendered exposure to its full
  // candidate check. Permit exactly that diff, not a blanket stream exemption.
  const stream = (text) => extract(text, 'async function streamGenerate(', '  async function rawGenerate(');
  const expectedStream = stream(baseline)
    .replace("    timeoutMs = null, pairedWithChoice", "    journalContinuation = null,\n    timeoutMs = null, pairedWithChoice")
    .replace('    if (contextTail && accounted.out.trim() && isRepeat(accounted.out, contextTail)) {',
      "    const repeated = mode === 'journal' && journalContinuation !== null\n" +
      '      ? isJournalRepeat(accounted.out, journalContinuation)\n' +
      '      : contextTail && accounted.out.trim() && isRepeat(accounted.out, contextTail);\n' +
      '    if (repeated) {');
  // The later finalization fix stages and validates journal bytes immediately
  // before publication. Permit that separately tested block and literal flush;
  // keep collection, drawing separation and all other stream code pinned.
  const finalization = extract(beforeJournalCellPublication(source),
    "    if (mode === 'journal') {\n      // Run existing per-chunk filters",
    '    await logBurstStrip(rawFull, mode);\n    for (let i = 0; i < attempts.length; i++)');
  const beforeFinalization = beforeJournalTerminationTelemetry(stream(source))
    .replace(finalization, 'for (const chunk of chunks) await onChunk(chunk, mode);')
    .replace("      ...(mode === 'journal' ? { validate: validateJournalCandidate } : {}),\n", '')
    .replace('...buffer.flush()]', '...buffer.flush({ tokenLimited: guarded.tokenLimited })]');
  assert.equal(beforeFinalization, expectedStream);
  const stageTwo = (text) => extract(text, '    const sys2 = drawDslSystem();', '  // ---- inbox:');
  // Only comments stop claiming a failed picture has emitted preparatory prose.
  const executable = (text) => text.split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n')
    .replaceAll("return decisionEmitted ? 'emitted' : 'empty';", "return 'empty';");
  assert.equal(executable(stageTwo(source)), executable(stageTwo(baseline)));
});
