// reconcile-tray-irritation-feeding-contamination.mjs
//
// One-shot, idempotent retirement of feeding-homeostasis ledger entries and
// physiological-satiety intake-history entries created by two now-fixed
// classification defects in feeding-homeostasis.js's isFeedingRecord():
//
//   1. Any event using the 'meal' archetype was unconditionally treated as a
//      feeding record regardless of content - the exact path the run.js
//      no_eggs/cold_tea tray-irritation producer went through (it asserted
//      only offered:'yes', consumed:'unknown', nothing else).
//   2. The non-meal fallback check counted ANY food object as "grounded"
//      because it tested Object.values(food), which always included the
//      permanently-present nested `nutrition` sub-object - so it was true
//      for every event of every kind, feeding-related or not.
//
// Neither defect ever produced a record with a real meal identity: the ONLY
// two producers of world.physical.food facts in this codebase are the real
// scheduled-meal functions in environment.js (which always set meal_id AND
// meal_type) and the old no_eggs/cold_tea handler (which never set either).
// So "mealId is null AND every other status/portion/energy field is at its
// default UNKNOWN/null value" is an exact, unambiguous fingerprint of a
// contaminated entry, not a heuristic - confirmed empirically against every
// genuine record in production (all 90 have a non-null mealId; none of the
// 4355 contaminated entries do).
//
// A retired feeding-ledger entry is REMOVED from the current records[] array.
// feeding-homeostasis.js has no separate immutable history log to preserve
// underneath it (unlike e.g. the somatic substrate) - but the ORIGINAL
// structured environment event this ledger entry was derived from is not
// touched by this tool at all; only the feeding substrate's own incorrect
// derived classification is corrected.
//
// latestResolvedMeal and lastMealOfferedAt are recomputed from the surviving
// genuine records only, since contaminated entries could overwrite either
// with an ambiguous, disconnected value. lastKnownIntakeAt/lastKnownIntakeEventId
// and latestScheduledMeal are structurally immune to this contamination
// (neither defect ever produces FULLY_CONSUMED/PARTLY_CONSUMED or SCHEDULED
// status) and are left untouched, with an assertion that they are unaffected.
//
// physiologicalSatiety.intakeHistory contamination entries are removed the
// same way. physiologicalSatiety.status is reverted from INPUT_INCOMPLETE
// back to LIVE ONLY when: the reason is exactly UNKNOWN_INTAKE or
// PARTIAL_PORTION_UNKNOWN (never RUNNER_DOWNTIME_WITH_UNKNOWN_INTAKE, a
// genuinely separate and legitimate degradation this tool must never touch),
// real tracks already exist (a genuine clean-breakfast anchor was already
// established and never actually invalidated), and EVERY currently-unresolved
// intakeHistory entry is itself a contamination entry - i.e. there is no
// genuinely ambiguous real event mixed in that would make reverting a guess
// rather than a deterministic correction. If any of those conditions fail,
// this tool leaves physiologicalSatiety's status untouched and says so.
//
// Usage:
//   node reconcile-tray-irritation-feeding-contamination.mjs <path/to/vitals.json>            # dry-run (default)
//   node reconcile-tray-irritation-feeding-contamination.mjs <path/to/vitals.json> --apply    # write (backs up first)
//   node reconcile-tray-irritation-feeding-contamination.mjs <path/to/vitals.json> --apply --no-backup

import { cp, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadVitals, saveVitals } from './vitals.js';
import { createFeedingState } from './feeding-homeostasis.js';
import { createPhysiologicalSatiety } from './physiological-satiety.js';

export function isContaminatedFeedingRecord(record) {
  return !!record
    && record.mealId == null
    && record.scheduledStatus === 'UNKNOWN'
    && record.availabilityStatus === 'UNKNOWN'
    && record.receivedStatus === 'UNKNOWN'
    && record.consumptionStatus === 'UNKNOWN'
    && record.intakeOutcome === 'UNKNOWN'
    && record.portionCategory === 'UNKNOWN'
    && record.portionFraction == null
    && record.fullMealEnergyKcal == null
    && record.consumedEnergyKcal == null
    && record.fullMealMacros == null;
}

export function isContaminatedIntakeHistoryEntry(entry) {
  return !!entry
    && entry.mealType == null
    && entry.intakeOutcome === 'UNKNOWN'
    && entry.consumedEnergyKcal == null
    && entry.portionBasis === 'UNKNOWN'
    && entry.nutritionBasis === 'UNKNOWN';
}

function isUnresolvedIntakeHistoryEntry(entry) {
  return entry.intakeOutcome === 'UNKNOWN'
    || (entry.intakeOutcome === 'PARTLY_CONSUMED' && entry.portionBasis !== 'OBSERVED_EXACT');
}

// Classifies the feeding-homeostasis ledger. Returns { retire: [eventIds],
// keptGenuineCount, recomputedLatestResolvedMeal, recomputedLastMealOfferedAt }.
export function classifyFeeding(feedingState) {
  const records = (feedingState && feedingState.records) || [];
  const retire = [];
  const genuine = [];
  for (const record of records) {
    if (isContaminatedFeedingRecord(record)) retire.push(record.eventId);
    else genuine.push(record);
  }
  let recomputedLatestResolvedMeal = null;
  let recomputedLastMealOfferedAt = null;
  for (const record of genuine) {
    if (record.intakeOutcome !== 'MEAL_EXPECTED') recomputedLatestResolvedMeal = record;
    if (record.offeredStatus === 'OFFERED') recomputedLastMealOfferedAt = record.timestamp;
  }
  return { retire, keptGenuineCount: genuine.length, recomputedLatestResolvedMeal, recomputedLastMealOfferedAt };
}

// Applies the feeding classification to the CURRENT ledger only. Returns the
// same plan the caller can report from.
export function retireFeedingContamination(vitals, { classification } = {}) {
  const state = (vitals.cognition && vitals.cognition.feeding) || createFeedingState();
  const plan = classification || classifyFeeding(state);
  const retireSet = new Set(plan.retire);
  state.records = state.records.filter((record) => !retireSet.has(record.eventId));
  if (plan.retire.length) {
    state.latestResolvedMeal = plan.recomputedLatestResolvedMeal
      ? JSON.parse(JSON.stringify(plan.recomputedLatestResolvedMeal)) : null;
    state.lastMealOfferedAt = plan.recomputedLastMealOfferedAt || null;
  }
  if (!vitals.cognition) vitals.cognition = {};
  vitals.cognition.feeding = state;
  return plan;
}

// Classifies physiological-satiety intake history and decides whether
// reverting INPUT_INCOMPLETE to LIVE is safe. Returns { retireEntryIds,
// canRevertStatus, reason }.
export function classifySatiety(satietyState) {
  const history = (satietyState && satietyState.intakeHistory) || [];
  const retireEntryIds = [];
  const survivingUnresolved = [];
  for (const entry of history) {
    if (isContaminatedIntakeHistoryEntry(entry)) retireEntryIds.push(entry.eventId);
    else if (isUnresolvedIntakeHistoryEntry(entry)) survivingUnresolved.push(entry);
  }
  const reasonEligible = satietyState
    && satietyState.status === 'INPUT_INCOMPLETE'
    && ['UNKNOWN_INTAKE', 'PARTIAL_PORTION_UNKNOWN'].includes(satietyState.statusReason);
  const hasLiveTracks = !!satietyState && Array.isArray(satietyState.tracks) && satietyState.tracks.length > 0;
  let canRevertStatus = false;
  let reason;
  if (!reasonEligible) reason = 'status is not INPUT_INCOMPLETE from a tray-irritation-class reason; nothing to revert';
  else if (!hasLiveTracks) reason = 'no established model tracks exist; there is nothing to revert to';
  else if (survivingUnresolved.length) {
    reason = `${survivingUnresolved.length} genuinely ambiguous intake entr${survivingUnresolved.length === 1 ? 'y' : 'ies'} remain after removing contamination - refusing to guess, status left as-is`;
  } else {
    canRevertStatus = true;
    reason = 'every currently-unresolved intake entry is contamination; reverting to LIVE is a deterministic correction, not a guess';
  }
  return { retireEntryIds, canRevertStatus, reason };
}

const CONTAMINATION_UNCERTAINTY_STRINGS = new Set(['unknown intake', 'partial portion unknown']);

export function retireSatietyContamination(vitals, { classification } = {}) {
  const state = (vitals.cognition && vitals.cognition.physiologicalSatiety) || createPhysiologicalSatiety();
  const plan = classification || classifySatiety(state);
  const retireSet = new Set(plan.retireEntryIds);
  state.intakeHistory = state.intakeHistory.filter((entry) => !retireSet.has(entry.eventId));
  if (plan.canRevertStatus) {
    state.status = 'LIVE';
    state.statusReason = 'CLEAN_BREAKFAST_ANCHOR_ESTABLISHED';
    state.inputUncertainty = (state.inputUncertainty || []).filter((item) => !CONTAMINATION_UNCERTAINTY_STRINGS.has(item));
  }
  if (!vitals.cognition) vitals.cognition = {};
  vitals.cognition.physiologicalSatiety = state;
  return plan;
}

async function main(argv) {
  const args = argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const backup = !args.includes('--no-backup');
  if (!path) {
    console.error('usage: node reconcile-tray-irritation-feeding-contamination.mjs <vitals.json> [--apply] [--no-backup]');
    process.exit(2);
  }

  const vitals = await loadVitals(path);
  const feedingState = (vitals.cognition && vitals.cognition.feeding) || createFeedingState();
  const satietyState = (vitals.cognition && vitals.cognition.physiologicalSatiety) || createPhysiologicalSatiety();
  const feedingPlan = classifyFeeding(feedingState);
  const satietyPlan = classifySatiety(satietyState);

  const lastKnownIntakeAtBefore = feedingState.lastKnownIntakeAt;
  const lastKnownIntakeEventIdBefore = feedingState.lastKnownIntakeEventId;
  const latestScheduledMealBefore = JSON.stringify(feedingState.latestScheduledMeal);

  console.log(`# Tray-irritation / satiety-contamination reconciliation (${apply ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`checkpoint: ${path}`);
  console.log('feeding-homeostasis:');
  console.log(`  total ledger entries       : ${feedingState.records.length}`);
  console.log(`  to retire (contaminated)   : ${feedingPlan.retire.length}`);
  console.log(`  genuine entries kept       : ${feedingPlan.keptGenuineCount}`);
  console.log(`  recomputed latestResolvedMeal eventId: ${feedingPlan.recomputedLatestResolvedMeal ? feedingPlan.recomputedLatestResolvedMeal.eventId : null}`);
  console.log(`  recomputed lastMealOfferedAt: ${feedingPlan.recomputedLastMealOfferedAt}`);
  console.log('physiological-satiety:');
  console.log(`  intakeHistory entries      : ${satietyState.intakeHistory.length}`);
  console.log(`  to retire (contaminated)   : ${satietyPlan.retireEntryIds.length}`);
  console.log(`  current status             : ${satietyState.status} / ${satietyState.statusReason}`);
  console.log(`  can revert to LIVE?        : ${satietyPlan.canRevertStatus} (${satietyPlan.reason})`);

  if (!apply) {
    console.log('  dry-run: no changes written. Re-run with --apply to persist.');
    return;
  }

  if (backup) {
    const stateDir = dirname(path);
    const backupDir = `${stateDir}.pre-tray-irritation-feeding-reconcile.${Date.now()}`;
    await cp(stateDir, backupDir, { recursive: true });
    const info = await stat(backupDir);
    if (!info.isDirectory()) throw new Error(`backup did not produce a directory: ${backupDir}`);
    console.log(`  backup written: ${backupDir}`);
  }

  retireFeedingContamination(vitals, { classification: feedingPlan });
  retireSatietyContamination(vitals, { classification: satietyPlan });
  await saveVitals(path, vitals);

  const after = await loadVitals(path);
  if (after.cognition.feeding.lastKnownIntakeAt !== lastKnownIntakeAtBefore
    || after.cognition.feeding.lastKnownIntakeEventId !== lastKnownIntakeEventIdBefore) {
    throw new Error('lastKnownIntakeAt/lastKnownIntakeEventId changed - refusing to report success');
  }
  if (JSON.stringify(after.cognition.feeding.latestScheduledMeal) !== latestScheduledMealBefore) {
    throw new Error('latestScheduledMeal changed - refusing to report success');
  }
  console.log('  saved reconciled checkpoint.');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('reconcile-tray-irritation-feeding-contamination.mjs')) {
  main(process.argv).catch((error) => {
    console.error(error && error.stack || error);
    process.exit(1);
  });
}
