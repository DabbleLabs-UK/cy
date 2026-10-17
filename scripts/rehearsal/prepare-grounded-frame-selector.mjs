#!/usr/bin/env node
// OFFLINE ONLY. Verify frozen inputs and export a new checksummed package.
// No run/send mode, provider import, model load, production writer or publication.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareFrameSelector, evaluateFrameSelection, DOMAINS, FIELD_ORDER } from './grounded-frame-selector.mjs';
import { readVerifiedCapture } from './prepare-grounded-occurrence.mjs';
import { exactContextPreflight } from './one-call-context-budget.mjs';
import { prepareSemanticCore } from './semantic-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function git(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout.trim();
}
function safeChild(rootPath, relative) {
  const target = path.resolve(rootPath, relative);
  assert.ok(target.startsWith(path.resolve(rootPath) + path.sep), 'Unsafe manifest path');
  return target;
}
function verifyManifest(directory) {
  const entries = fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/);
  for (const line of entries) {
    const m = /^([a-f0-9]{64})  (.+)$/.exec(line); assert.ok(m, 'Invalid checksum entry');
    assert.equal(sha(fs.readFileSync(safeChild(directory, m[2]))), m[1], m[2]);
  }
  return entries.length;
}
function sourceClosure(entries) {
  const seen = new Set();
  function visit(relative) {
    relative = relative.replaceAll('\\', '/'); if (seen.has(relative)) return;
    seen.add(relative); const absolute = safeChild(root, relative);
    if (!/\.(?:js|mjs)$/.test(relative)) return;
    const text = fs.readFileSync(absolute, 'utf8');
    for (const m of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))
      visit(path.relative(root, path.resolve(path.dirname(absolute), m[1])));
  }
  entries.forEach(visit);
  return [...seen].sort();
}
function main() {
  const refuse = () => { throw new Error('OFFLINE_ONLY_NETWORK_AND_INFERENCE_FORBIDDEN'); };
  globalThis.fetch = refuse; http.request = http.get = https.request = https.get = refuse;
  net.connect = net.createConnection = net.Socket.prototype.connect = refuse; syncBuiltinESMExports();
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('OFFLINE ONLY: --capture <verified frozen bundle> --out <new external directory> [--model-store <verified isolated store>]. No inference mode.'); return;
  }
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(['--capture', '--out', '--model-store'].includes(args[i]) && args[i + 1]
      && !Object.hasOwn(opts, args[i]), 'Unknown/duplicate/incomplete argument; no inference mode exists');
    opts[args[i]] = args[i + 1];
  }
  assert.ok(opts['--capture'] && opts['--out'], '--capture and --out required');
  const sourceRevision = git('rev-parse', 'HEAD');
  assert.equal(git('status', '--porcelain'), '', 'Require committed clean source before preparing the handoff');
  assert.equal(git('diff', '--name-only', 'aaf8f5a07ca6c955ca7d5f1a62155f0336cdd500', '--', 'runner', 'public', 'lib', 'config', 'migrations'), '', 'Production paths changed');
  const { capture, nowMs, proof } = readVerifiedCapture(opts['--capture']);
  const prepared = prepareFrameSelector(capture, { nowMs });
  assert.deepEqual(prepared.bound.frames.map(f => f.operationDomain), DOMAINS, 'Unexpected frozen frame set');
  assert.deepEqual(prepared.request.format, JSON.parse(fs.readFileSync(path.join(root,
    'docs/rehearsal/grounded-frame-selector-schema.json'), 'utf8')), 'Documented schema differs from generated request');
  const modelStore = opts['--model-store'] || 'C:/cy-rehearsal/models';
  const preflight = exactContextPreflight(prepared.request, { modelStore });
  assert.ok(preflight.fits && !preflight.initialTruncation && preflight.spareAfterFullOutput >= 400);
  const previousPreflight = exactContextPreflight(prepareSemanticCore(capture, { nowMs }).request, { modelStore });
  const fixturePath = 'scripts/rehearsal/fixtures/frame-selector-renderer-examples.json';
  const fixtures = JSON.parse(fs.readFileSync(path.join(root, fixturePath), 'utf8'));
  assert.equal(fixtures.source, 'DETERMINISTIC_TEST_FIXTURES_ONLY'); assert.equal(fixtures.inferenceExecuted, false);
  const examples = fixtures.samples.map(example => {
    const frame = prepared.bound.frames.find(f => f.operationDomain === example.domain);
    const selection = { frameId: frame.frameId, content: example.content };
    const evaluation = evaluateFrameSelection(capture, prepared.bound, JSON.stringify(selection), { nowMs });
    assert.equal(evaluation.valid, true, evaluation.reason);
    assert.equal(evaluation.reconstructed.occurrence, example.expectedOccurrence);
    assert.deepEqual(evaluation.compatibilityExceptions, []);
    return { source: fixtures.source, inferenceExecuted: false, selection, evaluation };
  });
  const output = path.resolve(opts['--out']); assert.ok(!fs.existsSync(output), 'New output directory required');
  const candidate = path.join(fs.realpathSync(path.dirname(output)), path.basename(output));
  for (const protectedRoot of [root, fs.realpathSync(opts['--capture']), path.resolve(modelStore),
    path.resolve('C:/cy-rehearsal'), path.resolve('C:/dev/cy'), path.resolve('C:/wamp/www/open-webui'),
    path.resolve(process.env.LOCALAPPDATA || '', 'DabbleLabs/FedditBots')]) {
    const relative = path.relative(protectedRoot, candidate);
    assert.ok(relative && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'Protected output root');
  }
  const sourceFiles = sourceClosure(['scripts/rehearsal/grounded-frame-selector.mjs',
    'scripts/rehearsal/grounded-frame-selector.test.mjs',
    'scripts/rehearsal/prepare-grounded-frame-selector.mjs', 'scripts/rehearsal/prepare-grounded-occurrence.mjs',
    'scripts/rehearsal/semantic-core.mjs', 'scripts/rehearsal/one-call-context-budget.mjs',
    'scripts/rehearsal/cy-context-preflight.py', fixturePath, 'docs/rehearsal/grounded-frame-selector.md',
    'docs/rehearsal/grounded-frame-selector-schema.json']);
  const files = {
    'grounded-frames.json': prepared.bound,
    'frame-selector-request.json': prepared.request,
    'frame-selector-wire-body.json': Buffer.from(JSON.stringify(prepared.wire)),
    'model-facing-schema.json': prepared.request.format,
    'property-order.json': { topLevel: FIELD_ORDER,
      CY_IN_PLACE: ['operationId', 'modifier (optional)'], ADJACENT_NONVERBAL: ['operationId', 'detail (optional)'], ADJACENT_SPEECH: ['utterance'],
      branchOrder: prepared.bound.frames.map(f => f.operationDomain) },
    'context-preflight.json': preflight,
    'budget-comparison.json': { previous: previousPreflight, current: preflight },
    'test-renderer-examples.json': { source: fixtures.source, inferenceExecuted: false, examples },
    'trace.json': prepared.trace,
    'verification.json': { ...proof, sourceRevision, sourceClean: true, preparationNetworkDisabled: true,
      rehearsalWireSha256: sha(Buffer.from(JSON.stringify(prepared.wire))),
      modelCalls: 0, productionPathsUnchanged: true },
    'prototype-source.json': Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(path.join(root, file)))])),
    'HANDOFF.md': fs.readFileSync(path.join(root, 'docs/rehearsal/grounded-frame-selector.md')),
  };
  for (const file of sourceFiles) files[`pinned-source/${file}`] = fs.readFileSync(path.join(root, file));
  const bundle = fs.realpathSync(opts['--capture']);
  for (const line of fs.readFileSync(path.join(bundle, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?([A-Za-z0-9_.-]+)$/.exec(line); assert.ok(m);
    const bytes = fs.readFileSync(path.join(bundle, m[2])); assert.equal(sha(bytes), m[1]);
    files[`frozen-capture/${m[2]}`] = bytes;
  }
  files['frozen-capture/SHA256SUMS.txt'] = fs.readFileSync(path.join(bundle, 'SHA256SUMS.txt'));
  fs.mkdirSync(candidate);
  for (const [name, value] of Object.entries(files)) {
    const target = safeChild(candidate, name); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  }
  fs.writeFileSync(path.join(candidate, 'SHA256SUMS.txt'), Object.keys(files).sort().map(name =>
    `${sha(fs.readFileSync(safeChild(candidate, name)))}  ${name}`).join('\n') + '\n', { flag: 'wx' });
  assert.equal(verifyManifest(candidate), Object.keys(files).length);
  console.log(JSON.stringify({ output: candidate, sourceRevision, frames: prepared.bound.frames.map(f => ({ frameId: f.frameId, domain: f.operationDomain })),
    inputTokens: preflight.inputTokens, spareAfterFullOutput: preflight.spareAfterFullOutput, previousInputTokens: previousPreflight.inputTokens,
    wireSha256: sha(files['frame-selector-wire-body.json']), manifestSha256: sha(fs.readFileSync(path.join(candidate, 'SHA256SUMS.txt'))),
    checksummedFiles: Object.keys(files).length, modelCalls: 0, productionChanges: false }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
