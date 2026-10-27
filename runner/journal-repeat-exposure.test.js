import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { buildPrompt, buildPromptRequest, selectJournalContinuation } from './prompt.js';
import { isRepeat, isJournalRepeat } from './warden.js';
import { generateWithCharacterRepair } from './character-output.js';

const BASE = '1dc609d2116c0035735c312e69bc64bec0e7c52f';
const run = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/journal-repeat-natural-20261025.json', import.meta.url), 'utf8')).cases;
function baseline(path) {
  return execFileSync('git', ['show', `${BASE}:runner/${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
}
const oldWarden = baseline('warden.js');
const oldRepeat = runInNewContext(oldWarden.slice(oldWarden.indexOf('function normText('),
  oldWarden.indexOf('// True if `chunk`')).replace(/export /g, '') + '\nisRepeat;');
const oldPromptSource = baseline('prompt.js').replace(/from '(\.\/[^']+)'/g,
  (_match, path) => `from '${new URL(path, import.meta.url).href}'`);
const oldPrompt = await import('data:text/javascript;base64,' + Buffer.from(oldPromptSource).toString('base64'));

const copied = 'the trolley wheel kept squeaking along the corridor outside the cell';

test('an opening substantial copy is still rejected with existing normalization', () => {
  assert.equal(oldRepeat(copied, copied), true);
  assert.equal(isJournalRepeat(copied.toUpperCase().replaceAll(' ', ' -- '), copied), true);
});

test('a substantial copy after normalized character 240 is checked in full', () => {
  const candidate = 'a different opening about the light across the ceiling. '.repeat(7) + copied;
  assert.equal(oldRepeat(candidate, copied), false);
  assert.equal(isJournalRepeat(candidate, copied), true);
});

test('the exposed continuation is not reduced to an independent last-400 window', () => {
  const continuation = copied + ' ' + 'another unrelated thought near the end of the page. '.repeat(8);
  const request = buildPromptRequest(continuation, 'journal', null);
  assert.equal(request.journalContinuation.length <= 520, true);
  assert.ok(request.journalContinuation.startsWith(copied));
  assert.equal(oldRepeat(copied, continuation), false);
  assert.equal(isJournalRepeat(copied, request.journalContinuation), true);
});

for (const fixture of fixtures) {
  test(`natural missed-copy fixture ${fixture.sequence}: old misses, new catches at unchanged threshold`, () => {
    const request = buildPromptRequest(fixture.savedContextSuffix, 'journal', null);
    assert.equal(oldRepeat(fixture.candidate, fixture.savedContextSuffix), false);
    assert.equal(isRepeat(fixture.candidate, fixture.savedContextSuffix), false);
    assert.equal(isJournalRepeat(fixture.candidate, request.journalContinuation), true);
  });
}

test('the substantial-copy threshold remains 40 normalized characters, including late copies', () => {
  const shared = '0123456789'.repeat(4);
  for (const count of [39, 40]) {
    const text = shared.slice(0, count);
    assert.equal(oldRepeat(text, shared), count === 40);
    assert.equal(isJournalRepeat(text, shared), count === 40);
    assert.equal(isJournalRepeat('different opening '.repeat(20) + text, shared), count === 40);
  }
});

test('recurring concerns with materially different wording remain allowed', () => {
  for (const [prior, next] of [
    ['dont know if id eat that rubbish tbh cos they said so many times', 'another tray and i still cant face lunch. the smell puts me off.'],
    ['i keep thinking about the search and what sweep might have wanted', 'that cell search bothers me. maybe he expected something i never had.'],
    ['the trolley wheel kept squeaking along the corridor outside the cell', 'heard that wheel again. wonder when theyll mend it.'],
  ]) assert.equal(isJournalRepeat(next, prior), false);
});

test('short common phrases and absent continuation are not overblocked', () => {
  assert.equal(isJournalRepeat('same ceiling again. the door is quiet now.', 'same ceiling again. heard a shout.'), false);
  for (const absent of ['', null, undefined]) assert.equal(isJournalRepeat(copied, absent), false);
  assert.equal(isJournalRepeat('', copied), false);
});

test('prompt construction returns the exact single subjective source, including escapes', () => {
  const request = buildPromptRequest(('older thought. '.repeat(100)) + '\nhe said "wait". ' + copied, 'journal', null,
    '{"source":"world_evidence","content":"The count finished."}');
  const prior = request.prompt.split('\n').flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).filter((item) => item.source === 'prior_subjective_thought');
  assert.equal(prior.length, 1);
  assert.equal(prior[0].content, request.journalContinuation);
  assert.equal(request.journalContinuation, selectJournalContinuation(('older thought. '.repeat(100)) + '\nhe said "wait". ' + copied));
  assert.equal(buildPromptRequest('', 'journal', null).journalContinuation, '');
});

test('later buffer changes cannot change what this generation is validated against', () => {
  let buffer = copied;
  const request = buildPromptRequest(buffer, 'journal', null);
  buffer = 'a completely unrelated current record after the request was constructed';
  assert.equal(isJournalRepeat(copied, request.journalContinuation), true);
  assert.equal(isJournalRepeat(copied, selectJournalContinuation(buffer)), false);
});

test('unexposed old prose and other prompt sources are not treated as subjective continuation', () => {
  const buffer = copied + ' different newer thought about the door.'.repeat(30);
  const request = buildPromptRequest(buffer, 'journal', null, copied);
  assert.ok(!request.journalContinuation.includes(copied));
  assert.ok(request.prompt.includes(copied));
  assert.equal(isJournalRepeat(copied, request.journalContinuation), false);
});

test('all prompt modes remain byte-identical to production, with no instruction or exposure changes', () => {
  for (const context of ['', '  recent thought.  ', ('earlier thought '.repeat(70)) + copied]) {
    for (const [mode, payload] of [
      ['journal', null], ['postcard', { from_name: 'visitor', body: 'hello', caption: 'a tree', image_path: 'fixture' }],
      ['warden', { text: 'Count.' }], ['dream', { wake: true }], ['sleep', null],
    ]) {
      const request = buildPromptRequest(context, mode, payload, 'grounded directives');
      assert.equal(request.prompt, oldPrompt.buildPrompt(context, mode, payload, 'grounded directives'));
      assert.equal(request.prompt, buildPrompt(context, mode, payload, 'grounded directives'));
      assert.equal(request.journalContinuation, mode === 'journal' ? selectJournalContinuation(context.trim()) : null);
    }
  }
});

function extract(source, first, last) {
  const a = source.indexOf(first), b = source.indexOf(last, a);
  assert.ok(a >= 0 && b > a, `runtime boundary missing: ${first}`);
  return source.slice(a, b);
}

// Execute the actual pre-publication guard and existing retry loop with canned
// candidates. No runner main, provider, network, inference or real state access.
function runtimeFixture(candidateForRequest) {
  const calls = { requests: [], published: [], discarded: [], outcomes: [], caps: [], spend: [] };
  const boundary = extract(run, '    const repeated = mode', '    const buffer = warden.newBuffer();');
  const guard = runInNewContext(`(async function({ mode, journalContinuation = null, contextTail, candidate }) {
    const accounted = { out: candidate };
    const guarded = { requestId: 'mock-only' };
    const attempts = [{ stats: {} }];
    ${boundary}
    published.push(candidate);
    return { full: candidate };
  })`, {
    isRepeat, isJournalRepeat, published: calls.published,
    journalLocationResult: result => result, // Existing repeat-only fixture stays in CELL.
    recordInferenceOutcome: (...args) => calls.outcomes.push(args),
    logHoldbackDiscard: async (...args) => calls.discarded.push(args),
    recordSpend: async (...args) => calls.spend.push(args),
  });
  const originalLoop = extract(run, '      for (;;) {\n        if (discards >= MAX_DISCARDS)', '      const burstMs = Date.now() - burstStart;');
  const loop = runInNewContext(`(async function() {
    let discards = 0, assistantFrameDiscards = 0, tempBump = 0, penBump = 0;
    let attempted = false, produced = false, errored = false, refusedGen = false;
    let lastFull = '', lastResult = null, lastTail = '', lastOpts = null;
    let contextBuf = ${JSON.stringify(('prior unrelated words. '.repeat(35)) + copied)};
    const contextText = () => contextBuf;
    const trimContext = (fraction) => { contextBuf = contextBuf.slice(Math.floor(contextBuf.length * fraction)); };
    ${originalLoop}
    return { discards, produced, lastFull, lastTail, errored, refusedGen };
  })`, {
    buildPromptRequest, ZONE_A: '', mode: 'journal', directives: '', allowRepeat: false,
    baseOpts: { temperature: 0.8, repeat_penalty: 1.1 },
    MAX_DISCARDS: Number(run.match(/const MAX_DISCARDS = (\d+);/)[1]),
    FOREGROUND_INFERENCE_TIMEOUT_MS: 420000,
    expressiveChoice: {}, EXPRESSIVE_CHOICE_MECHANISM: 'model',
    logPrompt: async () => {},
    streamGenerate: async (request) => {
      calls.requests.push(request);
      const source = request.prompt.split('\n').map((line) => { try { return JSON.parse(line); } catch { return {}; } })
        .find((item) => item.source === 'prior_subjective_thought');
      assert.equal(source.content, request.journalContinuation);
      return guard({ ...request, candidate: candidateForRequest(request, calls.requests.length) });
    },
    logCapHit: async (...args) => calls.caps.push(args),
    logDiscard: async () => {}, recordOutcome: async (...args) => calls.outcomes.push(args),
  });
  return { calls, loop, guard };
}

test('actual publication boundary rejects a late copy before any publication', async () => {
  const f = runtimeFixture(() => 'unused');
  const r = await f.guard({ mode: 'journal', journalContinuation: copied, contextTail: 'different later state',
    candidate: 'brand new introduction '.repeat(20) + copied });
  assert.equal(r.repeat, true);
  assert.equal(f.calls.published.length, 0);
  assert.equal(f.calls.discarded.length, 1);
  assert.equal(f.calls.spend.length, 1);
});

test('ordinary accepted journals pass the same publication boundary', async () => {
  const f = runtimeFixture(() => 'unused');
  const candidate = 'heard that wheel again. wonder when theyll mend it.';
  const r = await f.guard({ mode: 'journal', journalContinuation: copied, contextTail: copied, candidate });
  assert.equal(r.full, candidate);
  assert.equal(f.calls.published[0], candidate);
  assert.equal(f.calls.discarded.length, 0);
});

test('a character-repair candidate is still checked against the original exposure', async () => {
  const request = buildPromptRequest(copied, 'journal', null);
  let attempts = 0;
  const result = await generateWithCharacterRepair({
    prompt: request.prompt,
    generate: async () => ({ candidate: ++attempts === 1
      ? 'Please proceed and write more of Cy\'s thoughts as requested.' : copied }),
  });
  assert.equal(attempts, 2);
  assert.equal(result.characterValidation.repairAttempted, true);
  const f = runtimeFixture(() => 'unused');
  const checked = await f.guard({ mode: 'journal', journalContinuation: request.journalContinuation,
    contextTail: 'later state does not replace the request exposure', candidate: result.candidate });
  assert.equal(checked.repeat, true);
  assert.equal(f.calls.published.length, 0);
});

test('missing or null journal exposure retains the old caller fallback safely', async () => {
  const f = runtimeFixture(() => 'unused');
  for (const extra of [{}, { journalContinuation: null }]) {
    const result = await f.guard({ mode: 'journal', contextTail: copied, candidate: copied, ...extra });
    assert.equal(result.repeat, true);
  }
  assert.equal(f.calls.published.length, 0);
  const empty = await f.guard({ mode: 'journal', journalContinuation: '', contextTail: copied, candidate: copied });
  assert.equal(empty.repeat, undefined, 'explicitly empty exposure does not fall back to unexposed saved prose');
});

test('repeat rejection uses the real existing bounded retry loop and stays silent at its cap', async () => {
  const f = runtimeFixture((request) => request.journalContinuation);
  const result = await f.loop();
  assert.equal(result.discards, 2);
  assert.equal(result.produced, false);
  assert.equal(f.calls.requests.length, 2);
  assert.equal(f.calls.published.length, 0);
  assert.equal(f.calls.caps.length, 1);
  assert.deepEqual(f.calls.requests.map((r) => r.attempt), ['journal-initial', 'near-repeat-retry-1']);
  assert.notEqual(f.calls.requests[0].journalContinuation, f.calls.requests[1].journalContinuation);
});

test('a fresh accepted candidate after one repeat follows the unchanged success path', async () => {
  const candidate = 'the strip light is flickering. waiting to see if it settles.';
  const f = runtimeFixture((request, count) => count === 1 ? request.journalContinuation : candidate);
  const result = await f.loop();
  assert.equal(result.discards, 1);
  assert.equal(result.produced, true);
  assert.equal(result.lastFull, candidate);
  assert.deepEqual(f.calls.published, [candidate]);
  assert.equal(f.calls.caps.length, 0);
});

test('other generation paths retain their old repeat-window behavior', async () => {
  const f = runtimeFixture(() => 'unused');
  const late = 'different words at the beginning '.repeat(15) + copied;
  for (const mode of ['warden', 'letter', 'sleep']) {
    const result = await f.guard({ mode, contextTail: copied, candidate: late });
    assert.equal(result.repeat, undefined);
  }
});

test('the private drawing and ambient-food retirement paths are unchanged', () => {
  const oldRun = baseline('run.js');
  assert.equal(extract(run, '  async function doDraw(', '  // ---- inbox:'),
    extract(oldRun, '  async function doDraw(', '  // ---- inbox:'));
  assert.equal(extract(run, '  const tickTimer = setInterval(async () => {', '  const hostTimer = setInterval('),
    extract(oldRun, '  const tickTimer = setInterval(async () => {', '  const hostTimer = setInterval('));
});
