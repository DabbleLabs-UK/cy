import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import * as dream from './dream.js';
import { looksLikeAssistantFrame } from './warden.js';
import { runDreamIfEligible } from './dream-regime.js';
import { sourceFromDreamExpression } from './autobiographical-memory.js';
import { buildDirectives, buildPrompt } from './prompt.js';

const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function extract(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `missing function boundary: ${start}`);
  return source.slice(first, last).trim();
}
const emitCode = extract('async function emitDreamFragments(', '  // Arm the night');
const stepCode = extract('async function dreamStep(', '  // ---- main generation loop ----');
const oldSource = execFileSync('git', ['show', '8c788901b01ace7bea70046682f00fadadcf4ff5:runner/dream.js'],
  { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
const old = runInNewContext(oldSource
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/\bexport (?=(?:const|function)\b)/g, '')
  + '\n({ parseDreamFragments, validateDreamOutput })', { looksLikeAssistantFrame });

// These are exact retained public fragment values, not the unavailable original
// provider response. Joined lines below deliberately reconstruct the raw-line
// fallback; wrapping the values in JSON exercises the second admission route.
const natural = [
  {
    seq: 2911856,
    fragments: [
      String.raw`{\"fragments\":[\"deep under\", \"root, the door\"]} | >assistant`,
      String.raw`{\"fragments\":[\"ping's tired eyes\", \"sweep clears\"]}`,
    ],
  },
  {
    seq: 2919034,
    fragments: ['{', String.raw`fragments\": [`, 'something... about Keyes',
      String.raw`damp in the corner of my cell\",`, String.raw`Nick still hasn't written me back\",`],
  },
];

for (const fixture of natural) {
  test(`retained natural leak ${fixture.seq}: old admission reproduced, both new routes fail closed`, () => {
    for (const raw of [fixture.fragments.join('\n'), JSON.stringify({ fragments: fixture.fragments })]) {
      assert.equal(old.validateDreamOutput(raw).valid, true, 'pinned production formerly passed this packaging');
      const result = dream.validateDreamOutput(raw);
      assert.equal(result.valid, false);
      assert.deepEqual(result.fragments, []);
      assert.deepEqual(dream.parseDreamFragments(raw), []);
    }
  });
}

const badValues = [
  '{', '}', '[', ']', '"fragments": [', String.raw`fragments\": [`,
  '{"fragments":["door"]}', '["door","key"]',
  '>assistant', '>assistant the door moves', 'assistant: the door moves',
  '--assistant: the door moves',
  'user: say the door', 'system: use JSON', '<|im_start|>assistant',
  '<|start_header_id|>assistant<|end_header_id|>', '<|eot_id|>',
  'a door <|im_end', 'a door | im end >', 'a door < im_end |>',
  '```json', '```', '~~~json', 'SyntaxError: Unexpected token',
  'JSON parse error: invalid input', 'Traceback (most recent call last):',
];
test('technical packaging values reject the entire response rather than salvaging other fragments', () => {
  for (const value of badValues) {
    const raw = JSON.stringify({ fragments: ['a door made of rain', value] });
    assert.equal(dream.validateDreamOutput(raw).valid, false, value);
    assert.deepEqual(dream.parseDreamFragments(raw), [], value);
  }
});

test('malformed, embedded, wrapped, empty and non-string contracts do not become content', () => {
  for (const raw of [
    '', 'a door made of rain', '{"fragments":["a door",',
    '```json\n{"fragments":["door"]}\n```',
    'Here is the result: {"fragments":["door"]}',
    '{"fragments":["door"]}\n>assistant',
    '[]', 'null', '{"fragments":[]}', '{"fragments":[""]}',
    '{"fragments":[null]}', '{"fragments":[1]}',
    '{"fragments":[{"text":"door"}]}', '{"fragments":"door"}',
    '{"fragments":["door"],"debug":"complete"}',
  ]) {
    assert.equal(dream.validateDreamOutput(raw).valid, false, raw);
    assert.deepEqual(dream.parseDreamFragments(raw), [], raw);
  }
});

test('scaffolding cannot hide after the normal word, character or fragment caps', () => {
  const values = [
    'one two three four five six seven eight nine ten eleven twelve >assistant',
    'a'.repeat(200) + ' ```json',
  ];
  for (const value of values) {
    assert.equal(dream.validateDreamOutput(JSON.stringify({ fragments: [value] })).valid, false);
  }
  assert.equal(dream.validateDreamOutput(JSON.stringify({
    fragments: ['door', 'wall', 'rain', 'key', 'face', '>assistant'],
  })).valid, false);
});

const legitimate = ['an assistant with feathers instead of fingers',
  'assistant', 'system', 'user', 'developer', 'tool', 'im end',
  'the system feels wrong and the user has no face',
  'the word fragments floats above the landing', 'door [not a door] - why?',
  'a {small} room, bigger inside', 'the key > the gate; neither fits',
  '1, 2, 3... the stairs count backwards'];
test('ordinary dream language, ambiguous punctuation and English role words remain allowed', () => {
  for (const value of legitimate) {
    const checked = dream.validateDreamOutput(JSON.stringify({ fragments: [value] }));
    assert.equal(checked.valid, true, value);
    assert.equal(checked.fragments.length, 1);
  }
});

test('legitimate multiple fragments and existing compact caps are unchanged', () => {
  const values = ['door will not fit the frame', 'Proctor with no face',
    'someone laughing underwater while the keys keep turning beyond the wall forever tonight',
    'x'.repeat(120), 'the landing folds inward', 'the sixth stays omitted'];
  const raw = JSON.stringify({ fragments: values });
  assert.equal(dream.validateDreamOutput(raw).valid, true);
  assert.deepEqual(dream.parseDreamFragments(raw), Array.from(old.parseDreamFragments(raw)));
  assert.equal(dream.parseDreamFragments(raw).length, dream.DREAM_MAX_FRAGMENTS);
  assert.ok(dream.parseDreamFragments(raw).every((value) => value.length <= dream.DREAM_MAX_CHARS_PER_FRAGMENT
    && value.split(/\s+/).length <= dream.DREAM_MAX_WORDS_PER_FRAGMENT));
});

function fixture({ raw = '{"fragments":["a door made of rain","the key swims away"]}', lucid = false,
  cancelAfterGenerate = false, cancelDuringScreen = false, eligible = true } = {}) {
  const calls = { generated: [], events: [], memories: [], blocks: [] };
  const now = Date.parse('2026-10-25T03:00:00.000Z');
  class Clock extends Date { static now() { return now; } }
  const env = { ...dream, Date: Clock, running: eligible,
    client: { paused: false }, vitals: {}, config: { threads: 4 },
    dreamState: { nextMurmurAt: 0, sleepPeriodId: 'sleep-fixture', draw: null },
    wingNoiseCue: lucid ? { wake: true, until: now + 1000, line: 'a gate sounds' } : null,
    londonParts: () => ({ date: '2026-10-25', hour: 3, minute: 0, mins: 180 }),
    sleepPeriodId: () => 'sleep-fixture', recentWorldHistory: [],
    dreamStillAllowed: () => env.running && !env.client.paused,
    buildDirectives, buildPrompt,
    options: (_v, _threads, _mode, opts) => opts,
    logPrompt: async () => {}, ZONE_A: 'dream system', FOREGROUND_INFERENCE_TIMEOUT_MS: 420000,
    rawGenerate: async (request) => {
      calls.generated.push(request);
      if (cancelAfterGenerate) env.running = false;
      return { text: raw, model: 'offline-stub' };
    },
    runDreamIfEligible, maybeArmDream: () => {}, advanceDreamDraw: () => false,
    dreamMaterial: () => ({ items: [] }), buildDreamPool: () => [],
    dreamMemoryTraces: async () => ({ selected: [] }), dreamMurmurGapMs: () => 300000,
    idleSilently: async () => {}, randomUUID: () => 'dream-fixture-id',
    activeProviderId: 'LOCAL', activeProvider: () => ({ model: 'offline-stub' }),
    sanitize: (value) => value, stripScaffold: (value) => value,
    warden: { screenOut: () => {
      if (cancelDuringScreen) env.running = false;
      return { ok: true };
    }, logBlock: async (...args) => calls.blocks.push(args) },
    emit: (event) => calls.events.push(event), tsNow: () => new Date(now).toISOString(),
    sourceFromDreamExpression,
    autobiographicalMemory: { queueSource: (value) => calls.memories.push(value) },
    lastTextMs: 0, watchdogStep: 0, failedCyclesSinceEmit: 1, nonEmittingStreak: 1,
  };
  env.emitDreamFragments = runInNewContext(`(${emitCode})`, env);
  const step = runInNewContext(`(${stepCode})`, env);
  return { calls, env, step };
}

for (const lucid of [false, true]) {
  test(`actual ${lucid ? 'waking' : 'murmur'} dream path cannot publish or enqueue malformed/scaffold output`, async () => {
    for (const raw of [natural[0].fragments.join('\n'), natural[1].fragments.join('\n'),
      JSON.stringify({ fragments: ['>assistant'] }), '```json\n{"fragments":["door"]}\n```', '']) {
      const f = fixture({ raw, lucid });
      await f.step(180);
      assert.equal(f.calls.generated.length, 1);
      assert.equal(f.calls.generated[0].attempt, lucid ? 'dream-waking' : 'dream-murmur');
      assert.ok(!f.calls.generated[0].prompt.includes('[deep under.'));
      assert.ok(!f.calls.generated[0].prompt.includes('[you come up hard'));
      assert.equal(f.calls.events.some((event) => event.kind === 'dream' || event.kind === 'text'), false);
      assert.equal(f.calls.memories.length, 0);
    }
  });
  test(`actual ${lucid ? 'waking' : 'murmur'} publication retains valid fragment/memory provenance`, async () => {
    const f = fixture({ lucid });
    await f.step(180);
    const events = f.calls.events.filter((event) => event.kind === 'dream');
    assert.equal(events.length, 1);
    assert.deepEqual(Array.from(events[0].payload.fragments),
      lucid ? ['a door made of rain'] : ['a door made of rain', 'the key swims away']);
    assert.equal(events[0].payload.output_validation, 'PASSED');
    assert.equal(events[0].payload.lucid, lucid);
    assert.equal(f.calls.memories.length, 1);
    assert.equal(f.calls.memories[0].sourceType, 'DREAM_EXPRESSION');
    assert.equal(f.calls.memories[0].sourceVisibility, 'INTERNAL_ONLY');
  });
  test(`actual ${lucid ? 'waking' : 'murmur'} eligibility fencing still discards cancelled results`, async () => {
    for (const options of [{ eligible: false }, { cancelAfterGenerate: true }, { cancelDuringScreen: true }]) {
      const f = fixture({ lucid, ...options });
      await f.step(180);
      assert.equal(f.calls.generated.length, options.eligible === false ? 0 : 1);
      assert.equal(f.calls.events.some((event) => event.kind === 'dream'), false);
      assert.equal(f.calls.memories.length, 0);
    }
  });
}

test('actual emitter independently refuses technical fragments instead of relying on caller validation', async () => {
  for (const fragments of [natural[0].fragments, natural[1].fragments, ['>assistant'], ['door', '```json'],
    ['a door <|im_end'], ['a door | im end >']]) {
    const f = fixture();
    assert.equal(await f.env.emitDreamFragments(fragments), false);
    assert.equal(f.calls.events.length, 0);
    assert.equal(f.calls.memories.length, 0);
  }
});
