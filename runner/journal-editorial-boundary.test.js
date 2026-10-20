import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateWithCharacterRepair, validateCharacterCandidate } from './character-output.js';
import { validatePostcardCandidate } from './postcard-inference.js';
import { assistantFrameHits, sanitizeCharacterContext } from './warden.js';
import { buildPrompt, selectJournalContinuation } from './prompt.js';
import {
  buildFormationRequest, filterMemoriesBeforePrompt, formatAutobiographicalMemory,
  sanitizeCyExpressionSource, sourceFromExpression,
} from './autobiographical-memory.js';
import { AutobiographicalMemoryRuntime } from './memory-runtime.js';

const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/waking-journal-editorial-2026-10-20.json', import.meta.url), 'utf8',
));
const leaks = [
  '36 words left (and this will end here)',
  '38 left (<= cy is at cell) [it ends here]',
  fixture.earlierUserReported,
  ...fixture.published.map((row) => row.text),
];

test('real public candidates and the earlier progress fixture fail whole-candidate validation', () => {
  assert.deepEqual(fixture.published.map((row) => row.diagnosticEventSeq), [2786655, 2787007]);
  for (const text of leaks) {
    const result = validateCharacterCandidate(text);
    assert.equal(result.ok, false, text);
    assert.ok(result.reasons.length, text);
    assert.deepEqual(result.reasons, assistantFrameHits(text));
  }
});

test('editorial meaning generalises across counts, units, delimiters and procedural wording', () => {
  for (const annotation of [
    '(147 tokens remaining)', '[8 characters to go]', '| 217 words left |',
    '17 words remaining (this will end here)',
    '71 left [it stops here]',
    '38 left (<= cy is at cell)\n[it ends here]',
    '38 left (<= cy is at cell)\r\n[it ends here]',
    '5 remaining (state: writing) [this will end here]',
    '12 remaining [this continues later]', '7 left [it should stop now]',
    '8/97 complete. Stop here. Resume the entry later.',
    'word count: 71', 'token budget = 200', 'remaining words: 14',
    '(generation status: complete)', '| output progress: 43% |',
    '[this entry is now complete]', '(response has been finished)',
    '[entry ends here]', '(this entry will end here)', '[end of the entry]',
    'Continue another entry from this point later.',
    'Please finish the response here.',
    "I'll end this entry here.", 'I will construct the next entry.',
    'let me resume this output.',
  ]) {
    for (const text of [annotation, `cold tea again. ${annotation}`, `cold tea | ${annotation}`]) {
      assert.equal(validateCharacterCandidate(text).ok, false, text);
    }
  }
});

test('ordinary in-world vocabulary, quantities, annotations and dialogue remain unchanged', () => {
  for (const text of [
    "i got 36 words left in his letter before the paper tore.",
    '36 words left on the wall. he rubbed the rest away.',
    '38 left in the pack (the cards, not people).',
    '3/42 done on the work sheet. 39 envelopes left.',
    'stop here for now, reg said. continue down the landing later.',
    'i stopped here for now. my legs had gone.',
    'the queue ends here. [wait] on the door. still three ahead of me.',
    "the passage ends here. there's a steel gate ahead.",
    'i will end this row with reg before he leaves.',
    'i will continue the story when he comes back.',
    'i wrote another entry in this thing. still no words from bill.',
    'his words left me cold. no end to it.',
    'the form says word limit: 50. those are their rules.',
    'two canteen tokens left | and no tea...',
    'he left 36 on the table (and this will end badly).',
    '[it ends here] i told myself about the arguing.',
    'i copied |...| off the wall. [two marks] then > three...',
  ]) {
    assert.equal(validateCharacterCandidate(text).ok, true, text);
    assert.equal(sanitizeCharacterContext(text), text, text);
  }
});

test('initial meta candidate is never salvaged for publication; clean repair alone is accepted', async () => {
  for (const text of leaks) {
    const calls = [];
    const diagnostics = [];
    const result = await generateWithCharacterRepair({
      prompt: 'original grounded prompt',
      generate: async (prompt, { repair }) => {
        calls.push({ prompt, repair });
        return { candidate: repair ? 'the boots stopped. still waiting for the next sound.' : text };
      },
      onDiagnostic: async (detail) => diagnostics.push(detail),
    });
    assert.deepEqual(calls.map((call) => call.repair), [false, true]);
    assert.ok(calls[1].prompt.startsWith('original grounded prompt'));
    assert.ok(!calls[1].prompt.includes(text), 'invalid text is not repair input');
    assert.equal(result.candidate, 'the boots stopped. still waiting for the next sound.');
    assert.equal(result.characterValidation.initial.ok, false);
    assert.equal(result.characterValidation.repair.ok, true);
    assert.equal(diagnostics[0].initialCandidate, text, 'private diagnosis retains actual rejected candidate');
  }
});

test('a different editorial form in repair still becomes silence, never a second repair', async () => {
  let calls = 0;
  const result = await generateWithCharacterRepair({
    prompt: 'original grounded prompt',
    generate: async () => ({ candidate: leaks[calls++ % 2] }),
  });
  assert.equal(calls, 2);
  assert.equal(result.candidate, '');
  assert.equal(result.full, '');
  assert.equal(result.characterDiscarded, true);
  assert.equal(result.characterValidation.finalAction, 'discarded-to-silence');
  assert.equal(sanitizeCharacterContext(result.candidate), '');
});

test('transport interruption does not acquire a new repair entitlement', async () => {
  let calls = 0;
  const result = await generateWithCharacterRepair({
    prompt: 'original grounded prompt',
    generate: async () => { calls++; return { candidate: leaks[0], aborted: true }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.aborted, true);
});

test('all existing waking purposes share repair/silence semantics for the new annotations', async () => {
  for (const purpose of ['journal', 'drawing-intent', 'postcard', 'warden-response']) {
    let calls = 0;
    const result = await generateWithCharacterRepair({
      prompt: purpose,
      ...(purpose === 'postcard' ? { validate: validatePostcardCandidate } : {}),
      generate: async () => { calls++; return { candidate: leaks[1] }; },
    });
    assert.equal(calls, 2, purpose);
    assert.equal(result.characterDiscarded, true, purpose);
  }
  // Existing entry points must still converge before onChunk/publication.
  const run = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
  const body = run.slice(run.indexOf('async function streamGenerate('));
  assert.ok(body.indexOf('await generateWithCharacterRepair(') < body.indexOf('for (const chunk of chunks) await onChunk'));
  assert.match(body, /guarded\.characterDiscarded[\s\S]*?return guarded;/);
});

test('live/restart flattened context drops the annotation and the entire unsafe continuation', () => {
  for (const text of [...leaks.slice(0, 3), '38 left (<= cy is at cell)\n[it ends here]']) {
    for (const join of [' ', '\n']) {
      const oldHistory = { text: `cold tea again.${join}${text}${join}unsafe later continuation` };
      const original = structuredClone(oldHistory);
      const safe = sanitizeCharacterContext(oldHistory.text);
      assert.equal(safe, 'cold tea again.');
      assert.equal(sanitizeCharacterContext(safe), safe);
      assert.deepEqual(oldHistory, original, 'historical public source is untouched');
      const prompt = buildPrompt(selectJournalContinuation(safe), 'journal', null);
      assert.ok(!prompt.includes(text));
      assert.ok(!prompt.includes('unsafe later continuation'));
    }
  }
});

test('actual second prompt continuation no longer admits the first published annotation', () => {
  assert.match(fixture.continuationSuppliedToSecond, /36 words left/);
  const safe = sanitizeCharacterContext(fixture.continuationSuppliedToSecond);
  assert.doesNotMatch(safe, /36 words left|this will end here|mind whirln/);
  assert.ok(safe.includes('expectatinz matter'), 'safe prior subjective prefix survives');
  const prompt = buildPrompt(safe, 'journal', null);
  assert.match(prompt, /prior_subjective_thought/);
  assert.doesNotMatch(prompt, /36 words left|this will end here/);
});

test('expression source formation and surfacing reuse the same boundary without touching source history', () => {
  for (const text of leaks.slice(0, 3)) {
    assert.equal(sourceFromExpression(text, 'expression:test'), null);
    const source = {
      sourceType: 'CY_EXPRESSION', sourceId: 'expression:test',
      sourceVisibility: 'INTERNAL_ONLY', text: `cold tea again. ${text} unsafe later continuation`,
    };
    const before = structuredClone(source);
    assert.equal(sanitizeCyExpressionSource(source).text, 'cold tea again.');
    const request = buildFormationRequest(source);
    assert.ok(!JSON.stringify(request).includes(text));
    const memory = {
      id: 'memory-test', type: 'EPISODIC', status: 'ACTIVE', privacyScope: 'PUBLIC_RECALLABLE',
      content: source.text, publicSummary: source.text, consistencyStatus: 'UNCERTAIN', version: 1,
    };
    assert.equal(filterMemoriesBeforePrompt([memory])[0].content, 'cold tea again.');
    assert.ok(!formatAutobiographicalMemory([memory]).includes(text));
    assert.deepEqual(source, before);
  }
});

test('durable pending memory jobs and queued recent-expression context cannot bypass filtering', async () => {
  const completed = [];
  const queued = [];
  const queried = [];
  const runtime = new AutobiographicalMemoryRuntime({
    client: {
      async finishMemorySource(value) { completed.push(value); },
      async enqueueMemorySource(value) { queued.push(value); return { queued: true }; },
      async queryMemories(value) { queried.push(value); return { candidates: [] }; },
      async completeMemorySurfacing() {},
      async recordMemoryQuery() {},
    },
    makeId: () => '00000000-0000-4000-8000-000000000012',
    generate: async () => { throw new Error('no model call is allowed in this test'); },
  });
  runtime.schedule = () => {};
  for (const [i, text] of leaks.slice(0, 3).entries()) {
    const source = { sourceType: 'CY_EXPRESSION', sourceId: `expression:${i}`, text };
    const result = await runtime.processFormation({ id: i + 1, source });
    assert.equal(result.status, 'NOTHING');
    assert.equal(completed[i].operations.length, 0);
    await runtime.queueSource({ ...source, text: `cold tea again. ${text}` });
    assert.equal(queued[i].text, 'cold tea again.');
    await runtime.processSurfacing({ id: i + 10, context: {
      text: 'the door closed', recentExpressionText: `cold tea again. ${text}`,
    } });
    assert.equal(queried[i].recentExpressionText, 'cold tea again.');
  }
});

test('prior malformed/control and explicit assistant-role boundaries stay active', () => {
  for (const text of [
    'screw went | im end >', 'screw went |im_end|>', 'screw went <|im_end|>',
    'screw went |... then stopped', "Note: I'll be writing this entry as Cy.",
  ]) assert.equal(validateCharacterCandidate(text).ok, false, text);
});
