import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CIRCUITS } from '../public/assets/brain.js';
import { reconcileSoma, somaSnapshot, tickSoma } from './soma.js';

const here = dirname(fileURLToPath(import.meta.url));
const soma = reconcileSoma(null, { now: 1 });
tickSoma(soma, { physical: { hunger: 0.7 }, monotony: 0.2, now: 5001 });
const snapshot = somaSnapshot(soma);

assert.deepEqual(
  [...CIRCUITS.map((circuit) => circuit.key)].sort(),
  [...Object.keys(snapshot.circuits)].sort(),
  'every implemented Soma circuit has exactly one anatomical analogy',
);
for (const circuit of CIRCUITS) {
  assert.match(circuit.path, /^M\d/);
  assert.ok(circuit.label && circuit.anatomy);
  assert.ok(snapshot.circuits[circuit.key].source);
}

const source = await readFile(join(here, '..', 'public', 'assets', 'brain.js'), 'utf8');
assert.match(source, /PLACEHOLDERS - NOT SOMA/);
assert.match(source, /functional analogies, not measured physiology/);
assert.doesNotMatch(source, /createElementNS\([^\n]+ellipse/);

console.log('brain.test.js: all checks passed');
