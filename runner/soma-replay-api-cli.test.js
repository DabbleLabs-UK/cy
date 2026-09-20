// soma-replay-api-cli.test.js - proves the ACTUAL subprocess bridge
// public/replay/api.php shells out to on the hosted vps3 deployment works
// end-to-end: spawns the real CLI file (not a re-implementation) and checks
// its stdout/exit-code contract against the same pure builders directly, so
// hosted and local-dev output can never silently diverge.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { GOLDEN_SOMA_REPLAY_FIXTURES } from './soma-replay-fixtures.js';
import { buildFixturesResponse, buildReplayResponse } from './soma-replay-api.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('./soma-replay-api-cli.mjs', import.meta.url));

// 'fixtures' action: stdout matches the pure builder exactly, clean exit.
const fixturesResult = await run(process.execPath, [CLI, 'fixtures']);
assert.equal(fixturesResult.stderr, '', 'fixtures action writes nothing to stderr on success');
assert.deepEqual(JSON.parse(fixturesResult.stdout), buildFixturesResponse(),
  'the CLI subprocess produces byte-for-byte the same body as the shared pure builder');

// 'replay' action for every golden fixture, EVENT WINDOW and FULL DAY, both
// matching the shared builder used by the local dev server.
for (const fixture of GOLDEN_SOMA_REPLAY_FIXTURES) {
  const eventWindow = await run(process.execPath, [CLI, 'replay', fixture.id, '15']);
  assert.deepEqual(JSON.parse(eventWindow.stdout),
    buildReplayResponse({ fixtureId: fixture.id, sampleMinutes: '15', fullDay: false }),
    `${fixture.id}: EVENT WINDOW subprocess output matches the pure builder`);

  const fullDay = await run(process.execPath, [CLI, 'replay', fixture.id, '15', 'full-day']);
  assert.deepEqual(JSON.parse(fullDay.stdout),
    buildReplayResponse({ fixtureId: fixture.id, sampleMinutes: '15', fullDay: true }),
    `${fixture.id}: FULL DAY subprocess output matches the pure builder`);
}

// Determinism across two independent subprocess invocations (this is what a
// real repeated admin request would exercise, not just the in-process call).
const first = await run(process.execPath, [CLI, 'replay', 'quiet-routine-baseline', '15']);
const second = await run(process.execPath, [CLI, 'replay', 'quiet-routine-baseline', '15']);
assert.equal(first.stdout, second.stdout, 'repeated subprocess invocations are byte-identical');

// Error contract: non-zero exit, {"error": "..."} on STDERR (never stdout),
// so PHP's proc_open bridge can distinguish success from failure by exit code
// alone and surface a real message either way.
try {
  await run(process.execPath, [CLI, 'replay', 'does-not-exist', '15']);
  assert.fail('an unknown fixture must exit non-zero');
} catch (error) {
  assert.ok(error.code !== 0, 'unknown fixture exits non-zero');
  assert.equal(error.stdout, '', 'a failed call writes nothing to stdout');
  const parsed = JSON.parse(error.stderr);
  assert.match(parsed.error, /unknown fixture/, 'the error message names the actual problem');
}

try {
  await run(process.execPath, [CLI, 'not-a-real-action']);
  assert.fail('an unknown action must exit non-zero');
} catch (error) {
  assert.ok(error.code !== 0);
  const parsed = JSON.parse(error.stderr);
  assert.match(parsed.error, /unknown action/);
}

console.log('soma-replay-api-cli.test.js: all checks passed');
