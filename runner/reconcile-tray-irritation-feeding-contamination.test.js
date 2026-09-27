import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadVitals, saveVitals } from './vitals.js';
import { createFeedingState, observeFeedingRecord } from './feeding-homeostasis.js';
import { createPhysiologicalSatiety, observePhysiologicalSatietyRecord } from './physiological-satiety.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  classifyFeeding,
  classifySatiety,
  isContaminatedFeedingRecord,
  isContaminatedIntakeHistoryEntry,
  retireFeedingContamination,
  retireSatietyContamination,
} from './reconcile-tray-irritation-feeding-contamination.mjs';

const T0 = '2026-09-27 07:00:00.000';

// Both now-fixed classification defects are reproduced directly here as raw
// ledger/history entries, matching exactly what the OLD buggy
// isFeedingRecord() would have derived and stored - NOT by calling today's
// (now-fixed) observeFeedingRecord/observePhysiologicalSatietyRecord, which
// correctly reject this input and so can no longer be used to manufacture
// the contaminated fixtures this reconciliation tool exists to clean up.
function contaminatedFeedingRecord(eventId, timestamp) {
  return {
    schema: 'cy.ingestion-record', version: 1, eventId, timestamp,
    mealId: null, mealType: null, scheduledStatus: 'UNKNOWN', offeredStatus: 'UNKNOWN',
    availabilityStatus: 'UNKNOWN', receivedStatus: 'UNKNOWN', consumptionStatus: 'UNKNOWN',
    intakeOutcome: 'UNKNOWN', portionCategory: 'UNKNOWN', portionFraction: null, portionBasis: 'UNKNOWN',
    durationMs: null, nutritionalComposition: 'BOUNDED_UNCERTAIN', fullMealEnergyKcal: null,
    consumedEnergyKcal: null, consumedFraction: null, fullMealMacros: null, nutritionBasis: 'UNKNOWN',
    physiologicalImpact: 'MODELLED_SEPARATELY', sourceEnvironmentEventIds: [eventId], fieldProvenance: {},
  };
}

function contaminatedIntakeHistoryEntry(eventId, timestamp) {
  return {
    eventId, timestamp, mealType: null, intakeOutcome: 'UNKNOWN',
    consumedEnergyKcal: null, portionBasis: 'UNKNOWN', nutritionBasis: 'UNKNOWN',
  };
}

function realMealRecord(id, { timestamp = T0, mealId, mealType, intakeOutcome = 'full_consumed', consumed = 'full' } = {}) {
  return createEnvironmentRecord(createEnvironmentEvent('meal', {
    id, timestamp,
    world: { physical: { food: {
      meal_id: mealId, meal_type: mealType, scheduled: 'yes', offered: 'yes', available: 'yes', received: 'yes',
      consumed, intake_outcome: intakeOutcome, portion_category: consumed === 'full' ? 'full' : 'none',
      portion_fraction: consumed === 'full' ? 1 : 0,
    } } },
  }));
}

function buildContaminatedLedger() {
  const feeding = createFeedingState(Date.parse(T0));
  observeFeedingRecord(feeding, realMealRecord('genuine-breakfast', { mealId: '2026-09-27:breakfast', mealType: 'breakfast', timestamp: T0 }));
  for (let i = 0; i < 3; i += 1) {
    feeding.records.push(contaminatedFeedingRecord(`irritation-${i}`, `2026-09-27 12:0${i}:00.000`));
  }
  for (let i = 0; i < 2; i += 1) {
    feeding.records.push(contaminatedFeedingRecord(`unrelated-${i}`, `2026-09-27 13:0${i}:00.000`));
  }
  observeFeedingRecord(feeding, realMealRecord('genuine-lunch', { mealId: '2026-09-27:lunch', mealType: 'lunch', timestamp: '2026-09-27 12:30:00.000' }));
  // The old buggy code overwrote these with whichever contaminated entry it
  // last processed, exactly as reproduced here.
  feeding.latestResolvedMeal = contaminatedFeedingRecord('unrelated-1', '2026-09-27 13:01:00.000');
  return feeding;
}

test('isContaminatedFeedingRecord fingerprints exactly the two removed producers\' output, never a genuine meal', () => {
  const feeding = buildContaminatedLedger();
  const genuine = feeding.records.filter((r) => r.eventId.startsWith('genuine-'));
  const contaminated = feeding.records.filter((r) => !r.eventId.startsWith('genuine-'));
  assert.equal(genuine.length, 2);
  assert.equal(contaminated.length, 5);
  assert.ok(genuine.every((r) => !isContaminatedFeedingRecord(r)));
  assert.ok(contaminated.every(isContaminatedFeedingRecord));
});

test('classifyFeeding retires only contaminated entries and correctly recomputes latestResolvedMeal/lastMealOfferedAt', () => {
  const feeding = buildContaminatedLedger();
  // A contaminated entry landed after the genuine lunch, so it currently
  // (wrongly) holds latestResolvedMeal/lastMealOfferedAt.
  assert.notEqual(feeding.latestResolvedMeal.eventId, 'genuine-lunch');
  const plan = classifyFeeding(feeding);
  assert.equal(plan.retire.length, 5);
  assert.ok(plan.retire.every((id) => !id.startsWith('genuine-')));
  assert.equal(plan.keptGenuineCount, 2);
  assert.equal(plan.recomputedLatestResolvedMeal.eventId, 'genuine-lunch');
  assert.equal(plan.recomputedLastMealOfferedAt, '2026-09-27 12:30:00.000');
});

test('retireFeedingContamination removes only classified entries and repairs latestResolvedMeal/lastMealOfferedAt', () => {
  const feeding = buildContaminatedLedger();
  const lastKnownIntakeAtBefore = feeding.lastKnownIntakeAt;
  const lastKnownIntakeEventIdBefore = feeding.lastKnownIntakeEventId;
  const plan = retireFeedingContamination({ cognition: { feeding } });
  assert.equal(plan.retire.length, 5);
  assert.equal(feeding.records.length, 2);
  assert.deepEqual(feeding.records.map((r) => r.eventId), ['genuine-breakfast', 'genuine-lunch']);
  assert.equal(feeding.latestResolvedMeal.eventId, 'genuine-lunch');
  assert.equal(feeding.lastMealOfferedAt, '2026-09-27 12:30:00.000');
  // Fields structurally immune to this contamination are untouched.
  assert.equal(feeding.lastKnownIntakeAt, lastKnownIntakeAtBefore);
  assert.equal(feeding.lastKnownIntakeEventId, lastKnownIntakeEventIdBefore);
});

test('reconciliation is idempotent: a second pass finds nothing left to retire', () => {
  const feeding = buildContaminatedLedger();
  const first = retireFeedingContamination({ cognition: { feeding } });
  assert.equal(first.retire.length, 5);
  const second = classifyFeeding(feeding);
  assert.equal(second.retire.length, 0);
});

function buildContaminatedSatiety() {
  const satiety = createPhysiologicalSatiety(Date.parse(T0));
  observePhysiologicalSatietyRecord(satiety, realMealRecord('breakfast-anchor', { mealId: '2026-09-27:breakfast', mealType: 'breakfast', timestamp: T0 }));
  assert.equal(satiety.status, 'LIVE');
  for (let i = 0; i < 4; i += 1) {
    satiety.intakeHistory.push(contaminatedIntakeHistoryEntry(`sat-unrelated-${i}`, `2026-09-27 12:0${i}:00.000`));
  }
  // The old buggy code flipped status exactly this way on the last such entry.
  satiety.status = 'INPUT_INCOMPLETE';
  satiety.statusReason = 'UNKNOWN_INTAKE';
  satiety.inputUncertainty = [...new Set([...(satiety.inputUncertainty || []), 'unknown intake'])];
  return satiety;
}

test('isContaminatedIntakeHistoryEntry fingerprints exactly the contamination signature', () => {
  const satiety = buildContaminatedSatiety();
  const genuine = satiety.intakeHistory.filter((e) => e.eventId === 'breakfast-anchor');
  const contaminated = satiety.intakeHistory.filter((e) => e.eventId !== 'breakfast-anchor');
  assert.equal(genuine.length, 1);
  assert.equal(contaminated.length, 4);
  assert.ok(!isContaminatedIntakeHistoryEntry(genuine[0]));
  assert.ok(contaminated.every(isContaminatedIntakeHistoryEntry));
});

test('classifySatiety allows reverting to LIVE only when every unresolved entry is contamination', () => {
  const satiety = buildContaminatedSatiety();
  const plan = classifySatiety(satiety);
  assert.equal(plan.retireEntryIds.length, 4);
  assert.equal(plan.canRevertStatus, true);

  // A genuinely ambiguous real event (e.g. a real meal with unknown outcome)
  // must block the automatic revert - this is not contamination, it is
  // legitimately unresolved, and reverting would be a guess.
  const genuinelyAmbiguous = createPhysiologicalSatiety(Date.parse(T0));
  observePhysiologicalSatietyRecord(genuinelyAmbiguous, realMealRecord('anchor-2', { mealId: '2026-09-27:breakfast', mealType: 'breakfast', timestamp: T0 }));
  observePhysiologicalSatietyRecord(genuinelyAmbiguous, createEnvironmentRecord(createEnvironmentEvent('meal', {
    id: 'genuinely-ambiguous-lunch', timestamp: '2026-09-27 12:30:00.000',
    world: { physical: { food: { meal_id: '2026-09-27:lunch', meal_type: 'lunch', offered: 'yes' } } },
  })));
  assert.equal(genuinelyAmbiguous.status, 'INPUT_INCOMPLETE');
  const ambiguousPlan = classifySatiety(genuinelyAmbiguous);
  assert.equal(ambiguousPlan.canRevertStatus, false,
    'a genuinely ambiguous real meal (offered, but consumption never established) must never be silently reverted');
});

test('a satiety status degraded by runner downtime (a different, legitimate reason) is never touched', () => {
  const satiety = createPhysiologicalSatiety(Date.parse(T0));
  observePhysiologicalSatietyRecord(satiety, realMealRecord('anchor-3', { mealId: '2026-09-27:breakfast', mealType: 'breakfast', timestamp: T0 }));
  satiety.status = 'INPUT_INCOMPLETE';
  satiety.statusReason = 'RUNNER_DOWNTIME_WITH_UNKNOWN_INTAKE';
  const plan = classifySatiety(satiety);
  assert.equal(plan.canRevertStatus, false);
  assert.match(plan.reason, /not INPUT_INCOMPLETE from a tray-irritation-class reason/);
});

test('retireSatietyContamination removes contamination entries and reverts status only when safe, preserving tracks/latestKnownIntake', () => {
  const satiety = buildContaminatedSatiety();
  const tracksBefore = JSON.stringify(satiety.tracks);
  const latestKnownIntakeBefore = JSON.stringify(satiety.latestKnownIntake);
  const plan = retireSatietyContamination({ cognition: { physiologicalSatiety: satiety } });
  assert.equal(plan.canRevertStatus, true);
  assert.equal(satiety.intakeHistory.length, 1);
  assert.equal(satiety.status, 'LIVE');
  assert.equal(satiety.statusReason, 'CLEAN_BREAKFAST_ANCHOR_ESTABLISHED');
  assert.ok(!satiety.inputUncertainty.includes('unknown intake'));
  assert.equal(JSON.stringify(satiety.tracks), tracksBefore, 'model tracks are never touched by this reconciliation');
  assert.equal(JSON.stringify(satiety.latestKnownIntake), latestKnownIntakeBefore);
});

test('reconciliation survives the real save/load path for both substrates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cy-tray-irritation-'));
  const path = join(dir, 'vitals.json');
  try {
    const feeding = buildContaminatedLedger();
    const satiety = buildContaminatedSatiety();
    let vitals = await loadVitals(path);
    vitals.cognition = { feeding, physiologicalSatiety: satiety };
    await saveVitals(path, vitals);

    vitals = await loadVitals(path);
    retireFeedingContamination(vitals);
    retireSatietyContamination(vitals);
    await saveVitals(path, vitals);

    vitals = await loadVitals(path);
    assert.equal(vitals.cognition.feeding.records.length, 2);
    assert.equal(vitals.cognition.physiologicalSatiety.status, 'LIVE');

    const rerunFeeding = classifyFeeding(vitals.cognition.feeding);
    const rerunSatiety = classifySatiety(vitals.cognition.physiologicalSatiety);
    assert.equal(rerunFeeding.retire.length, 0, 'a second reconcile pass after restart is a clean no-op');
    assert.equal(rerunSatiety.retireEntryIds.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
