// ollama-raw-transport.test.js - provider.js's Ollama rawGenerate posts via
// plain node:http instead of fetch, specifically to avoid undici's own
// ~300s headers-timeout (independent of any AbortSignal/timeoutMs the caller
// supplies) that would otherwise silently cap AWG_TIMEOUT_MS at ~300s no
// matter what value the constant is given. This file proves the functional
// contract (request/response shape, JSON parse, abort semantics) fast and
// deterministically against a loopback-only test server. The >300s timing
// claim itself is validated separately against the live model, not here -
// simulating a multi-minute hang deterministically in a unit test isn't
// practical, and Node's fetch/undici internals are not reconfigurable from
// userland in this runtime (no importable node:undici Agent).
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/ollama-raw-transport.test.js

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { makeProviders, OLLAMA } from './provider.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// ---- 1. normal fast response: request/response shape is unchanged ----
await (async () => {
  let receivedBody = null;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: 'hello', prompt_eval_count: 12, eval_count: 3 }));
    });
  });
  const port = await listen(server);
  const providers = makeProviders({ ollamaUrl: `http://127.0.0.1:${port}`, model: 'test-model' });
  const ollama = providers[OLLAMA];
  const out = await ollama.rawGenerate({ system: 'sys', prompt: 'prompt-text', opts: { temperature: 0.5 }, purpose: 'ambient_world_generation' });
  assert.equal(out.ok, true);
  assert.equal(out.status, 200);
  assert.equal(out.text, 'hello');
  assert.deepEqual(out.stats, { response: 'hello', prompt_eval_count: 12, eval_count: 3 });
  assert.equal(out.model, 'test-model');
  assert.equal(receivedBody.model, 'test-model');
  assert.equal(receivedBody.prompt, 'prompt-text');
  assert.equal(receivedBody.stream, false);
  assert.equal(receivedBody.keep_alive, -1);
  server.close();
  ok('rawGenerate posts the same JSON shape and returns the same {ok,status,text,stats,model} contract as before');
})();

// ---- 1b. structured output is passed only when a caller asks for it ----
// (moved from provider.test.js, which mocked global fetch - no longer possible
// since rawGenerate now posts via node:http, not fetch)
await (async () => {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: '{}' }));
    });
  });
  const port = await listen(server);
  const provider = makeProviders({ ollamaUrl: `http://127.0.0.1:${port}`, model: 'test-model', ollamaArbiterUrl: null }).ollama;
  const schema = { type: 'object', additionalProperties: false, properties: {} };
  await provider.rawGenerate({ system: 's', prompt: 'p', opts: {}, purpose: 'ambient_world_generation', format: schema });
  await provider.rawGenerate({ system: 's', prompt: 'p', opts: {}, purpose: 'drawing' });
  assert.deepEqual(requests[0].format, schema);
  assert.equal(Object.hasOwn(requests[1], 'format'), false);
  server.close();
  ok('Ollama receives JSON schema only for explicitly structured calls');
})();

// ---- 2. non-2xx status is reported, not thrown ----
await (async () => {
  const server = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(500); res.end('boom'); });
  });
  const port = await listen(server);
  const providers = makeProviders({ ollamaUrl: `http://127.0.0.1:${port}`, model: 'm' });
  const out = await providers[OLLAMA].rawGenerate({ system: '', prompt: '', opts: {}, purpose: 'ambient_world_generation' });
  assert.equal(out.ok, false);
  assert.equal(out.status, 500);
  assert.equal(out.text, '');
  server.close();
  ok('a non-2xx response is reported as {ok:false, status} without throwing');
})();

// ---- 3. abort tears the request down promptly, well before any server response ----
await (async () => {
  let serverSawClose = false;
  const server = createServer((req, res) => {
    req.on('data', () => {});
    // Deliberately never responds - only a client-side abort can end this.
    req.on('close', () => { serverSawClose = true; });
    void res;
  });
  const port = await listen(server);
  const providers = makeProviders({ ollamaUrl: `http://127.0.0.1:${port}`, model: 'm' });
  const ac = new AbortController();
  const t0 = Date.now();
  const pending = providers[OLLAMA].rawGenerate({ system: '', prompt: '', opts: {}, purpose: 'ambient_world_generation', signal: ac.signal });
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(pending, (error) => error && error.name === 'AbortError');
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1000, `abort must reject promptly, not wait for a response (took ${elapsed}ms)`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(serverSawClose, true, 'the underlying connection is actually torn down on abort, not merely ignored');
  server.close();
  ok('an aborted request rejects promptly with a distinguishable AbortError and tears down the connection');
})();

// ---- 4. an already-aborted signal rejects immediately without any request ----
await (async () => {
  let requestReached = false;
  const server = createServer((req, res) => { requestReached = true; res.end('{}'); });
  const port = await listen(server);
  const providers = makeProviders({ ollamaUrl: `http://127.0.0.1:${port}`, model: 'm' });
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    providers[OLLAMA].rawGenerate({ system: '', prompt: '', opts: {}, purpose: 'ambient_world_generation', signal: ac.signal }),
    (error) => error && error.name === 'AbortError',
  );
  assert.equal(requestReached, false, 'a pre-aborted signal never issues the request at all');
  server.close();
  ok('a pre-aborted signal short-circuits before any network activity');
})();

console.log(`\nollama-raw-transport.test.js: all ${n} checks passed`);
