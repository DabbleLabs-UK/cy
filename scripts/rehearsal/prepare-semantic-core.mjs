#!/usr/bin/env node
// Offline package/fixture replay only. This CLI has no send/run mode.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { prepareSemanticCore, FIELD_ORDER } from './semantic-core.mjs';
import { replayLegacy } from './semantic-core-replay.mjs';
import { readVerifiedCapture } from './prepare-grounded-occurrence.mjs';
import { exactContextPreflight } from './one-call-context-budget.mjs';
import { prepareOneCall } from './one-call-grounded-proposal.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function checksums(directory) {
  let n = 0;
  for (const line of fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})  (.+)$/.exec(line); assert.ok(m);
    const target = path.resolve(directory, m[2]);
    assert.ok(target.startsWith(path.resolve(directory) + path.sep));
    assert.equal(sha(fs.readFileSync(target)), m[1], m[2]); n++;
  }
  return n;
}
function main() {
  const refuse = () => { throw new Error('OFFLINE_ONLY_NETWORK_AND_INFERENCE_FORBIDDEN'); };
  globalThis.fetch = refuse; http.request = http.get = https.request = https.get = refuse;
  net.connect = net.createConnection = net.Socket.prototype.connect = refuse; syncBuiltinESMExports();
  const args = process.argv.slice(2), opts = {};
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(['--capture', '--out', '--model-store', '--legacy-evidence'].includes(args[i]) && args[i + 1]
      && !Object.hasOwn(opts, args[i]), 'Unknown/duplicate/incomplete argument; no inference mode exists');
    opts[args[i]] = args[i + 1];
  }
  assert.ok(opts['--capture'] && opts['--out'], '--capture and --out required');
  const { capture, nowMs, proof } = readVerifiedCapture(opts['--capture']);
  const prepared = prepareSemanticCore(capture, { nowMs });
  const modelStore = opts['--model-store'] || 'C:/cy-rehearsal/models';
  const preflight = exactContextPreflight(prepared.request, { modelStore });
  const previousPreflight = exactContextPreflight(prepareOneCall(capture, { nowMs }).request, { modelStore });
  const output = path.resolve(opts['--out']); assert.ok(!fs.existsSync(output), 'New output directory required');
  const candidate = path.join(fs.realpathSync(path.dirname(output)), path.basename(output));
  for (const protectedRoot of [root, fs.realpathSync(opts['--capture']), path.resolve('C:/cy-rehearsal'),
    path.resolve('C:/dev/cy'), path.resolve('C:/wamp/www/open-webui'),
    path.resolve(process.env.LOCALAPPDATA || '', 'DabbleLabs/FedditBots'),
    ...(opts['--legacy-evidence'] ? [fs.realpathSync(opts['--legacy-evidence'])] : [])]) {
    const relative = path.relative(protectedRoot, candidate);
    assert.ok(relative && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'Protected output root');
  }
  const files = { 'affordance-packet.json': prepared.packet, 'semantic-core-request.json': prepared.request,
    'semantic-core-wire-body.json': Buffer.from(JSON.stringify(prepared.wire)),
    'model-facing-schema.json': prepared.request.format, 'context-preflight.json': preflight,
    'budget-comparison.json': { previous: previousPreflight, current: preflight },
    'property-order.json': { topLevel: FIELD_ORDER, role: ['entityId', 'role'] },
    'trace.json': prepared.trace, 'verification.json': proof };
  const sourceFiles = ['scripts/rehearsal/semantic-core.mjs', 'scripts/rehearsal/semantic-core-replay.mjs',
    'scripts/rehearsal/prepare-semantic-core.mjs', 'scripts/rehearsal/one-call-grounded-proposal.mjs',
    'scripts/rehearsal/grounded-occurrence.mjs', 'scripts/rehearsal/one-call-context-budget.mjs',
    'scripts/rehearsal/cy-context-preflight.py', 'runner/ambient-world-generator.js', 'runner/cast.js',
    'runner/location-regime.js', 'runner/message-object-lifecycle.js'];
  files['prototype-source.json'] = Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(path.join(root, file)))]));
  if (opts['--legacy-evidence']) {
    const evidence = fs.realpathSync(opts['--legacy-evidence']);
    const verifiedFiles = checksums(evidence);
    const rows = fs.readFileSync(path.join(evidence, 'results.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(rows.length, 10); assert.equal(rows.filter(r => r.evaluation?.parsed).length, 9);
    files['legacy-replay.json'] = replayLegacy(capture, nowMs, rows);
    assert.ok(files['legacy-replay.json'].every(r => r.unchangedOccurrence === rows.find(x => x.index === r.index).evaluation.parsed.occurrence.summary));
    files['legacy-evidence-verification.json'] = { evidence, verifiedFiles,
      manifestSha256: sha(fs.readFileSync(path.join(evidence, 'SHA256SUMS.txt'))),
      resultsSha256: sha(fs.readFileSync(path.join(evidence, 'results.jsonl'))), inferenceExecuted: false, originalsChanged: false };
  }
  fs.mkdirSync(candidate);
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(candidate, name),
    Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(candidate, 'SHA256SUMS.txt'), Object.keys(files).map(name => `${sha(fs.readFileSync(path.join(candidate, name)))}  ${name}`).join('\n') + '\n', { flag: 'wx' });
  assert.equal(checksums(candidate), Object.keys(files).length);
  console.log(JSON.stringify({ output: candidate, fieldOrder: FIELD_ORDER, inputTokens: preflight.inputTokens,
    spareAfterFullOutput: preflight.spareAfterFullOutput, previousInputTokens: previousPreflight.inputTokens,
    wireSha256: sha(files['semantic-core-wire-body.json']), replay: files['legacy-replay.json']?.map(r => ({ index: r.index,
      valid: r.evaluation.valid, reason: r.evaluation.reason })), modelCalls: 0, productionChanges: false }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
