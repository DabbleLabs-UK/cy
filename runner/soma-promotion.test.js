// soma-promotion.test.js
//
// Locks the Soma #4 promotion of Harm / Nociceptive Impact: exactly four
// subsystems (Anxiety, Homeostatic Sleep Pressure, Physiological Satiety,
// Harm / Nociceptive Impact) are promoted above the legacy quarantine, in
// that order; legacy hunger and legacy Pain cannot appear in the promoted
// UI; neither satiety nor harm wording claims a subjective feeling; and
// every other legacy/provisional model stays quarantined.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { implementationEntry } from './implementation-registry.js';
import {
  createSomaticState,
  observeSomaticRecord,
  somaticSnapshot,
} from './somatic-nociceptive-substrate.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'public', 'assets', 'brain.js'), 'utf8');

// Exactly four promoted blocks, in the required order, before the quarantine.
const anxietyAt = source.indexOf('soma-anxiety-promoted');
const sleepPressureAt = source.indexOf('soma-sleep-pressure-promoted');
const satietyAt = source.indexOf('soma-satiety-promoted');
const harmAt = source.indexOf('soma-harm-promoted');
const quarantineAt = source.indexOf('soma-legacy-quarantine');
assert.ok(
  anxietyAt > 0 && sleepPressureAt > anxietyAt && satietyAt > sleepPressureAt
    && harmAt > satietyAt && quarantineAt > harmAt,
  'exactly four subsystems are promoted in order: Anxiety, Homeostatic Sleep Pressure, '
    + 'Physiological Satiety, Harm / Nociceptive Impact, then the quarantine',
);

// No fifth promoted block exists.
assert.equal((source.match(/-promoted"/g) || []).length, 4,
  'exactly four "-promoted" containers exist; no unapproved fifth promotion');

// The quarantine note names exactly the four promoted subsystems.
assert.match(source, /Only Anxiety, Homeostatic Sleep Pressure, Physiological Satiety and Harm \/ Nociceptive Impact above are currently promoted\./);

// Honest, non-subjective wording for satiety.
assert.match(source, /Physiological satiety is a model estimate of post-meal gastrointestinal and hormonal state\. It is not a measurement of whether Cy feels hungry or full\./);
assert.doesNotMatch(source, /Cy is hungry/i);
assert.doesNotMatch(source, /Cy is full\b/i);
assert.doesNotMatch(source, /SUBJECTIVE HUNGER/);
assert.doesNotMatch(source, /HUNGER HISTORY/);
assert.doesNotMatch(source, /data-metric="hunger"/,
  'the legacy hunger scalar must never become a rendered Soma row');

// Honest, non-subjective wording for harm. It must distinguish objective
// injury/nociceptive tracking from felt pain, and never claim a severity or
// distress score.
assert.match(source, /Harm tracks structured bodily injury and nociceptive state\. It does not measure how much pain Cy feels\./);
assert.doesNotMatch(source, /HARM \/ NOCICEPTIVE IMPACT[\s\S]{0,400}Cy feels pain/i);
assert.doesNotMatch(source, /BODILY DISTRESS/i);
assert.doesNotMatch(source, /PAIN SCORE/i);
assert.doesNotMatch(source, /HEALING (?:COUNTDOWN|TIMER|ETA)/i);
assert.match(source, /SUBJECTIVE PAIN<\/span><strong>\$\{painStatus\.publicLabel\}/,
  'subjective pain must be an explicit NOT MODELLED label, never a computed value');
assert.match(source, /INJURY SEVERITY<\/span><strong>NOT MODELLED \/ UNKNOWN/,
  'injury severity must be explicit NOT MODELLED, never invented from injury count/type');

// The satiety and harm readouts are routed to their own promoted containers,
// not the quarantined public readout, mirroring how Anxiety is already routed.
assert.match(source,
  /const target = definition\.key === 'anxiety' \? anxietyReadout\s*\n\s*: definition\.key === 'satiety' \? satietyReadout\s*\n\s*: definition\.key === 'somaticHarm' \? harmReadout/);

// Registry: satiety and the somatic harm ledger stay IMPLEMENTED; legacy
// hunger and legacy Pain stay quarantined and never leak into the promoted UI.
const satietyEntry = implementationEntry('soma_variables', 'satiety');
assert.equal(satietyEntry.implementation_status, 'IMPLEMENTED');
const legacyHunger = implementationEntry('soma_subsystems', 'legacy_hunger_metric');
assert.ok(legacyHunger, 'the legacy hunger scalar remains documented as a quarantined diagnostic');
assert.equal(legacyHunger.lifecycle_status, 'DIAGNOSTICS_ONLY');
assert.equal(legacyHunger.data_flow_status, 'ISOLATED');

const somaticHeadlineEntry = implementationEntry('soma_variables', 'somatic_harm_headline');
assert.equal(somaticHeadlineEntry.implementation_status, 'IMPLEMENTED');
const injuryLedgerEntry = implementationEntry('soma_subsystems', 'injury_ledger');
assert.equal(injuryLedgerEntry.implementation_status, 'IMPLEMENTED');
const subjectivePainEntry = implementationEntry('soma_subsystems', 'subjective_pain');
assert.equal(subjectivePainEntry.implementation_status, 'NOT_IMPLEMENTED',
  'subjective pain must remain explicitly not modelled, never quietly promoted');
const injurySeverityEntry = implementationEntry('soma_subsystems', 'injury_severity_model');
assert.equal(injurySeverityEntry.implementation_status, 'NOT_IMPLEMENTED',
  'injury severity must remain explicitly not modelled, never invented from count/type');
const legacyPainEntry = implementationEntry('soma_variables', 'pain');
assert.ok(legacyPainEntry, 'the legacy Pain scalar remains documented as a quarantined diagnostic');
assert.equal(legacyPainEntry.lifecycle_status, 'DIAGNOSTICS_ONLY');
assert.equal(legacyPainEntry.ui_exposed, false, 'legacy Pain must never become a rendered Soma row');

// Every other legacy/provisional model remains inside the quarantine markup,
// not promoted alongside Anxiety / Sleep Pressure / Satiety / Harm.
const promotedBlock = source.slice(anxietyAt, quarantineAt);
for (const stillQuarantined of [
  'circadian-process-card', 'predicted-sleepiness-card', 'threat-learning-card',
  'legacy-heart', 'legacy-mental', 'legacy-brain', 'data-metric="pain"', 'data-metric="anger"', 'data-metric="arousal"',
]) {
  assert.ok(!promotedBlock.includes(stillQuarantined),
    `${stillQuarantined} must remain inside the quarantine, not the promoted block`);
}
assert.ok(source.slice(quarantineAt).includes('circadian-process-card'), 'Circadian Process C markup still exists, inside the quarantine');
assert.ok(source.slice(quarantineAt).includes('predicted-sleepiness-card'), 'Predicted sleepiness (KSS) markup still exists, inside the quarantine');

// --- Functional checks on the real structured harm ledger that now backs the
// promoted display: CLEAR with no injury, multiple distinct active injuries,
// and explicit resolution removing only the correct injury. ---

function somaticRecord(id, timestamp, somatic, archetypeId = 'somatic_event') {
  return createEnvironmentRecord(createEnvironmentEvent(archetypeId, {
    id, timestamp, world: { somatic },
  }));
}

function injuryFacts(injuryId, overrides = {}) {
  return {
    stimulus: { id: `stimulus:${injuryId}`, modality: 'MECHANICAL', status: 'POINT', noxious_stimulus: 'YES' },
    body: { site: 'left_forearm', laterality: 'LEFT', certainty: 'CERTAIN' },
    tissue: { damage_status: 'CONFIRMED', injury_id: injuryId, injury_type: 'ABRASION', injury_status: 'ACTIVE' },
    knowledge_status: 'PARTIAL',
    field_provenance: { tissue_damage: 'STRUCTURED_WORLD_FACT' },
    ...overrides,
  };
}

const t0 = Date.parse('2026-09-28 12:00:00.000');
const promotionState = createSomaticState(t0);

// No injury -> CLEAR, no fabricated count or severity.
const clearHeadline = somaticSnapshot(promotionState).headline;
assert.equal(clearHeadline.category, 'CLEAR');
assert.equal(clearHeadline.display, 'NO ACTIVE INJURY');
assert.equal(clearHeadline.activeInjuryCount, 0);

// Two distinct injuries from separate structured events remain separately
// tracked, not merged or summed into one score.
observeSomaticRecord(promotionState, somaticRecord('inj-a-origin', '2026-09-28 12:00:00.000', injuryFacts('injury:a')));
observeSomaticRecord(promotionState, somaticRecord('inj-b-origin', '2026-09-28 12:05:00.000',
  injuryFacts('injury:b', { body: { site: 'right_shin', laterality: 'RIGHT', certainty: 'CERTAIN' } })));
const twoInjuryHeadline = somaticSnapshot(promotionState).headline;
assert.equal(twoInjuryHeadline.category, 'ACTIVE_INJURY');
assert.equal(twoInjuryHeadline.activeInjuryCount, 2);
assert.equal(twoInjuryHeadline.display, '2 ACTIVE INJURIES');
assert.deepEqual(
  Object.values(promotionState.injuries).map((injury) => injury.bodySite).sort(),
  ['left_forearm', 'right_shin'],
  'each injury keeps its own real body site, not a merged/averaged state',
);

// Explicit resolution of one injury removes only that injury; the other
// remains active. No time-based auto-healing exists.
observeSomaticRecord(promotionState, somaticRecord('inj-a-resolved', '2026-09-28 13:00:00.000', {
  stimulus: { id: 'stimulus:injury:a', modality: 'MECHANICAL', status: 'ENDED', noxious_stimulus: 'NO' },
  body: { site: 'left_forearm', laterality: 'LEFT', certainty: 'CERTAIN' },
  tissue: { damage_status: 'CONFIRMED', injury_id: 'injury:a', injury_type: 'ABRASION', injury_status: 'RESOLVED' },
  knowledge_status: 'PARTIAL',
  field_provenance: { tissue_damage: 'STRUCTURED_WORLD_FACT' },
}));
const afterResolutionHeadline = somaticSnapshot(promotionState).headline;
assert.equal(afterResolutionHeadline.activeInjuryCount, 1, 'resolving one injury must not clear or affect the other');
assert.equal(promotionState.injuries['injury:a'].status, 'RESOLVED');
assert.equal(promotionState.injuries['injury:b'].status, 'ACTIVE', 'the unresolved injury must remain active');

console.log('soma-promotion.test.js: all checks passed');
