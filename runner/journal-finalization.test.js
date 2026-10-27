import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import {
  generateWithCharacterRepair, journalTerminationEvidence,
  validateCharacterCandidate, validateJournalPublication,
} from './character-output.js';
import {
  SentenceBuffer, sanitize, normalizeWakingProse, looksLikeAssistantFrame,
  sanitizeCharacterContext,
  narrationHits, stateNotationHits, stripScaffoldAccounted, repeatsWithinBurst,
  isRepeat, isJournalRepeat,
} from './warden.js';
import { applyBurstSeparator, completionBudget } from './prompt.js';
import { recordJournalTerminationDiagnostic } from './journal-termination-telemetry.js';

const BASE = '6967e092a81ec5095320ebb8378cee84acf0c458';
const run = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/journal-finalization-natural-20261026.json', import.meta.url)));
const length = { done: true, done_reason: 'length', eval_count: 93 };
const stop = { done: true, done_reason: 'stop', eval_count: 93 };

test('private termination diagnostics and failed sinks cannot change publication or exact feedback', async () => {
  for (const stats of [null, { done: true, eval_count: 34 }, stop, length]) {
    for (const candidate of ['cos...', 'durin', 'b4', fixtures.completeCapQuestion.published]) {
      const baseline = runtimeFixture();
      const expected = await baseline.execute(candidate, stats);
      for (const sink of [() => {}, () => { throw new Error('disk unavailable'); }, () => Promise.reject(new Error('disk unavailable'))]) {
        recordJournalTerminationDiagnostic(sink, { id: 'offline', stats, provider: 'ollama' });
        const actual = runtimeFixture();
        assert.equal(JSON.stringify(await actual.execute(candidate, stats)), JSON.stringify(expected));
        const ignoreClock = (key, value) => key === 'now' ? 0 : value;
        assert.equal(JSON.stringify(actual.calls, ignoreClock), JSON.stringify(baseline.calls, ignoreClock));
      }
    }
  }
});

function extract(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source boundary: ${start}`);
  return text.slice(a, b);
}

// Execute the ACTUAL runtime chunk-filter, publication and finalization bodies
// with in-memory sinks. No runner main, network, model or persisted state.
function runtimeFixture({ screen = () => ({ ok: true }), failEmit = false } = {}) {
  const calls = { events: [], feedback: [], saved: [], soma: [], spend: [], outcomes: [] };
  const helpers = extract(run, '  async function onChunk(', '  // Generate waking Cy prose');
  const locationGuard = extract(run, '    function journalLocationResult(', '    const collectCandidate =');
  const contextAppend = extract(run, '  async function appendContext(', '  // Shrink the effective context tail')
    .replace('async function appendContext(', 'async function actualAppendContext(');
  const ending = extract(run, '    const rawFull = guarded.candidate', '  // A one-shot, non-streaming generation');
  const body = ending.slice(0, ending.lastIndexOf('\n  }'));
  const execute = runInNewContext(`(async function(candidate, stats) {
    let contextBuf = 'earlier subjective writing. ';
    let burstEmitted = '', burstStopped = false, burstAssistantFrameDetected = false;
    let burstAllowRepeat = false, wardenBlocksInGen = 0, burstTrimmed = 0;
    let lastTextMs = 0, watchdogStep = 0, failedCyclesSinceEmit = 0, nonEmittingStreak = 0;
    let burstStripRemoved = {}, burstAnnihilated = { scaffold: 0, narration: 0, stateNotation: 0 };
    const vitals = { locationRegime: { current: { id: 'CELL' } } };
    const guarded = { candidate, stats, requestId: 'offline-only' };
    const attempts = [guarded];
    const mode = 'journal', journalContinuation = '', contextTail = '', postcardTurn = null;
    const provider = { id: 'offline' };
    const CONTEXT_HARD = 12000, CONTEXT_SOFT = 10000, contextPath = 'offline-only';
    function emit(event) { emitSink(event); }
    ${contextAppend}
    async function appendContext(chunk) {
      await actualAppendContext(chunk);
      feedbackSink(chunk);
    }
    ${helpers}
    ${locationGuard}
    ${body}
  })`, {
    sanitize, looksLikeAssistantFrame, narrationHits, stateNotationHits,
    sanitizeCharacterContext,
    stripScaffoldAccounted, applyBurstSeparator, repeatsWithinBurst, isRepeat, isJournalRepeat,
    validateJournalPublication,
    LOCATIONS: { CELL: 'CELL' },
    warden: { screenOut: screen, logBlock: async () => {}, newBuffer: () => new SentenceBuffer() },
    emitSink: (event) => { if (failEmit && event.kind === 'text') throw new Error('publication failed'); calls.events.push(event); },
    feedbackSink: (text) => calls.feedback.push(text),
    saveContext: async (_path, text) => calls.saved.push(text),
    soma: { observeOutput: (...args) => calls.soma.push(args) },
    generationCancellation: { abort: () => {} }, tsNow: () => 'offline',
    recordInferenceOutcome: (...args) => calls.outcomes.push(args),
    recordSpend: async (...args) => calls.spend.push(args),
    logBurstStrip: async () => {}, logAssistantFrameDiscard: async () => {},
    logNarration: async () => {}, logStateNotation: async () => {},
    logAnnihilated: async () => {}, logWithinBurstRepeat: async () => {}, logHoldbackDiscard: async () => {},
  });
  return { calls, execute };
}

for (const fixture of fixtures.cases) {
  test(`saved raw repair ${fixture.seq}: buffering never deletes a token or adds dots`, () => {
    const b = new SentenceBuffer();
    const raw = fixture.rawRepair;
    const chunks = [...b.push(raw), ...b.flush({ tokenLimited: true })];
    assert.equal(chunks.join(''), raw);
    assert.notEqual(chunks.join(''), fixture.published);
    assert.equal(fixture.observedProviderReason, null);
  });
  test(`saved raw repair ${fixture.seq}: explicit length failure cannot reach publication/feedback`, async () => {
    const f = runtimeFixture();
    const r = await f.execute(fixture.rawRepair, length);
    assert.equal(r.journalFinalizationRejected, true);
    assert.equal(r.full, '');
    assert.equal(f.calls.events.filter(e => e.kind === 'text').length, 0);
    assert.deepEqual(f.calls.feedback, []);
    assert.deepEqual(f.calls.soma, []);
    assert.equal(f.calls.spend.length, 1);
  });
}

test('provider length reason is distinct from count-only, stop, absent and contradictory metadata', () => {
  for (const stats of [length, { finish_reason: 'length' }, { done_reason: ' LENGTH ' }]) {
    assert.equal(journalTerminationEvidence(stats).explicitLength, true);
  }
  for (const stats of [stop, null, {}, { eval_count: 93 }, { done: false, done_reason: 'length' }]) {
    assert.equal(journalTerminationEvidence(stats).explicitLength, false);
  }
  assert.equal(journalTerminationEvidence({ eval_count: 93 }).reason, null);
});

test('complete natural cap-hit question remains eligible, including explicit length', async () => {
  const text = fixtures.completeCapQuestion.published;
  assert.equal(text.endsWith('?'), true);
  for (const stats of [length, stop, { done: true, eval_count: 93 }]) {
    const f = runtimeFixture();
    const r = await f.execute(text, stats);
    assert.equal(r.journalFinalizationRejected, undefined);
    assert.equal(r.full, text);
    assert.equal(f.calls.events.filter(e => e.kind === 'text').map(e => e.payload.s).join(''), text);
    assert.equal(f.calls.feedback.join(''), text);
  }
});

test('explicitly length-stopped fragments and ellipses fail without prefix salvage', async () => {
  for (const text of ['heard the latch. wonder why he', 'cos...', 'why . . .', 'single', '']) {
    const f = runtimeFixture();
    const r = await f.execute(text, length);
    assert.equal(r.journalFinalizationRejected, true, text);
    assert.equal(f.calls.feedback.length, 0);
    assert.equal(f.calls.events.filter(e => e.kind === 'text').length, 0);
    assert.equal(f.calls.soma.length, 0);
  }
});

test('complete punctuation endings remain unchanged under explicit length', () => {
  for (const text of ['door clicked.', 'still here!', 'where now?', 'that was all.)', 'heard him say "wait."']) {
    assert.equal(validateJournalPublication(text, length).ok, true, text);
  }
});

test('unknown termination does not become a below-cap fragment heuristic or a count veto', async () => {
  for (const text of ['still finkin bout it rn', 'cos...', 'words swirlin round ma head b4']) {
    for (const stats of [null, { done: true, eval_count: 34 }, { done: true, eval_count: 93 }, stop]) {
      const f = runtimeFixture();
      const r = await f.execute(text, stats);
      assert.equal(r.full, text);
      assert.equal(f.calls.feedback.join(''), text);
    }
  }
});

const angleFixtures = JSON.parse(readFileSync(new URL('./fixtures/journal-unclosed-angle-natural-20261026.json', import.meta.url)));
for (const fixture of angleFixtures.cases) {
  test(`natural angle ${fixture.seq}: final publication rejects before prose and feedback`, async () => {
    const f = runtimeFixture();
    const r = await f.execute(fixture.rawRepair || fixture.published,
      { done: true, eval_count: fixture.tokens }); // Unknown reason, not a cap heuristic.
    assert.equal(r.full, '');
    assert.equal(r.journalFinalizationRejected, true);
    assert.ok(r.finalValidation.reasons.includes('unclosed clause-initial angle prefix'));
    assert.deepEqual(f.calls.feedback, []);
    assert.deepEqual(f.calls.saved, []);
    assert.deepEqual(f.calls.soma, []);
    assert.equal(f.calls.events.filter(e => e.kind === 'text').length, 0);
  });
}

test('ordinary comparisons and heart notation still publish and feed back unchanged', async () => {
  for (const text of ['42 < 43', 'counted the tiles: 42 < 43, still one short.', 'put <3 in the margin']) {
    const f = runtimeFixture();
    const r = await f.execute(text, stop);
    assert.equal(r.full, text);
    assert.deepEqual(f.calls.feedback, [text]);
    assert.equal(f.calls.saved.at(-1).endsWith(text), true);
  }
});

test('final malformed control is rejected before even an otherwise-valid prefix publishes', async () => {
  const f = runtimeFixture();
  const r = await f.execute('heard the latch. still wondering |...', stop);
  assert.equal(r.journalFinalizationRejected, true);
  assert.equal(f.calls.events.filter(e => e.kind === 'text').length, 0);
  assert.deepEqual(f.calls.feedback, []);
  assert.deepEqual(f.calls.soma, []);
});

test('full final validation catches unsafe text formed by chunk filtering', async () => {
  const f = runtimeFixture({ screen: (chunk) => ({ ok: !chunk.includes('harmless gap') }) });
  const candidate = 'heard it |. harmless gap. .';
  assert.equal(validateCharacterCandidate(candidate).ok, true);
  const r = await f.execute(candidate, stop);
  assert.equal(r.journalFinalizationRejected, true);
  assert.equal(f.calls.events.filter(e => e.kind === 'text').length, 0);
  assert.deepEqual(f.calls.feedback, []);
});

test('every exact emitted byte is validated first and becomes feedback only after emission', async () => {
  const f = runtimeFixture();
  const r = await f.execute('door clicked. still dont fancy sleep rn', stop);
  const published = f.calls.events.filter(e => e.kind === 'text').map(e => e.payload.s).join('');
  assert.equal(validateCharacterCandidate(published).ok, true);
  assert.equal(r.full, published);
  assert.equal(f.calls.feedback.join(''), published);
  assert.equal(f.calls.saved.at(-1).endsWith(published), true);
  assert.equal(f.calls.soma.length, 1);
  assert.equal(f.calls.outcomes[0][1], 'journal-finalization-accepted');
});

test('nested encoded punctuation fails closed instead of changing between publication and actual feedback', async () => {
  const f = runtimeFixture();
  const candidate = normalizeWakingProse('a &amp;lt; b');
  assert.equal(candidate, 'a &lt; b');
  const r = await f.execute(candidate, stop);
  assert.equal(r.journalFinalizationRejected, true);
  assert.ok(r.finalValidation.reasons.includes('final journal would change under feedback sanitation'));
  assert.equal(f.calls.events.filter(e => e.kind === 'text').length, 0);
  assert.deepEqual(f.calls.saved, []);
  assert.deepEqual(f.calls.feedback, []);
});

test('one validated journal commit preserves word separation across existing buffered newline boundaries', async () => {
  const f = runtimeFixture();
  const candidate = 'door clicked.\nstill dont fancy sleep rn';
  const r = await f.execute(candidate, stop);
  const published = 'door clicked. still dont fancy sleep rn';
  assert.equal(r.full, published);
  const events = f.calls.events.filter(e => e.kind === 'text');
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.s, published);
  assert.equal(f.calls.saved.at(-1).endsWith(published), true);
  assert.deepEqual(f.calls.feedback, [published]);
});

test('existing final whitespace normalization happens before publication, never to words', async () => {
  const f = runtimeFixture();
  const r = await f.execute('still finkin bout it rn  \n', stop);
  assert.equal(r.full, 'still finkin bout it rn');
  assert.equal(f.calls.saved.at(-1).endsWith(r.full), true);
  assert.deepEqual(f.calls.feedback, [r.full]);
});

test('a publication exception cannot append that unpublished chunk to continuation', async () => {
  const f = runtimeFixture({ failEmit: true });
  await assert.rejects(f.execute('door clicked.', stop), /publication failed/);
  assert.deepEqual(f.calls.feedback, []);
  assert.deepEqual(f.calls.soma, []);
});

test('filtering cannot turn an incomplete original length tail into an accepted journal', () => {
  assert.equal(validateJournalPublication('door clicked.', length, 'door clicked. still wonder why').ok, false);
});

test('existing initial/repair policy stays bounded; finalization adds no call', async () => {
  for (const repairCandidate of ['still waitin for the bolt.', 'Please write more of Cy\'s thoughts.']) {
    let calls = 0;
    const result = await generateWithCharacterRepair({ prompt: 'original', generate: async () => ({
      candidate: ++calls === 1 ? 'Please proceed and write more of Cy\'s thoughts.' : repairCandidate,
      stats: stop,
    }) });
    assert.equal(calls, 2);
    if (result.characterDiscarded) continue;
    const f = runtimeFixture();
    await f.execute(result.candidate, result.stats);
    assert.equal(calls, 2);
  }
  assert.equal(completionBudget(62), 93);
});

test('existing within-burst repeat decision still stops at the same prefix', async () => {
  const f = runtimeFixture();
  const text = 'the trolley wheel squeaked along the corridor. the trolley wheel squeaked along the corridor.';
  const r = await f.execute(text, stop);
  assert.equal(r.full, 'the trolley wheel squeaked along the corridor.');
  assert.equal(f.calls.feedback.join(''), r.full);
});

test('prompt bytes, repair policy, continuation representation and retry loop are unchanged', () => {
  const old = path => execFileSync('git', ['show', `${BASE}:runner/${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
  assert.equal(readFileSync(new URL('./prompt.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), old('prompt.js'));
  assert.equal(extract(run, '      for (;;) {\n        if (discards >= MAX_DISCARDS)', '      const burstMs = Date.now() - burstStart;'),
    extract(old('run.js'), '      for (;;) {\n        if (discards >= MAX_DISCARDS)', '      const burstMs = Date.now() - burstStart;'));
  const character = readFileSync(new URL('./character-output.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(character.slice(character.indexOf('export async function generateWithCharacterRepair')),
    old('character-output.js').slice(old('character-output.js').indexOf('export async function generateWithCharacterRepair')));
  assert.equal(extract(run, '  async function appendContext(', '  // Shrink the effective context tail'),
    extract(old('run.js'), '  async function appendContext(', '  // Shrink the effective context tail'));
});

test('fixture history stays byte-identical after offline execution', async () => {
  const before = JSON.stringify(fixtures);
  for (const fixture of fixtures.cases) await runtimeFixture().execute(fixture.rawRepair, length);
  assert.equal(JSON.stringify(fixtures), before);
});
