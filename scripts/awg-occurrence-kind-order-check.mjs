// REHEARSAL DIAGNOSTIC - DO NOT RUN until explicitly instructed.
//
// Purpose: empirically confirm that Ollama's schema->GBNF converter emits the
// transformed AWG object keys in `properties` insertion order, i.e. that
// `occurrenceKind` is actually emitted BEFORE `eventFamily`. The occurrenceKind
// experiment is only valid if that ordering holds; this probe verifies it
// structurally, cheaply and deterministically BEFORE any behavioural sampling run.
//
// It is read-only with respect to the runner: it reads a captured request.json
// (or builds a synthetic production-faithful request), applies the pure
// occurrenceKind transform to the FORMAT only, and sends a few constrained
// generations to a LOCAL Ollama. It writes nothing to runner state and nothing to
// VPS3; its only output is a small report file you point it at with --out.
//
// Order is enforced by the grammar independently of the sampler, so this probe
// overrides to a cheap deterministic sampler (temperature 0, a small num_predict
// ceiling) - just enough to emit the leading keys. The BEHAVIOURAL family-
// distribution run is a SEPARATE step that uses the captured options untouched.
//
// Usage (LENO, once authorised):
//   node scripts/awg-occurrence-kind-order-check.mjs \
//     --request <path-to-capture>/request.json \
//     [--samples 8] [--model <name>] [--host http://127.0.0.1:11434] \
//     [--num-predict 96] [--out <report.json>]
//   # or, without a capture, a synthetic faithful request:
//   node scripts/awg-occurrence-kind-order-check.mjs --samples 8 --model <name>
//
// Exit code 0 = every EVENT sample emitted occurrenceKind before eventFamily.
// Exit code 1 = at least one EVENT sample violated the order (experiment INVALID
//               as designed; the transform would need a structural ordering fix).

import { readFileSync, writeFileSync } from 'node:fs';
import { buildAwgProposalFormat } from '../runner/ambient-world-generator.js';
import { transformOccurrenceKind } from '../runner/awg-occurrence-kind-transform.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const requestPath = arg('request');
const samples = Number(arg('samples', '8'));
const host = (arg('host', process.env.OLLAMA_HOST || 'http://127.0.0.1:11434')).replace(/\/$/, '');
const numPredict = Number(arg('num-predict', '96'));
const outPath = arg('out', requestPath ? requestPath.replace(/request\.json$/, 'order-check.json') : 'order-check.json');

// Build the base request: either the exact captured postBody, or a synthetic
// production-faithful one. In both cases, ONLY the format is transformed.
function baseRequest() {
  if (requestPath) {
    const record = JSON.parse(readFileSync(requestPath, 'utf8'));
    const body = record.postBody || record.request;
    if (!body || !body.format) throw new Error('capture has no postBody/request with a format');
    return {
      model: body.model || arg('model'),
      system: body.system,
      prompt: body.prompt,
      format: body.format,
      options: body.options || {},
      source: 'capture',
    };
  }
  const model = arg('model');
  if (!model) throw new Error('without --request you must pass --model');
  const nowMs = Date.parse('2026-10-14T12:00:00.000Z');
  const format = buildAwgProposalFormat(
    { threads: [], objects: [] },
    { plausibleCastIds: ['bill', 'sweep'], currentLocation: 'cell', nowMs, droughtActive: false },
  );
  return {
    model,
    system: 'You are the ambient world generator. Return one JSON object only.',
    prompt: 'Propose exactly one structured candidate event, one continuation, or NO_EVENT for the current situation in the cell.',
    format,
    options: {},
    source: 'synthetic',
  };
}

async function generate(body) {
  const res = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: false }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return typeof json.response === 'string' ? json.response : JSON.stringify(json);
}

function classify(raw) {
  const occ = raw.indexOf('"occurrenceKind"');
  const fam = raw.indexOf('"eventFamily"');
  if (fam < 0 && occ < 0) return { kind: 'NO_EVENT', occ, fam, ok: true };
  if (occ < 0) return { kind: 'EVENT', occ, fam, ok: false, note: 'occurrenceKind missing' };
  if (fam < 0) return { kind: 'EVENT', occ, fam, ok: true, note: 'eventFamily not emitted (truncated); occurrenceKind present' };
  return { kind: 'EVENT', occ, fam, ok: occ < fam };
}

async function main() {
  const base = baseRequest();
  const transformed = transformOccurrenceKind(base.format);
  // Order is structural; use a cheap deterministic sampler just for the probe.
  const options = { ...base.options, temperature: 0, num_predict: numPredict };
  const body = {
    model: base.model, system: base.system, prompt: base.prompt, format: transformed, options,
  };
  if (!body.model) throw new Error('no model resolved (pass --model)');

  console.log(`[order-check] host=${host} model=${body.model} source=${base.source} samples=${samples} num_predict=${numPredict}`);
  const results = [];
  for (let i = 0; i < samples; i += 1) {
    try {
      const raw = await generate(body);
      const c = classify(raw);
      results.push({ i, ...c, rawHead: raw.slice(0, 240) });
      console.log(`  #${i} ${c.kind} ${c.ok ? 'OK' : 'FAIL'}${c.note ? ' (' + c.note + ')' : ''} occ@${c.occ} fam@${c.fam}`);
    } catch (err) {
      results.push({ i, kind: 'ERROR', ok: false, error: String(err && err.message || err) });
      console.log(`  #${i} ERROR ${err && err.message}`);
    }
  }

  const events = results.filter((r) => r.kind === 'EVENT');
  const failures = results.filter((r) => r.ok === false);
  const report = {
    schema: 'cy.awg-occurrence-kind-order-check.v1',
    checkedAt: new Date().toISOString(),
    host,
    model: body.model,
    source: base.source,
    requestPath: requestPath || null,
    samples,
    numPredict,
    counts: {
      total: results.length,
      event: events.length,
      noEvent: results.filter((r) => r.kind === 'NO_EVENT').length,
      error: results.filter((r) => r.kind === 'ERROR').length,
      failures: failures.length,
    },
    verdict: failures.length === 0 && events.length > 0
      ? 'ORDER_CONFIRMED'
      : (events.length === 0 ? 'INCONCLUSIVE_NO_EVENTS' : 'ORDER_VIOLATED'),
    results,
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[order-check] verdict=${report.verdict} failures=${failures.length} -> ${outPath}`);
  process.exit(failures.length === 0 && events.length > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[order-check] fatal:', err && err.message || err);
  process.exit(2);
});
