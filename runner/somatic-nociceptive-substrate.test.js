import assert from 'node:assert/strict';
import {
  createSomaticState,
  observeSomaticRecord,
  physicalHarmOutcomeFromSomaticFacts,
  reconcileSomaticState,
  somaticInspection,
  somaticSnapshot,
} from './somatic-nociceptive-substrate.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { implementationEntry } from './implementation-registry.js';

const T0 = '2026-09-11 12:00:00.000';
const T1 = '2026-09-11 12:05:00.000';

function record(id, timestamp, somatic, archetypeId = 'somatic_event') {
  return createEnvironmentRecord(createEnvironmentEvent(archetypeId, {
    id,
    timestamp,
    world: { somatic },
  }));
}

function injuryFacts(injuryId, overrides = {}) {
  return {
    stimulus: {
      id: `stimulus:${injuryId}`,
      modality: 'MECHANICAL',
      status: 'POINT',
      noxious_stimulus: 'YES',
    },
    body: { site: 'left_forearm', laterality: 'LEFT', certainty: 'CERTAIN' },
    tissue: {
      damage_status: 'CONFIRMED',
      injury_id: injuryId,
      injury_type: 'ABRASION',
      injury_status: 'ACTIVE',
    },
    knowledge_status: 'PARTIAL',
    field_provenance: { tissue_damage: 'STRUCTURED_WORLD_FACT' },
    ...overrides,
  };
}

const state = createSomaticState(Date.parse(T0));
const ordinary = createEnvironmentRecord(createEnvironmentEvent('meal', {
  id: 'ordinary-meal', timestamp: T0,
}));
assert.equal(observeSomaticRecord(state, ordinary).updated, false);
assert.equal(Object.keys(state.injuries).length, 0, 'A: no harm creates no injury');

const exposure = record('hot-surface', T0, {
  stimulus: {
    id: 'stimulus:hot-surface', modality: 'THERMAL', status: 'ENDED',
    noxious_stimulus: 'YES', onset_at: T0, offset_at: T1,
  },
  body: { site: 'right_hand', laterality: 'RIGHT', certainty: 'CERTAIN' },
  tissue: { damage_status: 'NONE', injury_status: 'UNKNOWN' },
  knowledge_status: 'PARTIAL',
  field_provenance: { stimulus: 'STRUCTURED_WORLD_FACT', tissue_damage: 'STRUCTURED_WORLD_FACT' },
});
observeSomaticRecord(state, exposure);
assert.equal(Object.keys(state.injuries).length, 0, 'B: a noxious exposure without damage creates no injury');
assert.equal(state.history.at(-1).stimulus.modality, 'THERMAL');

const firstInjury = record('injury-a-origin', T0, injuryFacts('injury:a'));
const created = observeSomaticRecord(state, firstInjury);
assert.equal(created.injuryUpdate.reason, 'injury_created');
assert.equal(state.injuries['injury:a'].status, 'ACTIVE', 'C: confirmed injury creates an active record');

const unknownSite = record('injury-unknown-site', T0, injuryFacts('injury:unknown', {
  body: { site: 'UNKNOWN', laterality: 'UNKNOWN', certainty: 'UNKNOWN' },
}));
observeSomaticRecord(state, unknownSite);
assert.equal(state.injuries['injury:unknown'].bodySite, 'UNKNOWN', 'D: unknown site remains unknown');
assert.notEqual(state.injuries['injury:unknown'].bodySite, 'NONE');

const sustained = record('injury-with-active-stimulus', T0, injuryFacts('injury:sustained', {
  stimulus: {
    id: 'stimulus:sustained', modality: 'MECHANICAL', status: 'ACTIVE',
    noxious_stimulus: 'YES', onset_at: T0,
  },
}));
observeSomaticRecord(state, sustained);
const ended = record('stimulus-ended', T1, {
  stimulus: {
    id: 'stimulus:sustained', modality: 'MECHANICAL', status: 'ENDED',
    noxious_stimulus: 'YES', onset_at: T0, offset_at: T1,
  },
  body: { site: 'left_forearm', laterality: 'LEFT', certainty: 'CERTAIN' },
  tissue: { damage_status: 'UNKNOWN', injury_status: 'UNKNOWN' },
  knowledge_status: 'PARTIAL',
  field_provenance: { stimulus_offset: 'STRUCTURED_WORLD_FACT' },
});
observeSomaticRecord(state, ended);
assert.equal(state.stimuli['stimulus:sustained'].status, 'ENDED');
assert.equal(state.injuries['injury:sustained'].status, 'ACTIVE', 'E: stimulus end does not resolve injury');

const resolution = record('injury-a-resolution', T1, {
  tissue: {
    damage_status: 'UNKNOWN', injury_id: 'injury:a', injury_type: 'ABRASION',
    injury_status: 'RESOLVED', resolved_at: T1,
  },
  body: { site: 'left_forearm', laterality: 'LEFT', certainty: 'CERTAIN' },
  knowledge_status: 'PARTIAL',
  field_provenance: { injury_resolution: 'STRUCTURED_WORLD_FACT' },
});
observeSomaticRecord(state, resolution);
assert.equal(state.injuries['injury:a'].status, 'RESOLVED', 'F: explicit resolution closes the named injury');
assert.equal(state.injuries['injury:unknown'].status, 'ACTIVE');

const muchLater = reconcileSomaticState(JSON.parse(JSON.stringify(state)), {
  now: Date.parse('2027-09-11 12:00:00.000'),
});
assert.equal(muchLater.injuries['injury:sustained'].status, 'ACTIVE', 'G: elapsed time does not imply healing');

const generatedMinor = createEnvironmentEvent('minor_injury', {
  id: 'generated-minor', timestamp: T0,
});
assert.deepEqual(generatedMinor.world.associative_learning.outcomes,
  [{ outcome_class: 'PHYSICAL_HARM', status: 'occurred' }]);
assert.equal(generatedMinor.world.somatic.body.site, 'UNKNOWN');
assert.equal(generatedMinor.world.somatic.tissue.injury_id, 'injury:generated-minor');
assert.equal('severity' in generatedMinor.world.somatic.tissue, false,
  'H: explicit injury supplies PHYSICAL_HARM without inventing severity');
assert.equal(physicalHarmOutcomeFromSomaticFacts(generatedMinor.world.somatic), 'occurred');

const legacy = reconcileSomaticState({
  pain: 100,
  metrics: { pain: { value: 100 } },
  impulses: [{ metric: 'pain', amount: 38 }],
}, { now: Date.parse(T0) });
assert.equal(legacy.history.length, 0);
assert.equal(Object.keys(legacy.injuries).length, 0, 'I: legacy Pain cannot initialise the grounded ledger');

const beforeProse = JSON.stringify(state);
assert.equal(observeSomaticRecord(state, { generated_text: 'my arm hurts badly' }).updated, false);
assert.equal(JSON.stringify(state), beforeProse, 'J: generated prose cannot create somatic facts');

const restarted = reconcileSomaticState(JSON.parse(JSON.stringify(state)), { now: Date.parse(T1) });
assert.deepEqual(restarted.injuries, state.injuries, 'K: injury identities and follow-ups survive restart');
assert.deepEqual(restarted.history, state.history);

assert.notEqual(state.injuries['injury:unknown'].id, state.injuries['injury:sustained'].id);
assert.equal(state.injuries['injury:unknown'].originEventId, 'injury-unknown-site');
assert.equal(state.injuries['injury:sustained'].originEventId, 'injury-with-active-stimulus',
  'L: multiple injuries remain independently traceable');

assert.equal(implementationEntry('soma_variables', 'pain').implementation_status, 'PROVISIONAL');
assert.equal(implementationEntry('soma_subsystems', 'subjective_pain').implementation_status, 'NOT_IMPLEMENTED',
  'M: subjective Pain is not LIVE');

const snapshot = somaticSnapshot(state);
assert.equal(snapshot.brainActivationMapping, 'NOT_MODELLED');
assert.equal('brain' in state, false, 'N: somatic events create no brain activation');
assert.equal('pain' in snapshot, false);

const repeated = createSomaticState(Date.parse(T0));
observeSomaticRecord(repeated, record('repeat-one', T0, injuryFacts('injury:repeat-one')));
observeSomaticRecord(repeated, record('repeat-two', T1, injuryFacts('injury:repeat-two')));
const repeatedInspection = somaticInspection(repeated);
assert.equal(repeatedInspection.peripheralSensitisation, 'NOT_MODELLED');
assert.equal(repeatedInspection.centralSensitisation, 'NOT_MODELLED');
assert.equal(repeatedInspection.events.some((event) => 'magnitude' in event), false,
  'O: repeated injuries do not create sensitisation or escalating magnitudes');

console.log('somatic-nociceptive-substrate.test.js: all checks passed');
