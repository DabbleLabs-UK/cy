#!/usr/bin/env node
// OFFLINE ONLY. Prepare the counterbalanced neutral-decision gate requests for the
// grounded Stage-1 diagnostic. There is NO send/inference mode. The gate sampling
// itself is a separate, explicitly authorised LENO step; this script only builds
// and writes the two arm requests plus verification artifacts.
//
// The single-token labels are verified against a tokenization record that MUST be
// produced on LENO by the EXACT CY model tokenizer (see the handoff doc). This
// script does not call the model or any tokenizer itself.
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
import { buildNeutralGate, selectNeutralLabelPair, verifyLabels, NEUTRAL_LABEL_POOL } from './neutral-gate-diagnostic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function resolveLabels(tokenization, explicit) {
  if (explicit) {
    const labels = explicit.split(',').map((s) => s.trim()).filter(Boolean);
    assert.equal(labels.length, 2, 'Exactly two labels required');
    const verification = verifyLabels(labels, tokenization);
    assert.ok(verification.ok, `Supplied labels are not tokenizer-balanced single tokens: ${JSON.stringify(verification)}`);
    return { labels, verification, selectedFrom: 'EXPLICIT' };
  }
  const { labels, verification } = selectNeutralLabelPair(NEUTRAL_LABEL_POOL, tokenization);
  return { labels, verification, selectedFrom: 'POOL' };
}

function main() {
  const refuseNetwork = () => { throw new Error('OFFLINE REHEARSAL: network/model requests forbidden'); };
  globalThis.fetch = refuseNetwork;
  http.request = http.get = https.request = https.get = refuseNetwork;
  net.connect = net.createConnection = net.Socket.prototype.connect = refuseNetwork;
  syncBuiltinESMExports();

  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('OFFLINE ONLY: node scripts/rehearsal/prepare-neutral-gate.mjs --capture <verified-bundle> --tokenization <json> [--labels L1,L2] [--out <new-local-directory>]');
    console.log('--tokenization: JSON mapping each candidate label to its token id array (or count) under the EXACT CY model tokenizer.');
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(['--capture', '--tokenization', '--labels', '--out'].includes(args[i]) && args[i + 1]
      && !Object.hasOwn(options, args[i].slice(2)), 'Unknown/duplicate/incomplete option; no inference mode exists');
    options[args[i].slice(2)] = args[i + 1];
  }
  assert.ok(options.capture, '--capture is required');
  assert.ok(options.tokenization, '--tokenization is required (real CY tokenizer output)');

  const { capture, nowMs, proof } = readVerifiedCapture(options.capture);
  const tokenization = JSON.parse(fs.readFileSync(options.tokenization, 'utf8'));
  const { labels, verification, selectedFrom } = resolveLabels(tokenization, options.labels);
  const prepared = buildNeutralGate(capture, { nowMs, labels, tokenization });

  const summary = {
    status: 'PREPARED_ONLY', inferenceExecuted: false, selectedFrom,
    labels, labelVerification: verification, packetFingerprint: prepared.packetFingerprint,
    packetNeutralisedFields: prepared.packetNeutralisedFields, mapping: prepared.mapping,
    semanticLegend: prepared.semanticLegend, nowMs, proof,
  };

  if (options.out) {
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
    const artifacts = {
      'arm-A-request.json': prepared.arms.A,
      'arm-B-request.json': prepared.arms.B,
      'prepared-gate.json': prepared,
      'verification.json': proof,
    };
    for (const [name, value] of Object.entries(artifacts)) {
      fs.writeFileSync(path.join(candidate, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    }
    fs.writeFileSync(path.join(candidate, 'SHA256SUMS.txt'), Object.keys(artifacts).map((name) => (
      `${sha(fs.readFileSync(path.join(candidate, name)))}  ${name}`
    )).join('\n') + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output: candidate, ...summary }, null, 2));
  } else {
    console.log(JSON.stringify({ prepared, ...summary }, null, 2));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
