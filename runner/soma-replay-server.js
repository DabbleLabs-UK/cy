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
import { GOLDEN_SOMA_REPLAY_FIXTURES, goldenFixture } from './soma-replay-fixtures.js';
import { runSomaReplay, DEFAULT_REPLAY_SAMPLE_INTERVAL_MS } from './soma-replay.js';
import { computeCandidateTrajectory, candidateModelMetadata } from './candidate-threat-anticipation-load.js';

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

function fixtureSummary(fixture) {
  return {
    id: fixture.id,
    title: fixture.title,
    startMs: fixture.startMs,
    endMs: fixture.endMs,
    eventCount: fixture.records.length,
  };
}

function resolveSampleParam(raw) {
  if (raw == null || raw === '' || raw === 'off' || raw === '0') return null;
  if (raw === 'default') return true;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return true;
  return minutes * 60 * 1000;
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/fixtures') {
    sendJson(res, 200, {
      defaultSampleIntervalMs: DEFAULT_REPLAY_SAMPLE_INTERVAL_MS,
      fixtures: GOLDEN_SOMA_REPLAY_FIXTURES.map(fixtureSummary),
    });
    return true;
  }
  if (url.pathname === '/api/replay') {
    const id = url.searchParams.get('fixture');
    const fixture = id ? goldenFixture(id) : null;
    if (!fixture) {
      sendJson(res, 404, { error: `unknown fixture: ${id || '(none supplied)'}` });
      return true;
    }
    try {
      const sampleIntervalMs = resolveSampleParam(url.searchParams.get('sampleMinutes'));
      const report = runSomaReplay({ ...fixture, sampleIntervalMs });
      // The candidate is a pure post-process over the already-computed
      // CURRENT report - no second replay run, no Soma state mutation, no
      // new grounded input. See candidate-threat-anticipation-load.js.
      const candidate = computeCandidateTrajectory(report);
      sendJson(res, 200, {
        fixture: fixtureSummary(fixture),
        report,
        candidate: { model: candidateModelMetadata(), trajectory: candidate },
      });
    } catch (error) {
      sendJson(res, 500, { error: String(error && error.message || error) });
    }
    return true;
  }
  return false;
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
