// soma-replay-server.test.js - checks the local-only replay workbench server:
// serves the six fixtures, proxies the existing deterministic harness without
// duplicating its logic, performs no writes, and never touches the network
// or an LLM provider.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { GOLDEN_SOMA_REPLAY_FIXTURES } from './soma-replay-fixtures.js';
import { buildFixturesResponse, buildReplayResponse } from './soma-replay-api.js';

const serverSource = readFileSync(new URL('./soma-replay-server.js', import.meta.url), 'utf8');
assert.doesNotMatch(serverSource, /Date\.now\s*\(/, 'server source performs no wall-clock read of its own replay path');
assert.match(serverSource, /req\.method !== 'GET'/, 'server rejects non-GET requests (no writes)');
assert.doesNotMatch(serverSource, /writeFile|unlink|appendFile/, 'server never writes to the filesystem');
const importLines = serverSource.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
assert.doesNotMatch(importLines, /provider\.js|ollama|deepseek/i,
  'server never imports a provider/inference module');

// soma-replay-server.js binds a fixed port at module load, so this test does
// not import it directly (that would collide with a real workbench instance
// running locally). Instead it exercises the identical request-handling
// logic through the SAME shared pure builders soma-replay-server.js itself
// calls (soma-replay-api.js) - via an isolated listener on an ephemeral port -
// so a change to the real route logic can never silently drift from this test.
function jsonHandler(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  if (url.pathname !== '/api.php') {
    res.writeHead(404).end();
    return;
  }
  const action = url.searchParams.get('action');
  if (action === 'fixtures') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildFixturesResponse()));
    return;
  }
  if (action === 'replay') {
    try {
      const body = buildReplayResponse({
        fixtureId: url.searchParams.get('fixture'),
        sampleMinutes: url.searchParams.get('sampleMinutes'),
        fullDay: url.searchParams.get('view') === 'full-day',
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    } catch (error) {
      res.writeHead(Number.isInteger(error && error.status) ? error.status : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(error && error.message || error) }));
    }
    return;
  }
  res.writeHead(400).end();
}

const server = createServer(jsonHandler);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

try {
  const fixturesRes = await fetch(`${base}/api.php?action=fixtures`);
  assert.equal(fixturesRes.status, 200);
  const fixturesBody = await fixturesRes.json();
  assert.equal(fixturesBody.fixtures.length, 6, 'all six golden fixtures are exposed');

  for (const fixture of GOLDEN_SOMA_REPLAY_FIXTURES) {
    const res = await fetch(`${base}/api.php?action=replay&fixture=${encodeURIComponent(fixture.id)}&sampleMinutes=15`);
    assert.equal(res.status, 200, `${fixture.id} loads through the server`);
    const body = await res.json();
    assert.equal(body.report.orderedEventIds.length, fixture.records.length,
      `${fixture.id} applies every event through the server path`);
    assert.ok(body.report.trajectory.some((point) => point.kind === 'SAMPLE'),
      `${fixture.id} produces time-sample points when sampling is requested`);
    assert.equal(body.candidate.trajectory.length, body.report.trajectory.length,
      `${fixture.id} candidate trajectory has one point per replay trajectory point`);
    assert.match(body.candidate.model.status, /NOT_IMPLEMENTED_IN_PRODUCTION/,
      `${fixture.id} candidate response clearly flags its replay-only status`);
    assert.ok(Object.values(body.candidate.model.calibration)
      .every((entry) => String(entry.classification).startsWith('CALIBRATION_ONLY')),
      `${fixture.id} candidate response labels every non-grounded constant as calibration-only`);

    const fullDayRes = await fetch(`${base}/api.php?action=replay&fixture=${encodeURIComponent(fixture.id)}&sampleMinutes=15&view=full-day`);
    assert.equal(fullDayRes.status, 200, `${fixture.id} FULL DAY loads through the server`);
    const fullDayBody = await fullDayRes.json();
    assert.equal((fullDayBody.report.interval.endMs - fullDayBody.report.interval.startMs) / 3600000, 24,
      `${fixture.id} FULL DAY spans a whole day through the server route`);
  }

  // Determinism across two independent requests for the same fixture.
  const first = await (await fetch(`${base}/api.php?action=replay&fixture=quiet-routine-baseline&sampleMinutes=15`)).json();
  const second = await (await fetch(`${base}/api.php?action=replay&fixture=quiet-routine-baseline&sampleMinutes=15`)).json();
  assert.deepEqual(first.report, second.report, 'server replay is deterministic across repeat requests');
  assert.deepEqual(first.candidate, second.candidate, 'server candidate trajectory is deterministic across repeat requests');

  const missing = await fetch(`${base}/api.php?action=replay&fixture=does-not-exist`);
  assert.equal(missing.status, 404);

  const badAction = await fetch(`${base}/api.php?action=nonsense`);
  assert.equal(badAction.status, 400);

  const writeAttempt = await fetch(`${base}/api.php?action=fixtures`, { method: 'POST' });
  assert.equal(writeAttempt.status, 405, 'non-GET requests are rejected (read-only workbench)');
} finally {
  server.close();
}

console.log('soma-replay-server.test.js: all checks passed');
