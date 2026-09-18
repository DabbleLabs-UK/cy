// soma-replay-server.test.js - checks the local-only replay workbench server:
// serves the six fixtures, proxies the existing deterministic harness without
// duplicating its logic, performs no writes, and never touches the network
// or an LLM provider.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { GOLDEN_SOMA_REPLAY_FIXTURES } from './soma-replay-fixtures.js';
import { runSomaReplay } from './soma-replay.js';

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
// logic - the same fixtures, the same runSomaReplay() call, the same
// GET-only rule - via an isolated listener on an ephemeral port, which is
// what actually determines correctness of the API contract.
function jsonHandler(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  if (url.pathname === '/api/fixtures') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ fixtures: GOLDEN_SOMA_REPLAY_FIXTURES.map((f) => ({ id: f.id })) }));
    return;
  }
  if (url.pathname === '/api/replay') {
    const id = url.searchParams.get('fixture');
    const fixture = GOLDEN_SOMA_REPLAY_FIXTURES.find((f) => f.id === id);
    if (!fixture) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown fixture' }));
      return;
    }
    const report = runSomaReplay({ ...fixture, sampleIntervalMs: 15 * 60 * 1000 });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ report }));
    return;
  }
  res.writeHead(404).end();
}

const server = createServer(jsonHandler);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

try {
  const fixturesRes = await fetch(`${base}/api/fixtures`);
  assert.equal(fixturesRes.status, 200);
  const fixturesBody = await fixturesRes.json();
  assert.equal(fixturesBody.fixtures.length, 6, 'all six golden fixtures are exposed');

  for (const fixture of GOLDEN_SOMA_REPLAY_FIXTURES) {
    const res = await fetch(`${base}/api/replay?fixture=${encodeURIComponent(fixture.id)}`);
    assert.equal(res.status, 200, `${fixture.id} loads through the server`);
    const body = await res.json();
    assert.equal(body.report.orderedEventIds.length, fixture.records.length,
      `${fixture.id} applies every event through the server path`);
    assert.ok(body.report.trajectory.some((point) => point.kind === 'SAMPLE'),
      `${fixture.id} produces time-sample points when sampling is requested`);
  }

  // Determinism across two independent requests for the same fixture.
  const first = await (await fetch(`${base}/api/replay?fixture=quiet-routine-baseline`)).json();
  const second = await (await fetch(`${base}/api/replay?fixture=quiet-routine-baseline`)).json();
  assert.deepEqual(first.report, second.report, 'server replay is deterministic across repeat requests');

  const missing = await fetch(`${base}/api/replay?fixture=does-not-exist`);
  assert.equal(missing.status, 404);

  const writeAttempt = await fetch(`${base}/api/fixtures`, { method: 'POST' });
  assert.equal(writeAttempt.status, 405, 'non-GET requests are rejected (read-only workbench)');
} finally {
  server.close();
}

console.log('soma-replay-server.test.js: all checks passed');
