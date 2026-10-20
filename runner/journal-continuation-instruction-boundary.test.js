import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateWithCharacterRepair, validateCharacterCandidate } from './character-output.js';
import { validatePostcardCandidate } from './postcard-inference.js';
import { assistantFrameHits, malformedProseControlHits, sanitizeCharacterContext } from './warden.js';
import { buildPrompt, selectJournalContinuation } from './prompt.js';
import { sourceFromExpression, sanitizeCyExpressionSource } from './autobiographical-memory.js';

const fixture = JSON.parse(readFileSync(new URL(
  './fixtures/waking-journal-continuation-instruction-2026-10-20.json', import.meta.url), 'utf8'));
const instructions = [
  "Please proceed and write more of Cy's thoughts as requested.",
  'Please proceed and write more of Cy\u2019s thoughts as requested.',
  'Continue from where we stopped this entry',
  "please go ahead and generate more of Cy's inner thoughts.",
  "Kindly proceed with writing more of the inmate's thoughts.",
  "Please proceed, and write more of Cy's thoughts.",
  "Write some more of Cy's thoughts.",
  'Please provide additional journal entry content.',
  'Generate further output from this point.',
  'Resume from the point at which you paused the journal entry.',
  'Continue writing from where we left off.',
  'Pick up writing from where you stopped.',
  "Carry on with Cy's thoughts.",
  "Resume Cy's inner monologue.",
  'Please continue the entry.',
];
const clean = 'the boots stopped. still waiting for the next sound.';

test('exact public leak and its independent continuation instructions are rejected', () => {
  assert.equal(fixture.diagnosticEventSeq, 2794236);
  assert.equal(fixture.validation.initial.ok, true, 'retained old decision');
  assert.equal(fixture.nextJournal.priorSubjectiveContainsProceedInstruction, true);
  assert.equal(validateCharacterCandidate(fixture.text).ok, false);
  assert.ok(assistantFrameHits(fixture.text).length);
  assert.ok(malformedProseControlHits(fixture.text).includes('</'));
});

test('task structure generalises across paraphrases, wrappers, case and line breaks', () => {
  for (const instruction of instructions) {
    for (const wrapped of [instruction, `[${instruction}]`, `(${instruction})`, `| ${instruction} |`,
      `"${instruction}"`, `> ${instruction}`, `\x60${instruction}\x60`, `Instruction: ${instruction}`, instruction.toUpperCase(),
      instruction.replaceAll(' ', '\n')]) {
      for (const prefix of ['', 'cold tea again. ', 'cold tea again | ']) {
        const text = prefix + wrapped;
        assert.equal(validateCharacterCandidate(text).ok, false, text);
        assert.ok(assistantFrameHits(text).length, text);
      }
    }
  }
});

test('bare closing markup remnant independently fails before publication and is filtered from feedback', () => {
  for (const text of ['cold tea.</', 'cold tea.< /', 'cold tea.</  ', 'cold tea.</\n', 'cold tea.</\r\n']) {
    if (text.includes('< /')) {
      assert.equal(validateCharacterCandidate(text).ok, true, 'not widening to arbitrary angle punctuation');
      continue;
    }
    assert.equal(validateCharacterCandidate(text).ok, false, text);
    assert.deepEqual(malformedProseControlHits(text).map((s) => s.trim()), ['</']);
    assert.equal(sanitizeCharacterContext(text), 'cold tea.');
  }
});

test('in-world imperatives, reported writing directions and literal punctuation remain valid', () => {
  for (const text of [
    'please proceed down the landing. keep your head down.',
    'write more to your mum, bill said. he aint wrong.',
    'continue from where we stopped. the wall is still wet.',
    'i was told to continue writing my statement. still got no pen.',
    'bill told me to write more of my thoughts in the appeal letter.',
    'the tutor said: "Please continue the entry," and pointed at my work book.',
    'the tutor said:\nPlease continue the entry.',
    '"Please continue the entry," he told me. i stared at the page.',
    '"Continue writing from where we left off," bill said.',
    'the officer said:\nPlease proceed and write more of your response.',
    'the tutor said:\nPlease proceed and write more of your response as requested.',
    '"Please proceed and write more of your response," Mr Locke said.',
    'reg said, write more of your thoughts. i wrote one word.',
    'my thoughts carry on even when i stop writing.',
    "i saw '</' scratched on the wall. |...| then three marks...",
    '5 < 8. the arrow > points toward the gate. [wait here]',
  ]) {
    assert.equal(validateCharacterCandidate(text).ok, true, text);
    // Existing stripScaffold removes an opening quote at the start of context;
    // this change must not remove the reported instruction or its surrounding words.
    assert.equal(sanitizeCharacterContext(text), text.replace(/^"/, ''), text);
  }
});

test('reported instruction cannot excuse a later independent task continuation', () => {
  const text = '"Please continue the entry," he said. Please continue the entry.';
  assert.equal(validateCharacterCandidate(text).ok, false);
  assert.equal(sanitizeCharacterContext(text), 'Please continue the entry," he said.');
  assert.equal(validateCharacterCandidate('bill said the tea was cold. Please continue the entry.').ok, false);
  assert.equal(validateCharacterCandidate('Please continue the entry. Bill said the tea was cold.').ok, false);
});

test('all shared waking routes use one repair and publish only a clean replacement', async () => {
  for (const purpose of ['journal', 'drawing-intent', 'postcard', 'warden-response']) {
    for (const bad of [fixture.text, ...instructions, 'cold tea.</']) {
      const calls = [];
      const result = await generateWithCharacterRepair({
        prompt: 'original grounded prompt',
        ...(purpose === 'postcard' ? { validate: validatePostcardCandidate } : {}),
        generate: async (prompt, { repair }) => {
          calls.push({ prompt, repair });
          return { candidate: repair ? clean : bad };
        },
      });
      assert.deepEqual(calls.map((c) => c.repair), [false, true], purpose + bad);
      assert.ok(!calls[1].prompt.includes(bad), 'invalid text is not repair input');
      assert.equal(result.candidate, clean);
      assert.equal(result.characterValidation.initial.ok, false);
      assert.equal(result.characterValidation.repair.ok, true);
    }
  }
});

test('invalid repair becomes silence, including independent markup-only failure', async () => {
  for (const repair of [fixture.text, ...instructions, 'cold tea.</']) {
    let calls = 0;
    const result = await generateWithCharacterRepair({
      prompt: 'original grounded prompt',
      generate: async () => ({ candidate: calls++ ? repair : fixture.text }),
    });
    assert.equal(calls, 2);
    assert.equal(result.characterDiscarded, true);
    assert.equal(result.candidate, '');
    assert.equal(result.full, '');
    assert.equal(result.characterValidation.finalAction, 'discarded-to-silence');
  }
});

test('continuation and recent-expression consumers discard the instructional tail, not public history', () => {
  for (const bad of [fixture.text, ...instructions]) {
    const historical = { text: `cold tea again. ${bad} unsafe later writing` };
    const before = structuredClone(historical);
    const safe = sanitizeCharacterContext(historical.text);
    assert.ok(!safe.includes('Please proceed'));
    assert.ok(!safe.includes('unsafe later writing'));
    assert.equal(validateCharacterCandidate(safe).ok, true);
    const prompt = buildPrompt(selectJournalContinuation(safe), 'journal', null);
    assert.ok(!prompt.includes('unsafe later writing'));
    assert.match(prompt, /prior_subjective_thought/);
    const formationSource = sourceFromExpression(bad, 'expression:test');
    assert.ok(!formationSource || !/Please proceed|Continue from where|unsafe later writing/.test(formationSource.text));
    if (bad !== fixture.text) assert.equal(formationSource, null, 'instruction alone is not a memory source');
    const source = sanitizeCyExpressionSource({ sourceType: 'CY_EXPRESSION', sourceId: 'expression:test', text: historical.text });
    assert.equal(source.text, safe);
    assert.deepEqual(historical, before);
  }
});

test('existing whole-candidate rejection remains ahead of onChunk and context append', () => {
  const run = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
  const body = run.slice(run.indexOf('async function streamGenerate('));
  assert.ok(body.indexOf('await generateWithCharacterRepair(') < body.indexOf('for (const chunk of chunks) await onChunk'));
  assert.match(body, /guarded\.characterDiscarded[\s\S]*?return guarded;/);
  assert.match(run, /const contextText = \(\) => sanitizeCharacterContext\(contextBuf\)/);
  assert.match(run, /contextBuf \+= sanitizeCharacterContext\(chunk\)/);
});
