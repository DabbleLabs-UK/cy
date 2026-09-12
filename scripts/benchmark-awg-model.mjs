import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { AWG_TIMEOUT_MS, buildAwgCall } from '../runner/ambient-world-generator.js';

let config;
try {
  config = JSON.parse(await readFile(new URL('../runner/config.json', import.meta.url), 'utf8'));
} catch {
  config = JSON.parse(await readFile(new URL('../runner/config.sample.json', import.meta.url), 'utf8'));
}
const model = process.argv[2] || config.model;
const call = buildAwgCall([
  '<SHARED_CONTEXT consumer="AWG">',
  '[WORLD FACT] HMP ThinkPad is quiet. No world thread is due.',
  '</SHARED_CONTEXT>',
].join('\n'));
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(), AWG_TIMEOUT_MS);
const started = performance.now();

try {
  const response = await fetch(`${config.ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      system: call.system,
      prompt: call.prompt,
      stream: false,
      options: call.options,
    }),
    signal: abort.signal,
  });
  const body = await response.json();
  console.log(JSON.stringify({
    classification: 'ENGINEERING PERFORMANCE MEASUREMENT',
    ok: response.ok,
    status: response.status,
    model,
    latencyMs: Math.round(performance.now() - started),
    responseChars: String(body.response || '').length,
    promptEvalCount: body.prompt_eval_count ?? null,
    evalCount: body.eval_count ?? null,
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    classification: 'ENGINEERING PERFORMANCE MEASUREMENT',
    ok: false,
    model,
    latencyMs: Math.round(performance.now() - started),
    error: error && error.name || 'Error',
  }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
