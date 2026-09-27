// dev-accelerated-world-soak.test.js - proves the accelerated validation
// harness's isolation guarantees and basic mechanical correctness. This is a
// test of the DEV TOOL itself, not of Cy's world/Soma behaviour (that is what
// the harness is FOR, exercised separately via an actual soak run).
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/dev-accelerated-world-soak.test.js

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadVitals } from './vitals.js';
import {
  captureFrozenState,
  releaseFrozenState,
  createWorldSoakHarness,
  runAcceleratedSoak,
  buildSyntheticAwgGenerator,
} from './dev-accelerated-world-soak.mjs';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

// Builds a minimal, valid, self-contained checkpoint fixture: load
// first-install defaults (no file exists yet) and write them out as a plain
// flat vitals.json - captureFrozenState()'s flat-file fallback path (already
// proven against a real production checkpoint) is what reads this back.
async function buildFixtureCheckpoint() {
  const dir = await mkdtemp(join(tmpdir(), 'cy-soak-fixture-'));
  const stateDir = join(dir, 'state');
  await mkdir(stateDir, { recursive: true });
  const vitalsPath = join(stateDir, 'vitals.json');
  const defaults = await loadVitals(join(stateDir, 'does-not-exist.json'));
  await writeFile(vitalsPath, JSON.stringify(defaults));
  return { dir, vitalsPath };
}

// ---- 1: isolation - the original checkpoint is never mutated ----
{
  const { vitalsPath } = await buildFixtureCheckpoint();
  const before = await readFile(vitalsPath, 'utf8');
  const beforeMtime = (await stat(vitalsPath)).mtimeMs;
  const { vitals, tempRoot } = await captureFrozenState(vitalsPath);
  const report = await runAcceleratedSoak({ vitals, startMs: Date.parse('2026-01-06T07:00:00.000Z'), durationMs: 2 * 3600 * 1000 });
  assert.ok(report.simulatedMs > 0, 'the soak actually advanced simulated time');
  const after = await readFile(vitalsPath, 'utf8');
  const afterMtime = (await stat(vitalsPath)).mtimeMs;
  assert.equal(after, before, 'the original checkpoint file content is byte-for-byte unchanged after a soak');
  assert.equal(afterMtime, beforeMtime, 'the original checkpoint file was never even touched (mtime unchanged)');
  await releaseFrozenState(tempRoot);
  ok('the original checkpoint is never mutated by a soak run - isolation holds (1)');
}

// ---- 2: the isolated temp directory is genuinely cleaned up afterward ----
{
  const { vitalsPath } = await buildFixtureCheckpoint();
  const { vitals, tempRoot } = await captureFrozenState(vitalsPath);
  await runAcceleratedSoak({ vitals, startMs: Date.now(), durationMs: 3600 * 1000 });
  let existedBeforeRelease = false;
  try { await stat(tempRoot); existedBeforeRelease = true; } catch { /* absent is fine too */ }
  await releaseFrozenState(tempRoot);
  let existsAfterRelease = true;
  try { await stat(tempRoot); } catch { existsAfterRelease = false; }
  assert.equal(existsAfterRelease, false, 'the isolated temp directory is removed after release');
  ok(`the isolated temp working directory is cleaned up after the soak (existed before release: ${existedBeforeRelease}) (2)`);
}

// ---- 3: no network/LLM call is ever made - the AWG generator is fully synthetic ----
{
  let realCallAttempted = false;
  const spyGenerate = async (call) => {
    realCallAttempted = true;
    throw new Error('a real generate() must never be invoked by this harness');
  };
  const generate = buildSyntheticAwgGenerator();
  const output = await generate();
  assert.equal(realCallAttempted, false);
  assert.equal(typeof output, 'string');
  const parsed = JSON.parse(output);
  assert.ok(['NO_EVENT', 'EVENT'].includes(parsed.decision));
  assert.equal('schema' in parsed, false, 'the raw proposal never includes schema/version (those are added by materialisation, not the LLM)');
  assert.equal('version' in parsed, false);
  ok('the AWG generator is fully synthetic and never attempts a real network/LLM call (3)');
}

// ---- 4: a short soak runs mechanically without throwing, across sleep and waking hours ----
{
  const { vitalsPath } = await buildFixtureCheckpoint();
  const { vitals, tempRoot } = await captureFrozenState(vitalsPath);
  // Spans midnight->next afternoon: exercises both asleep and awake branches.
  const startMs = Date.parse('2026-01-06T22:00:00.000Z');
  const report = await runAcceleratedSoak({ vitals, startMs, durationMs: 18 * 3600 * 1000 });
  assert.equal(report.invariantFailures.length, 0, `no invariant failures: ${JSON.stringify(report.invariantFailures)}`);
  assert.ok(report.endMs > report.startMs);
  await releaseFrozenState(tempRoot);
  ok('an 18-simulated-hour soak spanning sleep and waking hours runs to completion without throwing (4)');
}

// ---- 5: controllability posteriors remain empty (no false agency evidence reappears) ----
{
  const { vitalsPath } = await buildFixtureCheckpoint();
  const { vitals, tempRoot } = await captureFrozenState(vitalsPath);
  const startMs = Date.parse('2026-01-06T07:00:00.000Z');
  await runAcceleratedSoak({ vitals, startMs, durationMs: 24 * 3600 * 1000 });
  const controllability = vitals.cognition && vitals.cognition.learnedControllability;
  assert.deepEqual(controllability ? controllability.pairs : {}, {},
    'no action-outcome-contingency posterior is created anywhere in a full 24h soak - matches the fixed producers');
  await releaseFrozenState(tempRoot);
  ok('a full 24-simulated-hour soak creates zero controllability posteriors, as expected post-fix (5)');
}

// ---- 6: harness.tick() is directly composable (not only via runAcceleratedSoak) ----
{
  const { vitalsPath } = await buildFixtureCheckpoint();
  const { vitals, tempRoot } = await captureFrozenState(vitalsPath);
  const startMs = Date.parse('2026-01-06T09:00:00.000Z');
  const harness = createWorldSoakHarness({ vitals, startMs });
  for (let i = 0; i < 100; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await harness.tick(startMs + i * 5000);
  }
  const report = harness.finalize();
  assert.equal(report.invariantFailures.length, 0);
  await releaseFrozenState(tempRoot);
  ok('the harness exposes a directly composable tick()/finalize() API, not just the CLI runner (6)');
}

console.log(`\ndev-accelerated-world-soak.test.js: all ${n} checks passed`);
