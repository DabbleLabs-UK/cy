import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CASES, packet } from './fixtures.mjs';
import { failureChecks, CONFIG } from './rehearse.mjs';

test('fixed twenty cases cover real meal names and supported bodily projection without invented hunger', () => {
  assert.equal(CASES.length, 20);
  assert.equal(new Set(CASES.map((c) => c.id)).size, 20);
  for (const c of CASES) {
    const p = packet(c), prompt = JSON.parse(p.call.prompt);
    assert.deepEqual(Object.keys(prompt.choices), ['eat', 'decline']);
    assert.deepEqual(p.call.format.properties.action.enum, ['eat', 'decline']);
    assert.equal(p.opts.num_predict, 80);
    assert.equal(p.opts.num_ctx, 3072);
    assert.equal(p.opts.num_thread, 4);
    assert.doesNotMatch(p.call.prompt, /synthetic|fixture|backend|calibrat|KSS|energy_kcal|distention|meal_id|hungr|diet|dislike/i);
    assert.match(prompt.present, /No specific ingredients are established/);
    if (c.profile !== 'SPARSE') assert.equal(p.seed.snapshot.band, c.profile);
    else if (!c.injury) assert.match(prompt.body, /No current grounded facts/);
    if (c.injury) assert.match(prompt.body, /Active abrasion at left forearm/);
  }
});

test('matched repeat inputs are byte-identical rather than rewritten to encourage a ratio', () => {
  for (const [a, b] of [[0, 18], [5, 19]]) {
    assert.deepEqual(packet(CASES[a]).call, packet(CASES[b]).call);
    assert.deepEqual(packet(CASES[a]).opts, packet(CASES[b]).opts);
  }
});

test('fixture bodily projection matches current runtime allowlist and presentation code', async () => {
  const runtime = await readFile(new URL('../../../runner/run.js', import.meta.url), 'utf8');
  const fixture = await readFile(new URL('./fixtures.mjs', import.meta.url), 'utf8');
  const normalize = (s) => s.replace(/\s+/g, '');
  const extract = (s) => normalize(s.slice(s.indexOf('const cognition = prepareSomaGeneration',
    s.indexOf('async function serviceMealChoice()') < 0 ? 0 : s.indexOf('async function serviceMealChoice()')),
    s.indexOf("['predicted_kss', 'physiological_satiety', 'active_injury', 'active_noxious_stimulus']",
      s.indexOf('async function serviceMealChoice()') < 0 ? 0 : s.indexOf('async function serviceMealChoice()')) + 94));
  // Separately check exact model-visible body across all fixtures; the only
  // clock difference is fixed synthetic BASE instead of the live Date.now().
  assert.ok(extract(runtime).includes("['sleep','somatic','feeding']"));
  assert.ok(extract(fixture).includes("['sleep','somatic','feeding']"));
  for (const source of [runtime, fixture]) assert.ok(source.includes(
    "['predicted_kss', 'physiological_satiety', 'active_injury', 'active_noxious_stimulus'].includes(entry.fact)"));
});

test('all failure probes are offline and remain unknown, not refusal or missed meal', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail('offline failure check tried networking');
  try {
    const failures = await failureChecks();
    assert.equal(failures.length, 7);
    for (const result of failures) {
      assert.equal(result.phase, 'NO_DECISION');
      assert.equal(result.intake.intakeOutcome, 'UNKNOWN');
      assert.equal(result.intake.consumedFraction, null);
      assert.equal(result.intake.availabilityStatus, 'AVAILABLE');
    }
  } finally { globalThis.fetch = original; }
});

test('execution uses real provider/coordinator/arbiter path and cannot invoke the live runner or Client', async () => {
  const source = await readFile(new URL('./rehearse.mjs', import.meta.url), 'utf8');
  assert.equal(CONFIG.ollamaUrl, 'http://127.0.0.1:11434');
  assert.equal(CONFIG.ollamaArbiterUrl, 'http://127.0.0.1:11435');
  assert.match(source, /provider\.rawGenerate\(/);
  assert.match(source, /provider\.acquireSharedLease\(/);
  assert.match(source, /provider\.applySharedProfile\(/);
  assert.match(source, /withAbortTimeout\(controller, 600000/);
  assert.doesNotMatch(source, /new Client\(|loadVitals\(|saveVitals\(|execFile|child_process|\/api\/ingest|\.openStream\(/);
  assert.match(source, /sends < 20/);
  assert.match(source, /await mkdir\(out\)/);
});
