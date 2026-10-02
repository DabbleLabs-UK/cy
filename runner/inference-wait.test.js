import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { InferenceWaitTrace, inferenceWorkload } from './inference-wait.js';

test('pre-model stages distinguish Tempo, local queue, and arbiter wait', async () => {
  let now = 1000;
  const trace = new InferenceWaitTrace('journal', { now: () => now });
  await trace.measure('tempoIdleMs', async () => { now += 75000; });
  await trace.measure('coordinatorWaitMs', async () => { now += 1200; });
  await trace.measure('arbiterWaitMs', async () => { now += 200000; });
  now += 15;
  const result = trace.snapshot({ modelStartedAtMs: now, arbiterGrant: {
    waitMs: 199900, ownerAtRequest: { client: 'feddit', purpose: 'user_turn' },
  } });
  assert.equal(result.workload, 'CY_JOURNAL');
  assert.equal(result.total_pre_model_ms, 276215);
  assert.equal(result.tempo_idle_ms, 75000);
  assert.equal(result.coordinator_wait_ms, 1200);
  assert.equal(result.arbiter_wait_ms, 200000);
  assert.equal(result.arbiter_server_wait_ms, 199900);
  assert.equal(result.other_setup_ms, 15);
  assert.equal(result.arbiter_active_at_request, 'FEDDIT');
  assert.equal(result.arbiter_active_snapshot_status, 'OBSERVED_AT_REQUEST_NOT_WHOLE_WAIT');
  assert.equal(result.blocking_workload, null, 'the arbiter grant cannot identify past holders');
  assert.equal(result.blocking_workload_status, 'NOT_REPORTED_BY_ARBITER');
});

test('an interrupted wait is measured without claiming model startup', async () => {
  let now = 1000;
  const trace = new InferenceWaitTrace('expressive_choice', { now: () => now });
  await assert.rejects(trace.measure('arbiterWaitMs', async () => {
    now += 4000;
    throw new DOMException('aborted', 'AbortError');
  }), { name: 'AbortError' });
  const result = trace.snapshot({ status: 'cancelled_before_start' });
  assert.equal(result.model_started_at, null);
  assert.equal(result.total_pre_model_ms, 4000);
  assert.equal(result.arbiter_wait_ms, 4000);
  assert.equal(result.arbiter_server_wait_ms, null);
});

test('workload labels are content-free and purpose-specific', () => {
  assert.equal(inferenceWorkload('expressive_choice'), 'CY_CHOOSER');
  assert.equal(inferenceWorkload('memory_surfacing'), 'CY_MEMORY');
  assert.equal(inferenceWorkload('ambient_world_generation'), 'CY_AWG');
  assert.equal(inferenceWorkload('postcard'), 'CY_OTHER');
});

test('both runner transports record stage timing before model start', () => {
  const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
  assert.equal((source.match(/new InferenceWaitTrace\(/g) || []).length, 2);
  assert.equal((source.match(/waitTrace\.measure\('arbiterWaitMs'/g) || []).length, 2);
  assert.equal((source.match(/waitTrace\.measure\('coordinatorWaitMs'/g) || []).length, 2);
  assert.equal((source.match(/reportWait\('started'\)/g) || []).length, 2);
  assert.equal((source.match(/event: 'wait'/g) || []).length, 2);
  assert.match(source, /model_load_ms: Number\.isFinite/);
  assert.match(source, /appendFile\(inferenceDiagnosticPath, `\$\{line\}\\n`\)/,
    'inference wait records use the existing durable content-free diagnostic log');
});
