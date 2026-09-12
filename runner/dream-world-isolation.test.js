import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const run = await readFile(new URL('./run.js', import.meta.url), 'utf8');
const start = run.indexOf('// ---- DREAM:');
const end = run.indexOf('// ---- main generation loop ----', start);
assert.ok(start >= 0 && end > start, 'dream runtime section found');
const dreamRuntime = run.slice(start, end);

assert.doesNotMatch(dreamRuntime, /soma\.observe(?:Output)?\s*\(/,
  'dream output cannot update grounded or legacy Soma');
assert.doesNotMatch(dreamRuntime, /captureEnvironmentEvent\s*\(/,
  'dream output cannot create an environment event');
assert.doesNotMatch(dreamRuntime, /pushIncident\s*\(/,
  'dream output cannot become a prison incident or world residue');
assert.match(dreamRuntime, /sourceFromDreamExpression\s*\(/,
  'dream output may enter the existing autobiographical formation path');
assert.match(dreamRuntime, /Promise\.resolve\(autobiographicalMemory\.queueSource\(source\)\)\.catch/,
  'dream formation accepts both synchronous and asynchronous queue implementations');
assert.match(dreamRuntime, /kind:\s*'dream'/,
  'dream output is stored as an explicit subjective dream event');

console.log('dream-world-isolation.test.js: all checks passed');
