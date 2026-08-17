// livesample.js - drive two real ollama generations to capture the required
// prose samples deterministically (the stochastic scheduler makes them rare in a
// short run): CY reacting to a TRIVIAL event under high amplification, and CY
// writing under the electricity-cost injection. Needs ollama up.
//
//   node runner/livesample.js

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initialVitals, computeDerived, ampOf } from './vitals.js';
import { initialRelations, castForPrompt, grudgeDirective } from './cast.js';
import { buildSystem, buildPrompt, options, amplifiedDirective } from './prompt.js';
import { costInjection } from './power.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const cfg = JSON.parse(await readFile(join(HERE, 'config.json'), 'utf8'));

async function generate(system, prompt, opts) {
  const res = await fetch(`${cfg.ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, system, prompt, options: opts, keep_alive: -1, stream: false }),
  });
  const j = await res.json();
  return (j.response || '').trim();
}

// ---- sample 1: a trivial event (cold tea) under high amp ----
{
  const v = initialVitals();
  v.relations = initialRelations();
  v.monotony = 0.95; // amp ~= 3.4
  v.mental.anger = 0.55;
  v.mental.despair = 0.6;
  v.mental.stress = 0.7;
  v.derived = computeDerived(v);
  const ctx = {
    cast: castForPrompt(v.relations),
    grudge: grudgeDirective(v.relations),
    amplified: amplifiedDirective('the tea came cold'),
  };
  const system = buildSystem(v, 'journal', ctx);
  const prompt = buildPrompt('same four walls. nothing since sunday. ', 'journal');
  const opts = options(v, cfg.threads, 'journal', { num_predict: 90 });
  console.log('==== SAMPLE 1: trivial event (cold tea) under amp x' + ampOf(v).toFixed(1) + ' ====');
  console.log(await generate(system, prompt, opts));
}

// ---- sample 2: the electricity-cost injection ----
{
  const v = initialVitals();
  v.relations = initialRelations();
  v.mental.despair = 0.7;
  v.mental.lucidity = 0.72;
  v.derived = computeDerived(v);
  // a realistic accumulated total: ~11 GBP over ~9 days
  const snap = {
    watts: 41.2,
    kwh_total: 45.9,
    cost_total: 11.25,
    cost_per_hour: 0.0101,
    uptime_s: 9 * 86400 + 4 * 3600,
  };
  const ctx = {
    cast: castForPrompt(v.relations),
    cost: costInjection(snap),
  };
  const system = buildSystem(v, 'journal', ctx);
  const prompt = buildPrompt('cant sleep. the fan again. ', 'journal');
  const opts = options(v, cfg.threads, 'journal', { num_predict: 100 });
  console.log('\n==== SAMPLE 2: cost-aware prose (11.25 GBP total, ~1p/hr) ====');
  console.log(await generate(system, prompt, opts));
}
