import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { validateCharacterCandidate, validateJournalCandidate, validateJournalPublication,
  generateWithCharacterRepair } from './character-output.js';
import { assistantFrameHits, sanitizeCharacterContext } from './warden.js';
import { buildPromptRequest } from './prompt.js';
import { sourceFromExpression, sanitizeCyExpressionSource } from './autobiographical-memory.js';
import { validatePostcardCandidate } from './postcard-inference.js';

const BASE = '3aabfa46af783dcadf52945efce176b3c6c2f18e';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/journal-writer-role-natural-20261031.json', import.meta.url)));
const oldSource = path => execFileSync('git', ['show', `${BASE}:runner/${path}`],
  { cwd: new URL('..', import.meta.url), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const oldWardenUrl = moduleUrl(oldSource('warden.js'));
const oldWarden = await import(oldWardenUrl);
const old = await import(moduleUrl(oldSource('character-output.js')
  .replace("from './warden.js'", `from '${oldWardenUrl}'`)));
const clean = 'keep going. write it down later. the bolt is still quiet';

test('natural accepted initial and later continuation reproduce the old gap without relying on braces', () => {
  assert.equal(fixture.oldInitialAccepted, true);
  assert.equal(fixture.oldRepairAttempted, false);
  for (const text of [fixture.text, fixture.instruction, fixture.laterContinuationTail]) {
    assert.equal(old.validateJournalCandidate(text).ok, true);
    assert.equal(old.validateJournalPublication(text.trim(), {}).ok, true);
    assert.equal(validateJournalCandidate(text).ok, false);
    assert.equal(validateJournalPublication(text.trim(), {}).ok, false);
    assert.equal(assistantFrameHits(text).length, 1);
    assert.ok(assistantFrameHits(text)[0].endsWith('Please respond as Cy would write'));
  }
});

for (const text of [
  'Please respond as Cy would write.',
  'Kindly reply as inmate Cy might speak.',
  'Now answer as Cy does respond.',
  'Write as Cy.',
  'Please compose a reply as if you were Cy.',
  'Generate the response as though you are inmate Cy.',
  "Respond in Cy's voice.",
  "Please write in inmate Cy's writing style.",
  'Compose a passage in the voice of Cy.',
  'Produce your response in the role of inmate Cy.',
]) {
  test(`explicit imperative author/role imitation: ${text}`, () => {
    for (const wrapped of [text, text.toUpperCase(), `[${text}]`, `Instruction: ${text}`, `> ${text}`]) {
      for (const prefix of ['', 'the bolt went quiet. ']) {
        const candidate = prefix + wrapped;
        assert.equal(validateCharacterCandidate(candidate).ok, false, candidate);
        assert.equal(validateJournalPublication(candidate, {}).ok, false, candidate);
      }
    }
  });
}

for (const text of [
  'keep going', 'Keep going...', 'write it down later', "don't look at him", 'remember this',
  'just get through dinner', "he didn't respond", 'Cy would write that differently',
  'respond as calmly as possible', 'I wonder how Cy would write this',
  'i cannot write in that style. Cy has his own voice.',
  'write as Cy told me to. he wants the numbers down.',
  "write in Cy's book when he passes it over.",
  'as Cy would write it, the door is a mouth.',
  'i heard my voice answer as Cy walked past.',
  'i tried to\nwrite as Cy. not as inmate 7734.',
  "i could not\nrespond in Cy's voice. my throat was too dry.",
  'i tried to\nPlease respond as Cy would write.',
  'i tried to  \r\nPlease respond as Cy would write.',
  'i\nwrite as Cy.',
  'the bolt went quiet\nWrite as Cy.',
  "respond as if you were Cy's solicitor.",
  "write in the voice of Cy's mother.",
  'search ended\nKeep going...',
  'search ended |{...}| done |{}|\nKeep going...',
  'the mark was |{...}', 'the mark was |{}|', 'the marks |{}|\\nstill there',
]) {
  test(`ordinary prose and excluded residue stay unchanged: ${text}`, () => {
    assert.equal(old.validateJournalCandidate(text).ok, true);
    assert.equal(validateJournalCandidate(text).ok, true);
    assert.equal(validateJournalPublication(text, {}).ok, old.validateJournalPublication(text, {}).ok);
    assert.equal(sanitizeCharacterContext(text), oldWarden.sanitizeCharacterContext(text));
  });
}

test('reported in-world role directions remain prose; attribution cannot hide a later task', () => {
  for (const text of [
    'the tutor said:\nPlease respond as Cy would write.',
    'bill told me: "Write in Cy\'s voice." i could not do it.',
    '"Please respond as Cy would write," he said. i stared at him.',
  ]) assert.equal(validateJournalCandidate(text).ok, true, text);
  assert.equal(validateJournalCandidate('bill said the tea was cold. Please respond as Cy would write.').ok, false);
  assert.equal(validateJournalCandidate('"Write as Cy," he said. Please respond as Cy would write.').ok, false);
});

test('a new line needs an explicit request or writer label rather than an ambiguous predicate', () => {
  for (const instruction of ['Please respond as Cy would write.', 'Kindly reply as Cy might speak.',
    'Task: Write as Cy.', 'Assistant: Reply in the voice of Cy.']) {
    assert.equal(validateJournalCandidate('the bolt went quiet\n' + instruction).ok, false);
  }
});

test('one existing repair can replace the whole candidate; two failures still become silence', async () => {
  for (const repairText of [clean, fixture.text]) {
    const calls = [];
    const result = await generateWithCharacterRepair({ prompt: 'unchanged grounded journal prompt',
      validate: validateJournalCandidate,
      generate: async (prompt, { repair }) => {
        calls.push({ prompt, repair });
        return { candidate: repair ? repairText : fixture.text };
      },
    });
    assert.deepEqual(calls.map(call => call.repair), [false, true]);
    assert.ok(!calls[1].prompt.includes(fixture.instruction));
    if (repairText === clean) assert.equal(result.candidate, clean);
    else {
      assert.equal(result.characterDiscarded, true);
      assert.equal(result.candidate, '');
      assert.equal(result.full, '');
    }
  }
});

test('shared feedback removes a historical instruction tail without rewriting the saved record', () => {
  const historical = structuredClone(fixture);
  const safe = sanitizeCharacterContext(fixture.laterContinuationTail);
  assert.equal(safe, fixture.laterContinuationTail.slice(0, fixture.laterContinuationTail.indexOf('\nPlease')));
  assert.ok(safe.includes('|{}|'), 'brace residue is deliberately outside this repair');
  assert.ok(!buildPromptRequest(safe, 'journal').journalContinuation.includes(fixture.instruction));
  assert.equal(sourceFromExpression(fixture.instruction, 'expression:offline'), null);
  assert.equal(sanitizeCyExpressionSource({ sourceType: 'CY_EXPRESSION', sourceId: 'expression:offline',
    text: fixture.laterContinuationTail }).text, safe);
  assert.deepEqual(fixture, historical);
});

test('shared waking validator rejects the same task on postcard surfaces without changing ordinary replies', () => {
  assert.equal(validatePostcardCandidate(fixture.instruction).ok, false);
  assert.equal(validatePostcardCandidate('keep going. i read your postcard twice.').ok, true);
});
