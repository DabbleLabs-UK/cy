#!/usr/bin/env node
// OFFLINE ONLY. Prepare requests or inspect saved synthetic responses. There is no send mode.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { preparePrototype } from './grounded-occurrence.mjs';
import { awgDroughtActive, buildAwgCall } from '../../runner/ambient-world-generator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export function readVerifiedCapture(bundle) {
  const directory = fs.realpathSync(bundle);
  let verified = 0;
  for (const line of fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?([A-Za-z0-9_.-]+)$/.exec(line);
    assert.ok(match, 'Unsafe checksum entry');
    assert.equal(sha(fs.readFileSync(path.join(directory, match[2]))), match[1], match[2]);
    verified++;
  }
  const requestBytes = fs.readFileSync(path.join(directory, 'request.json'));
  const capture = JSON.parse(requestBytes);
  const outcome = JSON.parse(fs.readFileSync(path.join(directory, 'outcome.json'), 'utf8'));
  const nowMs = outcome.nowMs;
  assert.equal(capture.schema, 'cy.awg-capture.v1');
  assert.equal(new Date(nowMs).toISOString(), outcome.ranAt);
  const moduleSha = sha(fs.readFileSync(path.join(root, 'runner/ambient-world-generator.js')));
  assert.equal(moduleSha, capture.code.ambientWorldGeneratorSha, 'Current AWG differs from frozen production contract');
  const rebuilt = buildAwgCall(capture.contextRendering, { state: capture.worldSimulation, nowMs,
    currentLocation: capture.currentLocation, plausibleCastIds: capture.plausibleCastIds,
    recentEvents: capture.recentWorldHistory, droughtActive: awgDroughtActive(capture.worldSimulation) });
  for (const key of ['system', 'prompt', 'format']) assert.deepEqual(rebuilt[key], capture.request[key], key);
  for (const key of ['system', 'prompt', 'format', 'options']) assert.deepEqual(capture.postBody[key], capture.request[key], key);
  assert.equal(sha(JSON.stringify(capture.postBody)), capture.hashes.postBody);
  return { capture, nowMs, proof: { checksummedFiles: verified, requestFileSha256: sha(requestBytes),
    capturedRequestSha256: capture.hashes.postBody, productionAwgSha256: moduleSha, nowMs,
    productionContextReconstructed: true, productionCodeModified: false, inferenceExecuted: false } };
}
function main() {
  const refuseNetwork = () => { throw new Error('OFFLINE REHEARSAL: network/model requests forbidden'); };
  globalThis.fetch = refuseNetwork;
  http.request = http.get = https.request = https.get = refuseNetwork;
  net.connect = net.createConnection = net.Socket.prototype.connect = refuseNetwork;
  syncBuiltinESMExports();
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('OFFLINE ONLY: node scripts/rehearsal/prepare-grounded-occurrence.mjs --capture <verified-bundle> [--out <new-local-directory>] [--selection <saved-json>] [--proposal <saved-json>]');
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(['--capture', '--out', '--selection', '--proposal'].includes(args[i]) && args[i + 1]
      && !Object.hasOwn(options, args[i].slice(2)), 'Unknown/duplicate/incomplete option; no inference mode exists');
    options[args[i].slice(2)] = args[i + 1];
  }
  assert.ok(options.capture, '--capture is required');
  assert.ok(!options.proposal || options.selection, '--proposal requires --selection');
  const { capture, nowMs, proof } = readVerifiedCapture(options.capture);
  const result = preparePrototype(capture, { nowMs,
    selectionRaw: options.selection ? fs.readFileSync(options.selection, 'utf8') : null,
    proposalRaw: options.proposal ? fs.readFileSync(options.proposal, 'utf8') : null });
  if (options.out) {
    // Explicit new directory only. Never overwrite capture, runner, repo or runtime files.
    const output = path.resolve(options.out);
    assert.ok(!fs.existsSync(output), 'Output must be a new directory');
    const parent = fs.realpathSync(path.dirname(output));
    const candidate = path.join(parent, path.basename(output));
    const protectedRoots = [root, fs.realpathSync(options.capture), 'C:\\cy-rehearsal\\models',
      'C:\\dev\\cy', 'C:\\wamp\\www\\open-webui', path.join(process.env.LOCALAPPDATA || '', 'DabbleLabs/FedditBots')];
    for (const protectedRoot of protectedRoots) {
      const relative = path.relative(path.resolve(protectedRoot), candidate);
      assert.ok(relative && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'Protected output root');
    }
    fs.mkdirSync(candidate);
    const artifacts = { 'affordance-packet.json': result.packet, 'stage1-request.json': result.stage1Request,
      'trace.json': result.trace, 'verification.json': proof,
      ...(result.stage2Request ? { 'stage2-request.json': result.stage2Request } : {}) };
    for (const [name, value] of Object.entries(artifacts)) {
      fs.writeFileSync(path.join(candidate, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    }
    fs.writeFileSync(path.join(candidate, 'SHA256SUMS.txt'), Object.keys(artifacts).map(name => (
      `${sha(fs.readFileSync(path.join(candidate, name)))}  ${name}`
    )).join('\n') + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output: candidate, status: result.trace.status, inferenceExecuted: false,
      counts: { actors: result.packet.actors.length, usableObjects: result.packet.objects.length,
        continuableThreads: result.packet.threads.length, positiveRecentFacts: result.packet.recentFacts.length,
        explicitInteractions: result.packet.interactionOpportunities.length }, proof }, null, 2));
  } else console.log(JSON.stringify({ ...result, proof }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
