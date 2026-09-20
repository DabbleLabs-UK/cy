#!/usr/bin/env node
// soma-replay-server.js - local-only static server + read-only replay API for
// the Soma replay workbench (developer tooling, not a public Cy feature).
//
// Serves the workbench page from ./replay-viewer and a tiny JSON API that
// calls the existing soma-replay.js harness directly. It performs no writes,
// no provider/network inference calls, and no production Soma mutation - it
// only runs the same deterministic, in-memory replay the CLI and tests use.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixturesResponse, buildReplayResponse } from './soma-replay-api.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.SOMA_REPLAY_PORT) || 4610;
const VIEWER_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'replay-viewer');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

// Single 'action=' entrypoint matching the hosted deployment's api.php
// exactly (see docs/dev-admin-ui-hosting.md), so runner/replay-viewer/viewer.js
// needs no environment-specific branching between local dev and vps3.
async function handleApi(req, res, url) {
  if (url.pathname !== '/api.php') return false;
  const action = url.searchParams.get('action');
  if (action === 'fixtures') {
    sendJson(res, 200, buildFixturesResponse());
    return true;
  }
  if (action === 'replay') {
    try {
      const body = buildReplayResponse({
        fixtureId: url.searchParams.get('fixture'),
        sampleMinutes: url.searchParams.get('sampleMinutes'),
        fullDay: url.searchParams.get('view') === 'full-day',
      });
      sendJson(res, 200, body);
    } catch (error) {
      sendJson(res, Number.isInteger(error && error.status) ? error.status : 500,
        { error: String(error && error.message || error) });
    }
    return true;
  }
  sendJson(res, 400, { error: `unknown action: ${action || '(none supplied)'}` });
  return true;
}

async function handleStatic(req, res, url) {
  let relPath = url.pathname === '/' ? '/index.html' : url.pathname;
  relPath = relPath.replace(/\0/g, '');
  const filePath = join(VIEWER_DIR, relPath);
  if (!filePath.startsWith(VIEWER_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}

const server = createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('read-only workbench: only GET is supported');
    return;
  }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  handleApi(req, res, url).then((handled) => {
    if (!handled) handleStatic(req, res, url);
  }).catch((error) => {
    sendJson(res, 500, { error: String(error && error.message || error) });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Soma replay workbench: http://${HOST}:${PORT}/`);
  console.log('Local, read-only developer tool. Ctrl+C to stop.');
});
