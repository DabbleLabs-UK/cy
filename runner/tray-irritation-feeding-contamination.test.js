// tray-irritation-feeding-contamination.test.js - the no_eggs/cold_tea
// tray-irritation producer used the 'meal' archetype and asserted
// offered:'yes', consumed:'unknown' with no meal identity and no real
// availability/consumption fact. feeding-homeostasis.js's isFeedingRecord()
// treated ANY 'meal'-archetype event as a feeding record regardless of
// content, and separately its non-meal fallback check counted any event's
// food object as "grounded" purely because the permanently-present nested
// `nutrition` sub-object made Object.values(food).some(...) trivially true.
// Together these meant a bare narrative irritation - or literally any other
// event of any kind - could create an ambiguous UNKNOWN-outcome feeding
// ledger entry, corrupt latestResolvedMeal/lastMealOfferedAt, and flip a
// valid LIVE physiological-satiety model to INPUT_INCOMPLETE, even though
// nothing about real food availability or consumption ever changed.
//
// Fix: isFeedingRecord() now requires at least one genuinely grounded scalar
// food fact (meal identity, schedule, offered/available/received/consumed,
// intake outcome, portion, or a real nutrition macro/energy value) - archetype
// ID alone no longer qualifies, and the nested nutrition object's own
// always-present shape can never itself satisfy the check. The run.js
// no_eggs/cold_tea handler no longer asserts any food fact at all, since as
// authored it never established one.
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/tray-irritation-feeding-contamination.test.js

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  createFeedingState,
  feedingInspection,
  ingestionRecordFromEnvironment,
  observeFeedingRecord,
  reconcileFeedingState,
} from './feeding-homeostasis.js';
import {
  createPhysiologicalSatiety,
  observePhysiologicalSatietyRecord,
} from './physiological-satiety.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

const T0 = '2026-09-27 12:00:00.000';

// Exactly the shape the fixed run.js handler now produces: 'meal' archetype,
// no world.physical.food override at all - the same shape any other purely
// narrative event (a social remark, an officer aside) already has.
function trayIrritationRecord(id, kind, timestamp = T0) {
  return createEnvironmentRecord(createEnvironmentEvent('meal', {
    id, timestamp, eventType: kind,
    world: { situation: { deprivation_outcome: kind === 'no_eggs' ? 'partial' : 'unknown' } },
  }));
}

function realMealRecord(id, {
  timestamp = T0, mealId, mealType, scheduled = 'yes', offered = 'yes', available = 'yes',
  received = 'yes', consumed = 'full', intakeOutcome = 'full_consumed', portionCategory = 'full',
  portionFraction = 1,
} = {}) {
  return createEnvironmentRecord(createEnvironmentEvent('meal', {
    id, timestamp,
    world: { physical: { food: {
      meal_id: mealId, meal_type: mealType, scheduled, offered, available, received,
      consumed, intake_outcome: intakeOutcome, portion_category: portionCategory, portion_fraction: portionFraction,
    } } },
  }));
}

// ---- 1: cold-tea irritation alone does not create a new intake record ----
{
  const state = createFeedingState(Date.parse(T0));
  const record = trayIrritationRecord('cold-tea-1', 'cold_tea');
  assert.equal(ingestionRecordFromEnvironment(record), null,
    'cold_tea produces no feeding ingestion record at all');
  const result = observeFeedingRecord(state, record);
  assert.equal(result.updated, false);
  assert.equal(result.reason, 'not_a_feeding_event');
  assert.equal(state.records.length, 0, 'no ledger entry was created');
  ok('cold-tea irritation alone does not create a new intake record (1)');
}

// ---- 2: no-eggs irritation alone does not create an ambiguous duplicate meal observation ----
{
  const state = createFeedingState(Date.parse(T0));
  const genuineMeal = realMealRecord('genuine-breakfast', {
    mealId: '2026-09-27:breakfast', mealType: 'breakfast', timestamp: '2026-09-27 07:30:00.000',
  });
  observeFeedingRecord(state, genuineMeal);
  const before = JSON.stringify(state);
  for (let i = 0; i < 5; i += 1) {
    const result = observeFeedingRecord(state, trayIrritationRecord(`no-eggs-${i}`, 'no_eggs',
      `2026-09-27 12:0${i}:00.000`));
    assert.equal(result.updated, false);
    assert.equal(result.reason, 'not_a_feeding_event');
  }
  assert.equal(JSON.stringify(state), before,
    'repeated no_eggs irritation leaves the entire feeding ledger byte-for-byte unchanged');
  assert.equal(state.records.length, 1, 'no ambiguous duplicate meal observation was created');
  assert.equal(state.latestResolvedMeal.eventId, 'genuine-breakfast',
    'the genuine meal remains the latest resolved meal, never overwritten by an ambiguous irritation record');
  ok('no-eggs irritation alone does not create an ambiguous duplicate meal observation (2)');
}

// ---- 3: neither can flip a valid LIVE satiety model to INPUT_INCOMPLETE merely through repetition ----
{
  const satiety = createPhysiologicalSatiety(Date.parse(T0));
  const anchor = realMealRecord('breakfast-anchor', {
    mealId: '2026-09-27:breakfast', mealType: 'breakfast', timestamp: T0,
  });
  const anchorResult = observePhysiologicalSatietyRecord(satiety, anchor);
  assert.equal(anchorResult.status, 'LIVE', 'a genuine full breakfast establishes LIVE status');
  assert.equal(satiety.status, 'LIVE');
  for (let i = 0; i < 50; i += 1) {
    const kind = i % 2 === 0 ? 'no_eggs' : 'cold_tea';
    const result = observePhysiologicalSatietyRecord(satiety,
      trayIrritationRecord(`repeat-irritation-${i}`, kind, `2026-09-27 12:${String(i % 60).padStart(2, '0')}:00.000`));
    assert.equal(result.updated, false, `iteration ${i} is rejected before touching satiety state`);
    assert.equal(satiety.status, 'LIVE', `satiety remains LIVE after ${i + 1} repeated tray-irritation events`);
  }
  assert.equal(satiety.intakeHistory.length, 1,
    'no tray-irritation event is even recorded into intake history, since it is never a feeding event at all');
  ok('repeated tray-irritation events cannot flip a valid LIVE satiety model to INPUT_INCOMPLETE (3)');
}

// ---- 4: explicit meal offered/received/consumed facts still update normally ----
{
  const state = createFeedingState(Date.parse(T0));
  const full = realMealRecord('full-lunch', {
    mealId: '2026-09-27:lunch', mealType: 'lunch', timestamp: '2026-09-27 12:30:00.000',
  });
  const result = observeFeedingRecord(state, full);
  assert.equal(result.updated, true);
  assert.equal(result.record.intakeOutcome, 'FULLY_CONSUMED');
  assert.equal(state.lastKnownIntakeAt, '2026-09-27 12:30:00.000');
  assert.equal(state.latestResolvedMeal.eventId, 'full-lunch');

  const satiety = createPhysiologicalSatiety(Date.parse(T0));
  const breakfastAnchor = realMealRecord('breakfast-explicit', {
    mealId: '2026-09-27:breakfast', mealType: 'breakfast', timestamp: T0,
  });
  const satietyResult = observePhysiologicalSatietyRecord(satiety, breakfastAnchor);
  assert.equal(satietyResult.status, 'LIVE', 'explicit consumption evidence still establishes a LIVE satiety model');
  ok('explicit meal offered/received/consumed facts still update feeding and satiety normally (4)');
}

// ---- 5: a genuinely grounded availability change can update the existing meal correctly ----
{
  const state = createFeedingState(Date.parse(T0));
  const mealId = '2026-09-27:breakfast';
  const expected = createEnvironmentRecord(createEnvironmentEvent('meal_expected', {
    id: 'breakfast-expected', timestamp: '2026-09-27 07:00:00.000',
    world: { physical: { food: { meal_id: mealId, meal_type: 'breakfast' } } },
  }));
  const expectedResult = observeFeedingRecord(state, expected);
  assert.equal(expectedResult.record.intakeOutcome, 'MEAL_EXPECTED');

  // A genuine, explicit fact: eggs were unavailable and therefore not
  // consumed, tied to the SAME meal identity - unlike the ambiguous tray
  // irritation producer, this event actually establishes both availability
  // and consumption, not just a bare narrative complaint.
  const genuineUnavailable = createEnvironmentRecord(createEnvironmentEvent('meal', {
    id: 'breakfast-genuinely-unavailable', timestamp: '2026-09-27 07:35:00.000',
    world: { physical: { food: {
      meal_id: mealId, meal_type: 'breakfast', available: 'no', consumed: 'none', intake_outcome: 'unavailable',
    } } },
  }));
  const result = observeFeedingRecord(state, genuineUnavailable);
  assert.equal(result.updated, true);
  assert.equal(result.record.intakeOutcome, 'UNAVAILABLE');
  assert.equal(result.record.mealId, mealId);
  assert.equal(state.latestResolvedMeal.eventId, 'breakfast-genuinely-unavailable',
    'the existing meal identity is correctly updated with the genuine availability fact');
  assert.equal(state.records.length, 2, 'both the expectation and its genuine resolution are recorded');
  ok('a genuinely grounded availability change updates the existing meal identity correctly (5)');
}

// ---- 6: event-ID dedup remains intact ----
{
  const state = createFeedingState(Date.parse(T0));
  const irritation = trayIrritationRecord('dedup-irritation-1', 'cold_tea');
  observeFeedingRecord(state, irritation);
  const second = observeFeedingRecord(state, irritation);
  assert.equal(second.reason, 'not_a_feeding_event', 'a repeated tray-irritation event ID is still simply not a feeding event');
  assert.equal(state.records.length, 0);

  const meal = realMealRecord('dedup-real-meal-1', { mealId: '2026-09-27:tea', mealType: 'tea' });
  observeFeedingRecord(state, meal);
  const duplicateMeal = observeFeedingRecord(state, meal);
  assert.equal(duplicateMeal.updated, false);
  assert.equal(duplicateMeal.reason, 'duplicate_event', 'the pre-existing event-ID dedup for genuine meals is unaffected by this fix');
  assert.equal(state.records.length, 1);
  ok('event-ID deduplication remains intact for both tray-irritation events and genuine meals (6)');
}

// ---- 7: restart/replay remains stable ----
{
  const state = createFeedingState(Date.parse(T0));
  observeFeedingRecord(state, realMealRecord('restart-real-meal', { mealId: '2026-09-27:lunch', mealType: 'lunch' }));
  observeFeedingRecord(state, trayIrritationRecord('restart-irritation', 'no_eggs'));
  assert.equal(state.records.length, 1, 'the irritation event never entered the ledger before restart');

  const restored = reconcileFeedingState(JSON.parse(JSON.stringify(state)), { now: Date.parse(T0) + 60000 });
  assert.deepEqual(restored.records, state.records, 'the ledger survives a real save/reload cycle unchanged');

  const postRestartResult = observeFeedingRecord(restored, trayIrritationRecord('restart-irritation-2', 'cold_tea'));
  assert.equal(postRestartResult.reason, 'not_a_feeding_event',
    'a tray-irritation event after restart is still correctly rejected');
  assert.equal(restored.records.length, 1, 'restart/replay does not let a tray-irritation event slip through');
  ok('restart/replay behaviour remains stable (7)');
}

// ---- 8: WORLD_ONLY/OBSERVED boundaries remain unchanged ----
{
  const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(source,
    /if \(cyObserved\) \{\s*\n\s*Object\.assign\(record, observeEnvironmentRecord\(soma, record\)\);/,
    'the cyObserved -> observeEnvironmentRecord grounded-seam boundary is unchanged');
  assert.match(source,
    /if \(name === 'no_eggs' \|\| name === 'cold_tea'\) \{[\s\S]{0,400}captureEnvironmentEvent\('meal', \{/,
    'the tray-irritation producer still routes through the ordinary captureEnvironmentEvent seam, not a new bespoke path');
  assert.doesNotMatch(source, /cyObserved:\s*false[\s\S]{0,200}no_eggs/,
    'this fix never relabels the tray-irritation event as WORLD_ONLY - it simply carries no feeding fact');
  ok('AWG OBSERVED/WORLD_ONLY boundaries remain unchanged; the fix withholds a fact, it does not reclassify observation (8)');
}

// ---- 9: historical feeding provenance remains available ----
{
  const state = createFeedingState(Date.parse(T0));
  observeFeedingRecord(state, realMealRecord('provenance-breakfast', { mealId: '2026-09-27:breakfast', mealType: 'breakfast', timestamp: '2026-09-27 07:30:00.000' }));
  observeFeedingRecord(state, trayIrritationRecord('provenance-irritation', 'cold_tea', '2026-09-27 12:00:00.000'));
  observeFeedingRecord(state, realMealRecord('provenance-lunch', { mealId: '2026-09-27:lunch', mealType: 'lunch', timestamp: '2026-09-27 12:30:00.000' }));
  const inspection = feedingInspection(state);
  assert.equal(inspection.records.length, 2, 'only the two genuine meals are recorded');
  assert.deepEqual(inspection.records.map((r) => r.eventId), ['provenance-breakfast', 'provenance-lunch'],
    'genuine meal provenance (source event IDs, in order) remains fully traceable');
  assert.equal(inspection.totalFeedingRecords, 2);
  ok('historical feeding provenance for genuine meals remains fully available and untouched (9)');
}

console.log(`\ntray-irritation-feeding-contamination.test.js: all ${n} checks passed`);
