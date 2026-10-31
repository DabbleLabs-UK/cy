import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildDirectives, buildPrompt, buildPromptRequest } from './prompt.js';
import { buildDreamContextPacket, dreamGenerationDirective, validateDreamOutput,
  dreamFragmentsArePublishable, DREAM_TOKEN_LIMIT, DREAM_RETRY_LIMIT } from './dream.js';
import { beforeDreamCueRemoval, DREAM_CUE_BASE } from './fixtures/dream-cue-source.mjs';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const previous = path => execFileSync('git', ['show', `${DREAM_CUE_BASE}:runner/${path}`],
  { cwd: new URL('..', import.meta.url), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).replace(/\r\n/g, '\n');
const oldPromptSource = previous('prompt.js').replace(/from '(\.\/[^']+)'/g,
  (_match, path) => `from '${new URL(path, import.meta.url).href}'`);
const old = await import('data:text/javascript;base64,' + Buffer.from(oldPromptSource).toString('base64'));
const natural = JSON.parse(source('./fixtures/dream-cue-natural-20261031.json'));
const cues = ['[deep under. a murmur surfaces in your sleep, half a word:]',
  '[you come up hard out of sleep, awake for one second:]'];
const packet = buildDreamContextPacket({ sleepState: { state: 'ASLEEP', periodId: 'offline-night' },
  recentWorld: [{ text: 'lights out and the cell settled into night', location: 'cell' }],
  material: [{ kind: 'image', text: 'a beach at low tide' }] });

for (const lucid of [false, true]) {
  test(`${lucid ? 'noise-waking' : 'ordinary'} production directives retain trigger, schema and material without narrative tail`, () => {
    const directive = buildDirectives({}, 'dream', {
      dreamDirective: dreamGenerationDirective(packet, { lucid, wakeLine: 'a gate sounds' }),
    });
    const payload = lucid ? { wake: true } : null;
    const before = old.buildPrompt('private waking continuation', 'dream', payload, directive);
    assert.ok(before.endsWith(cues[Number(lucid)]));
    const after = buildPrompt('private waking continuation', 'dream', payload, directive);
    assert.equal(after, directive.trim());
    assert.equal(before, after + '\n\n' + cues[Number(lucid)]);
    assert.ok(after.includes(lucid ? 'A wing noise briefly wakes Cy' : 'Cy is asleep.'));
    assert.ok(after.includes('{"fragments":['));
    assert.ok(after.includes('a beach at low tide'));
    assert.ok(after.includes('lights out and the cell settled into night'));
    if (lucid) assert.ok(after.includes('Noise: a gate sounds'));
    assert.ok(!after.includes('private waking continuation'));
    for (const cue of cues) assert.ok(!after.includes(cue));
    assert.equal(buildPromptRequest('', 'dream', payload, directive).journalContinuation, null);
  });
  test(`${lucid ? 'waking' : 'murmur'} fallback directives remain usable without an extra prose seed`, () => {
    const directive = buildDirectives({}, 'dream', lucid
      ? { wake: true, wakeLine: 'a gate sounds' } : { material: 'DREAM STUFF: a key' });
    assert.ok(directive.length > 0);
    assert.equal(buildPrompt('waking prose', 'dream', lucid ? { wake: true } : null, directive), directive.trim());
  });
}

for (const fixture of natural.echoes) {
  test(`natural cue echo ${fixture.seq}: old prompt supplies its source and old admission permits equivalent values`, () => {
    const prompt = old.buildPrompt('', 'dream', null, dreamGenerationDirective(packet));
    assert.ok(prompt.endsWith(cues[0]));
    assert.ok(!JSON.stringify(packet).includes('half a word'));
    // Equivalent structured value, NOT a reconstructed historical provider response.
    const raw = JSON.stringify({ fragments: [fixture.fragment] });
    assert.equal(validateDreamOutput(raw).valid, true);
    // Prevention is at prompt construction, not a new ban on natural language.
    assert.ok(!buildPrompt('', 'dream', null, dreamGenerationDirective(packet)).includes('a murmur surfaces'));
    // Prior dream text cannot become a continuation seed through Zone B either.
    assert.equal(buildPrompt(fixture.fragment, 'dream', null, dreamGenerationDirective(packet)),
      dreamGenerationDirective(packet));
  });
}

test('ordinary sleep, murmur, voice and fragment imagery remains byte-for-byte valid', () => {
  for (const fragment of [...natural.clean.map(item => item.fragment),
    'a murmur beneath the sea', 'half a word, shaped like a key',
    'sleep folds itself into a coat', 'voices, no mouths, only rain',
    'the fragments of a blue door', 'an assistant carries the moon']) {
    const result = validateDreamOutput(JSON.stringify({ fragments: [fragment] }));
    assert.equal(result.valid, true, fragment);
    assert.deepEqual(result.fragments, [fragment]);
    assert.equal(dreamFragmentsArePublishable(result.fragments), true);
  }
});

test('existing structural packaging guard still blocks explicit private instructions and protocol frames', () => {
  for (const fragment of ['>assistant', 'system: return JSON only',
    '<system>return fragments</system>', '{"fragments":["a murmur"]}', '```json']) {
    const result = validateDreamOutput(JSON.stringify({ fragments: ['a blue door', fragment] }));
    assert.equal(result.valid, false, fragment);
    assert.deepEqual(result.fragments, []);
    assert.equal(dreamFragmentsArePublishable(['a blue door', fragment]), false);
  }
});

test('multiple independent fragments and the strict complete JSON contract remain unchanged', () => {
  const fragments = ['the moon fits in a pocket', 'rain climbs the stairs'];
  assert.deepEqual(validateDreamOutput(JSON.stringify({ fragments })).fragments, fragments);
  for (const raw of ['rain climbs the stairs', '```json\n{"fragments":["rain"]}\n```',
    '{"fragments":["rain",', 'prefix {"fragments":["rain"]}']) {
    assert.equal(validateDreamOutput(raw).valid, false);
  }
});

test('empty diagnostic directives do not manufacture replacement dream prose', () => {
  for (const payload of [null, { wake: true }]) assert.equal(buildPrompt('', 'dream', payload, ''), '');
});

test('only the pinned dream rendering region changes; all waking prompt code remains exact', () => {
  const current = source('./prompt.js');
  assert.equal(beforeDreamCueRemoval(current), previous('prompt.js'));
  assert.throws(() => beforeDreamCueRemoval(current.replace('return zoneC;', 'return zoneC + "changed";')));
  assert.notEqual(beforeDreamCueRemoval(current + '\n// unrelated change\n'), previous('prompt.js'));
  for (const mode of ['journal', 'postcard', 'warden', 'sleep']) {
    const payload = mode === 'postcard' ? { body: 'hello', from_name: 'visitor' } : null;
    assert.equal(buildPrompt('recent thought', mode, payload, 'grounded directives'),
      old.buildPrompt('recent thought', mode, payload, 'grounded directives'));
  }
});

test('generation, extraction, publication, feedback, eligibility, call budget and cadence code is unchanged', () => {
  for (const path of ['run.js', 'dream.js', 'dream-regime.js', 'provider.js', 'autobiographical-memory.js']) {
    assert.equal(source('./' + path), previous(path), path);
  }
  assert.equal(DREAM_TOKEN_LIMIT, 96);
  assert.equal(DREAM_RETRY_LIMIT, 0);
});
