import assert from 'node:assert/strict';
import * as engine from './soma.js';
import { createSomaRuntime } from './soma-runtime.js';
import { prepareSomaGeneration } from './soma-cycle.js';
import { buildExpressiveChoiceRequest, expressiveChoiceModelCall } from './expressive-choice.js';
import { buildDirectives, buildPrompt } from './prompt.js';

const now = Date.parse('2026-10-01T12:00:00Z');
const failures = [];
const calls = [];
const runtime = createSomaRuntime(null, {
  now,
  engine: {
    ...engine,
    provisionalCognitiveDirective() {
      calls.push('directive');
      throw new Error('legacy diagnostic directive failed');
    },
    provisionalMemoryCandidate() {
      calls.push('memory');
      throw new Error('legacy diagnostic memory failed');
    },
  },
  logger: { error() {} },
  onFailure: (failure) => failures.push(failure),
});
const stateBefore = JSON.stringify(runtime.state);
const prepared = prepareSomaGeneration(runtime, { now });
assert.equal(runtime.available, true, 'unused legacy diagnostics cannot disable live Soma');
assert.deepEqual(calls, [], 'live preparation does not invoke either legacy calculation');
assert.deepEqual(failures, []);
assert.equal(JSON.stringify(runtime.state), stateBefore, 'preparation does not alter promoted Soma state');
assert.ok(prepared.groundedDirective.includes('<PRIVATE_CURRENT_FACTS>'));
assert.ok(prepared.groundedContext);
assert.deepEqual(Object.keys(prepared).sort(), ['groundedContext', 'groundedDirective']);

const zoneC = buildDirectives({ cognition: runtime.state }, 'journal', {
  groundedSoma: prepared.groundedDirective,
});
const prompt = buildPrompt('', 'journal', null, zoneC);
assert.match(prompt, /<PRIVATE_CURRENT_FACTS>/);
assert.doesNotMatch(prompt, /PROVISIONAL_RETRIEVAL_CANDIDATE|legacy diagnostic/i);
const choice = buildExpressiveChoiceRequest({
  groundedContext: prepared.groundedContext,
  groundedDirective: prepared.groundedDirective,
  provisionalMemoryCandidate: null,
  availableActions: ['journal', 'draw', 'silence'],
});
assert.equal(choice.provisionalMemoryCandidate, null);
assert.equal(choice.groundedDirective, prepared.groundedDirective);
assert.doesNotMatch(expressiveChoiceModelCall(choice).prompt,
  /PROVISIONAL_RETRIEVAL_CANDIDATE|legacy diagnostic/i);
assert.equal(runtime.available, true);

const diagnosticCalls = [];
const diagnostic = createSomaRuntime(null, {
  now,
  engine: {
    ...engine,
    provisionalCognitiveDirective() {
      diagnosticCalls.push('directive');
      return '<PROVISIONAL_RETRIEVAL_CANDIDATE />';
    },
    provisionalMemoryCandidate() {
      diagnosticCalls.push('memory');
      return { classification: 'PROVISIONAL MEMORY CANDIDATE' };
    },
  },
});
assert.equal(diagnostic.provisionalDirective(), '<PROVISIONAL_RETRIEVAL_CANDIDATE />');
assert.deepEqual(diagnostic.provisionalMemoryCandidate(),
  { classification: 'PROVISIONAL MEMORY CANDIDATE' });
assert.deepEqual(diagnosticCalls, ['directive', 'memory'],
  'legacy calculations remain available when explicitly requested');

const groundedFailures = [];
const groundedBroken = createSomaRuntime(null, {
  now,
  engine: {
    ...engine,
    groundedSomaDirective() { throw new Error('real grounded failure'); },
  },
  logger: { error() {} },
  onFailure: (failure) => groundedFailures.push(failure),
});
prepareSomaGeneration(groundedBroken, { now });
assert.equal(groundedBroken.available, false, 'real grounded failure still disables Soma');
assert.equal(groundedFailures.length, 1);
assert.equal(groundedFailures[0].operation, 'grounded Soma prompt context');
assert.match(groundedFailures[0].reason, /real grounded failure/);

console.log('soma-cycle.test.js: all checks passed');
