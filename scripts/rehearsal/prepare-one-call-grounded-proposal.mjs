#!/usr/bin/env node
// OFFLINE ONLY. No inference mode. Generate requests or inspect saved fixture output.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readVerifiedCapture } from './prepare-grounded-occurrence.mjs';
import { prepareOneCall, FIELD_ORDER } from './one-call-grounded-proposal.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function main() {
  const refuse = () => { throw new Error('OFFLINE ONLY: network and inference forbidden'); };
  globalThis.fetch = refuse;
  http.request = http.get = https.request = https.get = refuse;
  net.connect = net.createConnection = net.Socket.prototype.connect = refuse;
  syncBuiltinESMExports();
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('OFFLINE ONLY: --capture <verified-frozen-bundle> --out <new-local-directory> [--proposal <saved-json>]');
    return;
  }
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(['--capture', '--out', '--proposal'].includes(args[i]) && args[i + 1]
      && !Object.hasOwn(opts, args[i].slice(2)), 'Unknown/duplicate/incomplete option; no inference mode exists');
    opts[args[i].slice(2)] = args[i + 1];
  }
  assert.ok(opts.capture && opts.out, '--capture and --out required');
  const { capture, nowMs, proof } = readVerifiedCapture(opts.capture);
  const prepared = prepareOneCall(capture, { nowMs,
    raw: opts.proposal ? fs.readFileSync(opts.proposal, 'utf8') : null });
  const output = path.resolve(opts.out);
  assert.ok(!fs.existsSync(output), 'Output must be a new directory');
  const candidate = path.join(fs.realpathSync(path.dirname(output)), path.basename(output));
  const protectedRoots = [root, fs.realpathSync(opts.capture), 'C:\\cy-rehearsal', 'C:\\dev\\cy',
    'C:\\wamp\\www\\open-webui', path.join(process.env.LOCALAPPDATA || '', 'DabbleLabs/FedditBots'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs/Feddit Bots')];
  for (const p of protectedRoots) {
    const relative = path.relative(path.resolve(p), candidate);
    assert.ok(relative && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'Protected output root');
  }
  const artifacts = {
    'affordance-packet.json': prepared.packet,
    'one-call-request.json': prepared.request,
    'one-call-wire-body.json': Buffer.from(JSON.stringify({ ...prepared.request, stream: false, keep_alive: '5m' })),
    'model-facing-schema.json': prepared.request.format,
    'property-order.json': { topLevel: [...FIELD_ORDER],
      occurrence: Object.keys(prepared.request.format.properties.occurrence.properties),
      observation: Object.keys(prepared.request.format.properties.observation.properties),
      model: prepared.request.model, options: prepared.request.options },
    'trace.json': prepared.trace,
    'verification.json': { ...proof, prototype: 'ONE_CALL_GROUNDED_PROPOSAL',
      productionStateApplied: false, maximumCallsPerAdmittedAttempt: 1, repairs: 0, replacements: 0 },
  };
  fs.mkdirSync(candidate);
  for (const [name, value] of Object.entries(artifacts)) {
    fs.writeFileSync(path.join(candidate, name), Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  }
  fs.writeFileSync(path.join(candidate, 'SHA256SUMS.txt'), Object.keys(artifacts).map(name => (
    `${sha(fs.readFileSync(path.join(candidate, name)))}  ${name}`
  )).join('\n') + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output: candidate, inferenceExecuted: false, status: prepared.trace.status,
    fieldOrder: FIELD_ORDER, counts: { actors: prepared.packet.actors.length, objects: prepared.packet.objects.length,
      threads: prepared.packet.threads.length, recentFacts: prepared.packet.recentFacts.length },
    requestSha256: sha(fs.readFileSync(path.join(candidate, 'one-call-request.json'))),
    wireSha256: sha(fs.readFileSync(path.join(candidate, 'one-call-wire-body.json'))),
    schemaSha256: sha(fs.readFileSync(path.join(candidate, 'model-facing-schema.json'))), proof }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
