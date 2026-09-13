import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const visitorFacingSources = [
  'config/implementation-registry.json',
  'public/api/somatic.php',
  'public/assets/brain.js',
  'public/assets/memory.js',
  'public/assets/raw.js',
  'runner/action-outcome-contingency.js',
  'runner/circadian-process-c.js',
  'runner/experienced-state.js',
  'runner/feeding-homeostasis.js',
  'runner/grounded-prose-context.js',
  'runner/run.js',
  'runner/social-contact-substrate.js',
  'runner/soma.js',
  'runner/somatic-nociceptive-substrate.js',
];

const copy = (await Promise.all(visitorFacingSources.map(async (path) =>
  `${path}\n${await readFile(join(root, path), 'utf8')}`))).join('\n');

for (const disclaimer of [
  /not a report/i,
  /not a claim/i,
  /not (?:a )?subjective/i,
  /subjective experience/i,
  /not an observed feeling/i,
  /not psychological evidence/i,
  /not authoritative world history/i,
  /biological phase not directly observed/i,
]) {
  assert.doesNotMatch(copy, disclaimer,
    `visitor-facing copy must not contain fourth-wall disclaimer ${disclaimer}`);
}

console.log('visitor-copy.test.js: all checks passed');
