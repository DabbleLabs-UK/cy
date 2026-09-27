import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadVitals, saveVitals } from './vitals.js';
import { createSomaticState, observeSomaticRecord } from './somatic-nociceptive-substrate.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  classifyInjuries,
  isUnsupportedGenericInjury,
  retireGenericInjuries,
} from './reconcile-generic-injuries.mjs';

function genericInjuryRecord(id, timestamp) {
  // Exactly what the removed producer emitted: the bare 'minor_injury'
  // archetype, no overrides at all.
  return createEnvironmentRecord(createEnvironmentEvent('minor_injury', { id, timestamp }));
}

function groundedInjuryRecord(id, timestamp) {
  return createEnvironmentRecord(createEnvironmentEvent('minor_injury', {
    id, timestamp,
    world: {
      somatic: {
        stimulus: { id: `stimulus:${id}`, modality: 'MECHANICAL', status: 'POINT', noxious_stimulus: 'YES' },
        body: { site: 'left_shin', laterality: 'LEFT', certainty: 'CERTAIN' },
        tissue: { damage_status: 'CONFIRMED', injury_type: 'BRUISE', injury_status: 'ACTIVE' },
        knowledge_status: 'PARTIAL',
        field_provenance: { tissue_damage: 'STRUCTURED_WORLD_FACT', injury_type: 'STRUCTURED_WORLD_FACT', body_site: 'STRUCTURED_WORLD_FACT' },
      },
    },
  }));
}

function buildLedger() {
  const state = createSomaticState(Date.parse('2026-09-11T12:00:00.000Z'));
  // 3 unsupported generic-producer artifacts, exactly matching production.
  for (let i = 0; i < 3; i++) {
    observeSomaticRecord(state, genericInjuryRecord(`generic-${i}`, '2026-09-11T12:00:00.000Z'));
  }
  // 1 genuinely grounded injury that must never be touched.
  observeSomaticRecord(state, groundedInjuryRecord('grounded-1', '2026-09-12T12:00:00.000Z'));
  // 1 genuinely grounded injury that has since been explicitly resolved.
  const resolvedGrounded = groundedInjuryRecord('grounded-2', '2026-09-13T12:00:00.000Z');
  observeSomaticRecord(state, resolvedGrounded);
  const resolvedId = resolvedGrounded.world_event.world.somatic.tissue.injury_id;
  observeSomaticRecord(state, createEnvironmentRecord(createEnvironmentEvent('minor_injury', {
    id: 'grounded-2-resolution', timestamp: '2026-09-14T12:00:00.000Z',
    world: { somatic: {
      tissue: { damage_status: 'UNKNOWN', injury_id: resolvedId, injury_type: 'BRUISE', injury_status: 'RESOLVED', resolved_at: '2026-09-14T12:00:00.000Z' },
      body: { site: 'left_shin', laterality: 'LEFT', certainty: 'CERTAIN' },
      knowledge_status: 'PARTIAL',
      field_provenance: { injury_resolution: 'STRUCTURED_WORLD_FACT' },
    } },
  })));
  return { state, resolvedId };
}

test('isUnsupportedGenericInjury fingerprints exactly the removed producer\'s output', () => {
  const { state } = buildLedger();
  const injuries = Object.values(state.injuries);
  const generic = injuries.filter((i) => i.originEventId.startsWith('generic-'));
  const grounded = injuries.filter((i) => !i.originEventId.startsWith('generic-'));
  assert.equal(generic.length, 3);
  assert.ok(generic.every(isUnsupportedGenericInjury));
  assert.ok(grounded.every((i) => !isUnsupportedGenericInjury(i)));
});

test('classification retires only the unsupported generic artifacts, never anything grounded', () => {
  const { state, resolvedId } = buildLedger();
  const plan = classifyInjuries(state);
  assert.equal(plan.retire.length, 3);
  assert.ok(plan.retire.every((id) => id.startsWith('injury:generic-')));
  const keptIds = plan.keep.map((k) => k.id);
  assert.ok(keptIds.some((id) => id.endsWith('grounded-1')), 'the active grounded injury is kept');
  assert.ok(keptIds.includes(resolvedId), 'the already-resolved grounded injury is kept (untouched, not re-processed)');
});

test('retiring removes only the classified entries from the CURRENT ledger; history and stimuli are untouched', () => {
  const { state } = buildLedger();
  const historyBefore = JSON.stringify(state.history);
  const stimuliBefore = JSON.stringify(state.stimuli);
  const vitals = { cognition: { somaticNociceptive: state } };
  const plan = retireGenericInjuries(vitals);
  assert.equal(plan.retire.length, 3);
  const after = vitals.cognition.somaticNociceptive;
  assert.equal(Object.keys(after.injuries).length, 2, 'only the two grounded injuries remain in the current ledger');
  assert.ok(Object.values(after.injuries).every((i) => !isUnsupportedGenericInjury(i)));
  assert.equal(JSON.stringify(after.history), historyBefore, 'historical provenance is byte-identical after reconciliation');
  assert.equal(JSON.stringify(after.stimuli), stimuliBefore);
  // The retired injuries' own environment events are still findable in history.
  for (let i = 0; i < 3; i++) {
    assert.ok(after.history.some((event) => event.eventId === `generic-${i}`),
      `the historical source event for generic-${i} survives even though its ledger entry was retired`);
  }
});

test('reconciliation is idempotent: a second pass finds nothing left to retire', () => {
  const { state } = buildLedger();
  const vitals = { cognition: { somaticNociceptive: state } };
  const first = retireGenericInjuries(vitals);
  assert.equal(first.retire.length, 3);
  const second = classifyInjuries(vitals.cognition.somaticNociceptive);
  assert.equal(second.retire.length, 0, 'nothing left to retire once already reconciled');
});

test('reconciliation survives the real save/load path and preserves provenance across a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cy-generic-injury-'));
  const path = join(dir, 'vitals.json');
  try {
    const { state } = buildLedger();
    let vitals = await loadVitals(path);
    vitals.cognition = { somaticNociceptive: state };
    await saveVitals(path, vitals);

    vitals = await loadVitals(path);
    const before = vitals.cognition.somaticNociceptive;
    assert.equal(Object.keys(before.injuries).length, 5);
    const historyLength = before.history.length;

    retireGenericInjuries(vitals);
    await saveVitals(path, vitals);

    vitals = await loadVitals(path);
    const after = vitals.cognition.somaticNociceptive;
    assert.equal(Object.keys(after.injuries).length, 2);
    assert.equal(after.history.length, historyLength, 'history length unchanged across a real save/reload cycle');

    // A second reconcile pass after "restart" is a clean no-op.
    const rerun = retireGenericInjuries(vitals);
    assert.equal(rerun.retire.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
