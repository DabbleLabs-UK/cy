#!/usr/bin/env node
// OFFLINE ONLY. Package stateful rehearsal with deterministic fixture callbacks, never inference.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSequentialFrameSession, runTenSequentialAttempts, SEQUENTIAL_POLICY } from './sequential-frame-selector.mjs';
import { readVerifiedCapture } from './prepare-grounded-occurrence.mjs';
import { exactContextPreflight } from './one-call-context-budget.mjs';
import { prepareFrameSelector } from './grounded-frame-selector.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function git(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout.trim();
}
function child(directory, name) {
  const target = path.resolve(directory, name);
  assert.ok(target.startsWith(path.resolve(directory) + path.sep), 'UNSAFE_PACKAGE_PATH'); return target;
}
function closure(entries) {
  const seen = new Set();
  function visit(name) {
    name = name.replaceAll('\\', '/'); if (seen.has(name)) return; seen.add(name);
    const absolute = child(root, name);
    if (!/\.(?:js|mjs)$/.test(name)) return;
    for (const match of fs.readFileSync(absolute, 'utf8').matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))
      visit(path.relative(root, path.resolve(path.dirname(absolute), match[1])));
  }
  entries.forEach(visit); return [...seen].sort();
}

// These are OFFLINE TEST CONTENTS, not a menu or instructions sent to the model.
// The first trace reproduces only the recorded content choices of the earlier independent
// ten-run batch, rebound to fresh frame IDs. It is NOT a new behavioural/model result.
export const BUDGET_SCENARIOS = {
  PRIOR_CONTENTS_REBOUND_TEST_ONLY: [
    ['ADJACENT_NONVERBAL', { operationId: 'COUGHING', detail: null }],
    ['CY_IN_PLACE', { operationId: 'TAP_FINGERS', modifier: null }],
    ['ADJACENT_NONVERBAL', { operationId: 'COUGHING', detail: 'BRIEF' }],
    ['CY_IN_PLACE', { operationId: 'TAP_FINGERS', modifier: null }],
    ['ADJACENT_NONVERBAL', { operationId: 'COUGHING', detail: null }],
    ['CY_IN_PLACE', { operationId: 'TAP_FINGERS' }],
    ['ADJACENT_NONVERBAL', { operationId: 'COUGHING', detail: null }],
    ['CY_IN_PLACE', { operationId: 'TAP_FINGERS', modifier: null }],
    ['CY_IN_PLACE', { operationId: 'TAP_FINGERS' }],
    ['CY_IN_PLACE', { operationId: 'TAP_FINGERS', modifier: null }],
  ],
  WINDOW_AND_SPEECH_TEST_ONLY: [
    ['CY_IN_PLACE', { operationId: 'SHIFT_WEIGHT' }], ['CY_IN_PLACE', { operationId: 'STRETCH_HANDS' }],
    ['CY_IN_PLACE', { operationId: 'TAP_FINGERS' }], ['ADJACENT_NONVERBAL', { operationId: 'COUGHING' }],
    ['ADJACENT_SPEECH', { utterance: 'hello' }], ['ADJACENT_SPEECH', { utterance: 'who is there?' }],
    ['ADJACENT_NONVERBAL', { operationId: 'KNOCKING' }], ['ADJACENT_NONVERBAL', { operationId: 'FOOTSTEPS' }],
    ['CY_IN_PLACE', { operationId: 'SHIFT_WEIGHT', modifier: 'SLOWLY' }], ['ADJACENT_SPEECH', { utterance: 'anyone still awake?' }],
  ],
  REJECTED_INPUT_TEST_ONLY: Array.from({ length: 10 }, () => ['ADJACENT_SPEECH', { utterance: 'bill took it yesterday' }]),
};

export async function offlineSequenceEvidence(capture, nowMs, { modelStore = 'C:/cy-rehearsal/models' } = {}) {
  const traces = {};
  for (const [name, contents] of Object.entries(BUDGET_SCENARIOS)) {
    const session = createSequentialFrameSession(capture, { nowMs }); let index = 0;
    traces[name] = await runTenSequentialAttempts(session, {
      preflight: request => exactContextPreflight(request, { modelStore }),
      generate: wire => {
        const ticket = session.prepareNext(), [domain, content] = contents[index++];
        assert.deepEqual(wire, ticket.prepared.wire); assert.equal(wire.truncate, false);
        return JSON.stringify({ frameId: ticket.prepared.bound.frames.find(f => f.operationDomain === domain).frameId, content });
      },
    });
    assert.equal(index, 10);
  }
  const receipts = Object.values(traces).flatMap(rows => rows.map(r => r.result.contextPreflight));
  assert.ok(receipts.every(r => r.fits && !r.initialTruncation && r.spareAfterFullOutput >= 1600));
  return { source: 'DETERMINISTIC_OFFLINE_FIXTURES_NOT_MODEL_GENERATIONS', modelRequests: 0,
    actualInferenceExecuted: false, traces,
    budget: { measuredFixtureRequests: receipts.length,
      inputMin: Math.min(...receipts.map(r => r.inputTokens)), inputMax: Math.max(...receipts.map(r => r.inputTokens)),
      spareMin: Math.min(...receipts.map(r => r.spareAfterFullOutput)), spareMax: Math.max(...receipts.map(r => r.spareAfterFullOutput)),
      context: 3072, outputAllowance: 420, terminalReserve: 1,
      firstInput: receipts[0].inputTokens, perActualAttemptExactGuardRequired: true,
      observedRangeIsNotExhaustiveBound: true, semanticHistoryGrowthInPrompt: true,
      historyRepresentation: 'BOUNDED_NEGATIVE_DOMAIN_OPERATION_OR_UTTERANCE', sourceWindowHours: 24, sourceLimit: 32 } };
}

async function main() {
  const refuse = () => { throw new Error('OFFLINE_ONLY_NO_NETWORK_OR_INFERENCE'); };
  globalThis.fetch = refuse; http.request = http.get = https.request = https.get = refuse;
  net.connect = net.createConnection = net.Socket.prototype.connect = refuse; syncBuiltinESMExports();
  const args = process.argv.slice(2), options = {};
  if (args.length === 1 && args[0] === '--help') {
    console.log('OFFLINE ONLY: --capture <frozen bundle> --out <new external directory> [--model-store <isolated metadata>]. No inference mode.'); return;
  }
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(['--capture', '--out', '--model-store'].includes(args[i]) && args[i + 1]
      && !Object.hasOwn(options, args[i]), 'UNKNOWN_ARGUMENT_NO_INFERENCE_MODE'); options[args[i]] = args[i + 1];
  }
  assert.ok(options['--capture'] && options['--out'], 'CAPTURE_AND_NEW_OUTPUT_REQUIRED');
  const revision = git('rev-parse', 'HEAD'); assert.equal(git('status', '--porcelain'), '', 'CLEAN_COMMITTED_SOURCE_REQUIRED');
  assert.equal(git('diff', '--name-only', '626133b', '--', 'runner', 'public', 'lib', 'config', 'sql',
    'scripts/rehearsal/grounded-frame-selector.mjs', 'scripts/rehearsal/one-call-context-budget.mjs',
    'scripts/rehearsal/cy-context-preflight.py'), '', 'PINNED_PRODUCTION_OR_PROTOTYPE_CHANGED');
  const { capture, nowMs, proof } = readVerifiedCapture(options['--capture']);
  const session = createSequentialFrameSession(capture, { nowMs }), initial = session.prepareNext();
  assert.equal(sha(JSON.stringify(prepareFrameSelector(capture, { nowMs }).wire)),
    '72727c4ce42c41c742e2d80a4d97ce42d279d1f73ac3c612bd93bac6e15f15d5', 'UNGUIDED_BASE_MUST_MATCH_VERIFIED_FROZEN_BATCH');
  assert.deepEqual(initial.prepared.repetitionGuidance.entries, [], 'NO_INVENTED_INITIAL_GUIDANCE');
  const evidence = await offlineSequenceEvidence(capture, nowMs, { modelStore: options['--model-store'] });
  const sources = closure(['scripts/rehearsal/sequential-frame-selector.mjs', 'scripts/rehearsal/sequential-frame-selector.test.mjs',
    'scripts/rehearsal/frame-repetition-guidance.test.mjs',
    'scripts/rehearsal/prepare-sequential-frame-selector.mjs', 'scripts/rehearsal/prepare-grounded-occurrence.mjs',
    'scripts/rehearsal/one-call-context-budget.mjs', 'scripts/rehearsal/cy-context-preflight.py',
    'docs/rehearsal/sequential-frame-selector.md']);
  const files = {
    'verification.json': { ...proof, sourceRevision: revision, baseRevision: '3b930d59c70d46f4778b43629629490b27fb5f1b',
      sourceClean: true, preparationNetworkDisabled: true, modelRequests: 0, productionChanged: false,
      initialWireSha256: sha(JSON.stringify(initial.prepared.wire)) },
    'initial-step.json': initial, 'initial-wire.json': Buffer.from(JSON.stringify(initial.prepared.wire)),
    'initial-shadow-state.json': capture, 'budget.json': evidence.budget,
    'offline-test-traces.json': evidence,
    'plan.json': { policy: SEQUENTIAL_POLICY, attempts: 10, maximumModelCallsPerAttempt: 1,
      repair: false, replacement: false, stage2: false, productionApplied: false,
      timePolicy: 'ADVANCE_TO_NEXT_PINNED_PRODUCTION_ELIGIBILITY', externalWorldAndRegime: 'FROZEN_CONTROLLED_ENVELOPE',
      readableHistoryAddedToModel: true, historyIsAdvisoryOnly: true, frameFilterApplied: false,
      droughtDiagnosticOnly: true, truncate: false },
    'HANDOFF.md': fs.readFileSync(path.join(root, 'docs/rehearsal/sequential-frame-selector.md')),
    'prototype-source.json': Object.fromEntries(sources.map(name => [name, sha(fs.readFileSync(child(root, name)))])),
  };
  for (const name of sources) files[`pinned-source/${name}`] = fs.readFileSync(child(root, name));
  const bundle = fs.realpathSync(options['--capture']);
  for (const line of fs.readFileSync(`${bundle}/SHA256SUMS.txt`, 'utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?([\w.-]+)$/.exec(line); assert.ok(match);
    const bytes = fs.readFileSync(child(bundle, match[2])); assert.equal(sha(bytes), match[1]);
    files[`frozen-capture/${match[2]}`] = bytes;
  }
  files['frozen-capture/SHA256SUMS.txt'] = fs.readFileSync(`${bundle}/SHA256SUMS.txt`);
  const output = path.resolve(options['--out']); assert.ok(!fs.existsSync(output), 'NEW_DIRECTORY_REQUIRED');
  const candidate = path.join(fs.realpathSync(path.dirname(output)), path.basename(output));
  for (const protectedRoot of [root, bundle, options['--model-store'] || 'C:/cy-rehearsal/models',
    'C:/cy-rehearsal', 'C:/dev/cy', 'C:/wamp/www/open-webui',
    path.join(process.env.LOCALAPPDATA || '', 'DabbleLabs/FedditBots')]) {
    const relative = path.relative(path.resolve(protectedRoot), candidate);
    assert.ok(relative && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'PROTECTED_OUTPUT_ROOT');
  }
  fs.mkdirSync(candidate);
  for (const [name, value] of Object.entries(files)) {
    const file = child(candidate, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  }
  const manifest = Object.keys(files).sort().map(name => `${sha(fs.readFileSync(child(candidate, name)))}  ${name}`).join('\n') + '\n';
  fs.writeFileSync(`${candidate}/SHA256SUMS.txt`, manifest, { flag: 'wx' });
  for (const [name, value] of Object.entries(files)) assert.equal(sha(fs.readFileSync(child(candidate, name))),
    sha(Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n'));
  console.log(JSON.stringify({ output: candidate, sourceRevision: revision, filesVerified: Object.keys(files).length,
    manifestSha256: sha(manifest), budget: evidence.budget,
    offlineFixtureAcceptances: Object.fromEntries(Object.entries(evidence.traces).map(([key, rows]) => [key, rows.filter(r => r.wouldAccept).length])),
    modelRequests: 0, serverStarts: 0, productionChanged: false }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
