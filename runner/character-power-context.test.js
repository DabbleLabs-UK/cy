import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PowerMeter, costInjection } from './power.js';
import { buildDirectives, buildPrompt, buildSystem, CHARACTER_KNOWLEDGE_TEXT, ZONE_A } from './prompt.js';
import { canonicalPostcardContext } from './postcard-context.js';
import { createSomaRuntime } from './soma-runtime.js';
import { prepareSomaGeneration } from './soma-cycle.js';

const now = Date.parse('2026-10-22T12:00:00Z');
const snapshot = { watts: 40, cost_per_hour: 0.01, cost_total: 12.34, kwh_total: 49.36, uptime_s: 900000 };
const leak = /THE METER|switched on|Florian pays|GBP of electric|p an hour|current burned for you/;

test('all accounting snapshots yield no character-facing cost prose or invented observation', () => {
  for (const value of [snapshot, { ...snapshot, cost_total: 1000000, uptime_s: 0 }, {}, null, undefined]) {
    assert.equal(costInjection(value), '');
  }
  assert.equal(costInjection(new Proxy({}, { get() { throw new Error('backend data must not become character material'); } })), '');
});

test('journal, postcard, drawing and warden directive consumers receive no operator explanation', () => {
  for (const mode of ['journal', 'letter', 'drawing']) {
    for (const wakingJournalContext of [false, true]) {
      const directives = buildDirectives({}, mode, { wakingJournalContext, cost: costInjection(snapshot) });
      assert.doesNotMatch(buildSystem({}, mode, { wakingJournalContext, cost: costInjection(snapshot) }), leak);
      assert.doesNotMatch(buildPrompt('', mode, null, directives), leak);
    }
  }
  const directives = buildDirectives({}, 'journal', { cost: costInjection(snapshot) });
  assert.doesNotMatch(buildPrompt('', 'warden', { text: 'The routine continues.' }, directives), leak);
  const reply = canonicalPostcardContext({ postcard: { body: 'hello', from_name: 'Alex' }, directives,
    priorWriting: '', now: new Date(now).toISOString(), location: 'CELL' });
  assert.doesNotMatch(reply.system + reply.prompt, leak);
});

test('omitted cost slot is byte-identical to no slot, not a new instruction or inference choice', () => {
  for (const mode of ['journal', 'letter', 'drawing', 'dream', 'sleep']) {
    for (const wakingJournalContext of [false, true]) {
      const base = { wakingJournalContext, incidents: 'still waiting for post' };
      assert.equal(buildDirectives({}, mode, { ...base, cost: costInjection(snapshot) }), buildDirectives({}, mode, base));
    }
  }
});

test('power integration, tariff, snapshot fields and persisted totals remain intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cy-power-boundary-'));
  try {
    const path = join(dir, 'power.json');
    // Equal idle/load anchors make the exact integration independent of host CPU work.
    const config = { power: { idleWatts: 40, loadWatts: 40, tariff: 0.25 } };
    const meter = new PowerMeter(config, path);
    meter.startTs = meter.lastTs = now;
    assert.equal(meter.integrate(now + 3600000), 0.04);
    assert.equal(meter.kwhTotal, 0.04);
    assert.equal(meter.costTotal, 0.01);
    const expected = { watts: 40, kwh_total: 0.04, cost_total: 0.01, cost_per_hour: 0.01, uptime_s: 3600 };
    assert.deepEqual(meter.snapshot(now + 3600000), expected);
    await meter.save();
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(saved, { kwh_total: 0.04, cost_total: 0.01, start_ts: now, last_ts: now + 3600000 });
    const restored = new PowerMeter(config, path);
    await restored.load();
    assert.equal(restored.costTotal, 0.01);
    assert.equal(restored.kwhTotal, 0.04);
    assert.equal(restored.startTs, now);
    assert.deepEqual(restored.snapshot(now + 3600000), expected);
    assert.equal(costInjection(restored.snapshot()), '');
    assert.equal(restored.costTotal, 0.01, 'context hook cannot mutate accounting');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('whole-pound crossing bookkeeping remains private diagnostic state, not prompt evidence', () => {
  const runtime = createSomaRuntime(null, { now });
  runtime.observe({ name: 'power_cost_crossing',
    text: 'the machine has now consumed 13 GBP of electricity while continuity was maintained',
    tags: ['power', 'machine', 'continuity'], ts: new Date(now).toISOString() }, { now });
  assert.ok(runtime.state.selfModel.evidence.length > 0, 'existing diagnostic consequence is retained');
  assert.equal(runtime.provisionalMemoryCandidate(), null, 'an unlinked diagnostic is not a canonical observed event');
  const prepared = prepareSomaGeneration(runtime, { now });
  assert.doesNotMatch(prepared.groundedDirective, /13 GBP|electricity|power_cost_crossing/);
  assert.deepEqual(Object.keys(prepared).sort(), ['groundedContext', 'groundedDirective']);
});

test('measurement/UI publication, timers, crossing consequences and consumers retain their wiring', async () => {
  const run = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  assert.match(run, /const COST_EVERY = config\.costInjectEvery \|\| 40/);
  assert.match(run, /const doCost = forceCost \|\| genCount % COST_EVERY === 0/);
  assert.match(run, /ctx\.cost = costInjection\(powerMeter\.snapshot\(\)\)/);
  assert.match(run, /powerMeter\.integrate\(now\)/);
  assert.match(run, /kind: 'power',[\s\S]*?\.\.\.snap/);
  assert.match(run, /const POWER_SAMPLE_MS = 1000/);
  assert.match(run, /const POWER_EMIT_MS = 3000/);
  assert.match(run, /pwMsAccum >= 30000/);
  assert.match(run, /powerMeter\.save\(\)/);
  const crossing = run.slice(run.indexOf('const pound = Math.floor(snap.cost_total)'), run.indexOf('// persist roughly every ~30s'));
  assert.match(crossing, /soma\.observe\(/);
  assert.doesNotMatch(crossing, /captureEnvironmentEvent|pushDreamMemory|queueSource/);
  for (const tool of ['selftest.js', 'livesample.js', 'promptcachetest.js']) {
    assert.match(await readFile(new URL(`./${tool}`, import.meta.url), 'utf8'), /costInjection\(/);
  }
});

test('the deployed character knowledge boundary and ordinary observed world input remain usable', () => {
  assert.ok(ZONE_A.startsWith(CHARACTER_KNOWLEDGE_TEXT));
  assert.match(CHARACTER_KNOWLEDGE_TEXT, /inmate 7734, held in HMP ThinkPad/);
  assert.match(CHARACTER_KNOWLEDGE_TEXT, /Unknown unless independently established/);
  assert.match(CHARACTER_KNOWLEDGE_TEXT, /Operational figures and cast descriptions do not settle/);
  const ctx = { cost: costInjection(snapshot), sharedContext: 'OBSERVED BY CY: the lights went out.' };
  assert.match(buildDirectives({}, 'letter', ctx), /the lights went out/);
  assert.doesNotMatch(buildDirectives({}, 'letter', ctx), leak);
});
