import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  generateWithCharacterRepair, validateCharacterCandidate, validateJournalCandidate,
  validateJournalPublication,
} from './character-output.js';
import { normalizeWakingProse, sanitize, sanitizeCharacterContext } from './warden.js';

const BASE = 'b8a7347b95911eb0068818a567869e99727dda67';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/journal-unclosed-angle-natural-20261026.json', import.meta.url)));
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const baseline = path => execFileSync('git', ['show', `${BASE}:runner/${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
const oldSource = baseline('character-output.js').replace("from './warden.js'", `from '${new URL('./warden.js', import.meta.url).href}'`);
const old = await import('data:text/javascript;base64,' + Buffer.from(oldSource).toString('base64'));

for (const fixture of fixtures.cases) {
  test(`natural ${fixture.seq}: deployed base accepts the observed form, journal fix rejects it`, () => {
    assert.equal(fixture.published.indexOf('<'), fixture.angleOffset);
    assert.ok(/(?:\| |\.\.\. )$/.test(fixture.precedingText));
    assert.equal(fixture.published.includes('>'), false);
    assert.equal(old.validateCharacterCandidate(fixture.published).ok, true);
    assert.equal(validateCharacterCandidate(fixture.published).ok, true, 'other prose policy is unchanged');
    assert.equal(sanitize(fixture.published), fixture.published, 'existing sanitizer misses exactly this shape');
    assert.equal(validateJournalCandidate(fixture.published).ok, false);
    assert.equal(validateJournalPublication(fixture.published, null).ok, false);
    if (fixture.rawRepair) {
      assert.equal(old.validateCharacterCandidate(fixture.rawRepair).ok, true);
      assert.equal(validateJournalCandidate(fixture.rawRepair).ok, false);
    }
  });
  test(`natural ${fixture.seq}: one bad journal gets only existing repair; two bad candidates become silence`, async () => {
    const input = fixture.rawRepair || fixture.published;
    let attempts = 0;
    const failed = await generateWithCharacterRepair({
      prompt: 'unchanged grounded journal prompt', validate: validateJournalCandidate,
      generate: async () => { attempts++; return { candidate: input }; },
    });
    assert.equal(attempts, 2);
    assert.equal(failed.characterDiscarded, true);
    assert.equal(failed.candidate, '');
    assert.equal(failed.characterValidation.finalAction, 'discarded-to-silence');
    attempts = 0;
    const repaired = await generateWithCharacterRepair({
      prompt: 'unchanged grounded journal prompt', validate: validateJournalCandidate,
      generate: async (_prompt, { repair }) => {
        attempts++;
        return { candidate: repair ? 'heard the bolt. still wonderin bout it rn' : input };
      },
    });
    assert.equal(attempts, 2);
    assert.equal(repaired.candidate, 'heard the bolt. still wonderin bout it rn');
    assert.equal(repaired.characterValidation.repairAttempted, true);
  });
}

for (const candidate of [
  '<banged up for the night',
  'heard it. <lunch was available',
  'heard it... <lunch was available',
  'heard it? <banged up for the night',
  'heard it!\t<banged up for the night',
  'heard it | <banged up for the night',
  'heard it\n<lunch was available',
  '  <lunch was available',
  'heard it | <banged up and later counted 42 < 43',
]) {
  test(`unclosed tag-shaped clause prefix fails at the demonstrated boundary: ${candidate}`, () => {
    assert.equal(validateJournalCandidate(candidate).ok, false);
    assert.equal(sanitize(candidate), candidate.replace(/[ \t]{2,}/g, ' '), 'only existing whitespace cleanup');
  });
}

for (const candidate of [
  '42 < 43',
  'counted forty two tiles. 42 < 43 so one is still missing.',
  'if x <y then y has to be bigger.',
  'a <b and b <c',
  'put <3 in the margin',
  '<3',
  'i drew < in the margin',
  'the mark < made me think of the door',
  'i wrote <banged up in the margin',
  'he wrote "<banged up" on the page',
  'it says `<lunch was` on the paper',
  "still banged up | dunno when they'll call us...",
  'head full of it rn. cant settle.',
]) {
  test(`ordinary or explicitly non-matching angle/pipe use stays valid: ${candidate}`, () => {
    assert.equal(validateJournalCandidate(candidate).ok, true);
    assert.equal(validateJournalCandidate(candidate).ok, old.validateCharacterCandidate(candidate).ok);
    // Preserve existing finalization too: legacy sanitation already treats a
    // bare terminal '<c' as a partial tag. This fix must not broaden that rule.
    assert.equal(validateJournalPublication(candidate, null).ok,
      old.validateJournalPublication(candidate, null).ok);
  });
}

for (const [candidate, expected] of [
  ['<span class="quiet">heard the latch</span>', ' heard the latch '],
  ['<span class\n="quiet">heard the latch</span>', ' heard the latch '],
  ['heard it <br>> then waited', 'heard it then waited'],
  ['heard it <b', 'heard it '],
  ['heard it <|im_end|>', 'heard it '],
]) {
  test(`existing markup/control sanitation is preserved: ${candidate}`, () => {
    assert.equal(validateJournalCandidate(candidate).ok, old.validateCharacterCandidate(candidate).ok);
    assert.equal(sanitize(candidate), expected);
  });
}

test('encoded clause prefix is decoded at the existing normalization edge then rejected', async () => {
  const input = 'heard it... &lt;lunch was available';
  assert.equal(normalizeWakingProse(input), 'heard it... <lunch was available');
  assert.equal(validateJournalCandidate(input).ok, false);
  let attempts = 0;
  const r = await generateWithCharacterRepair({ prompt: 'original', validate: validateJournalCandidate,
    generate: async () => { attempts++; return { candidate: input }; } });
  assert.equal(attempts, 2);
  assert.equal(r.characterDiscarded, true);
});

test('the new rule is journal-only and does not strip old history or change other consumers', () => {
  const text = fixtures.cases[0].published;
  assert.equal(validateCharacterCandidate(text).ok, old.validateCharacterCandidate(text).ok);
  assert.equal(sanitizeCharacterContext(text), text);
  for (const path of ['warden.js', 'prompt.js', 'provider.js', 'drawing-subject.js', 'draw.js']) {
    assert.equal(source(path), baseline(path), path);
  }
});

test('runtime changes only journal candidate hook; finalization pipeline/retry loop remains byte-identical', () => {
  const run = source('run.js')
    .replace('generateWithCharacterRepair, validateJournalCandidate, validateJournalPublication',
      'generateWithCharacterRepair, validateJournalPublication')
    .replace("      ...(mode === 'journal' ? { validate: validateJournalCandidate } : {}),\n", '');
  assert.equal(run, baseline('run.js'));
  const character = source('character-output.js');
  const unchangedTail = text => text.slice(text.indexOf('export function journalTerminationEvidence'));
  assert.equal(unchangedTail(character).replace('const validation = validateJournalCandidate(text);',
    'const validation = validateCharacterCandidate(text);'), unchangedTail(baseline('character-output.js')));
});

test('frozen natural fixture strings remain untouched', () => {
  const before = JSON.stringify(fixtures);
  for (const fixture of fixtures.cases) {
    validateJournalCandidate(fixture.published);
    if (fixture.rawRepair) validateJournalCandidate(fixture.rawRepair);
  }
  assert.equal(JSON.stringify(fixtures), before);
});
