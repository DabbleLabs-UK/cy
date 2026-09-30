// Restart-only recovery of the saved GI model from authoritative feeding facts.
// A scheduled meal opportunity is not evidence of consumption. Every crossed
// slot must have its actual outcome before the checkpoint can be advanced.

import { PRISON_SCHEDULE, PRISON_SCHEDULE_TIME_ZONE } from './environment.js';
import { advancePhysiologicalSatiety, observePhysiologicalSatietyIntake } from './physiological-satiety.js';

export const SATIETY_RECOVERY_MAX_GAP_MS = 7 * 24 * 60 * 60 * 1000;
const MEAL_SLOTS = PRISON_SCHEDULE.filter((slot) => slot.kind === 'meal');
const londonClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRISON_SCHEDULE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function scheduledSlotsBetween(startMs, endMs) {
  const slots = [];
  const firstMinute = Math.floor(startMs / 60000);
  for (let minute = firstMinute; minute * 60000 <= endMs; minute++) {
    const fields = Object.fromEntries(londonClock.formatToParts(new Date(minute * 60000))
      .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    const localMinute = Number(fields.hour) * 60 + Number(fields.minute);
    for (const slot of MEAL_SLOTS) {
      if (slot.mins === localMinute) slots.push(`${fields.year}-${fields.month}-${fields.day}:${slot.meal}`);
    }
  }
  return slots;
}

function sameIntake(left, right) {
  return left.timestamp === right.timestamp && left.mealId === right.mealId
    && left.intakeOutcome === right.intakeOutcome
    && left.consumedEnergyKcal === right.consumedEnergyKcal
    && left.portionBasis === right.portionBasis
    && JSON.stringify(left.fullMealMacros) === JSON.stringify(right.fullMealMacros);
}

function usableRecord(record) {
  return record && record.schema === 'cy.ingestion-record'
    && typeof record.eventId === 'string' && record.eventId
    && Number.isFinite(Date.parse(record.timestamp))
    && ['MEAL_EXPECTED', 'FULLY_CONSUMED', 'PARTLY_CONSUMED', 'REFUSED', 'UNAVAILABLE', 'UNKNOWN']
      .includes(record.intakeOutcome)
    && ['SCHEDULED', 'UNSCHEDULED', 'UNKNOWN'].includes(record.scheduledStatus)
    && (record.fullMealMacros == null || (typeof record.fullMealMacros === 'object'
      && ['fatG', 'carbohydrateG', 'proteinG'].every((key) =>
        Number.isFinite(record.fullMealMacros[key]) && record.fullMealMacros[key] >= 0)
      && Number.isFinite(record.consumedFraction)
      && record.consumedFraction >= 0 && record.consumedFraction <= 1));
}

export function recoverSatietyAfterRestart(somaState, authoritativeRecords, {
  now = Date.now(), historyComplete = false,
} = {}) {
  const state = somaState && somaState.physiologicalSatiety;
  const feeding = somaState && somaState.feeding;
  if (!state || !feeding || state.status !== 'INPUT_INCOMPLETE'
    || state.statusReason !== 'RUNNER_DOWNTIME_WITH_UNKNOWN_INTAKE'
    || !Array.isArray(state.tracks) || !state.tracks.length) {
    return { recovered: false, reason: 'NO_RECOVERABLE_CHECKPOINT' };
  }
  if (!historyComplete || !Array.isArray(authoritativeRecords)) {
    return { recovered: false, reason: 'AUTHORITATIVE_HISTORY_UNAVAILABLE' };
  }
  const fromMs = state.lastAdvancedAtMs;
  if (!Number.isFinite(fromMs) || !Number.isFinite(now) || now < fromMs
    || now - fromMs > SATIETY_RECOVERY_MAX_GAP_MS) {
    return { recovered: false, reason: 'GAP_OUTSIDE_BOUNDED_REPLAY' };
  }

  const byId = new Map();
  for (const record of [...(feeding.records || []), ...authoritativeRecords]) {
    if (!usableRecord(record)) return { recovered: false, reason: 'INVALID_LEDGER_RECORD' };
    const previous = byId.get(record.eventId);
    if (previous && !sameIntake(previous, record)) {
      return { recovered: false, reason: 'CONFLICTING_LEDGER_RECORD' };
    }
    byId.set(record.eventId, record);
  }
  const records = [...byId.values()].filter((record) => {
    const at = Date.parse(record.timestamp);
    return at >= fromMs && at <= now;
  }).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
    || Number(left.intakeOutcome !== 'MEAL_EXPECTED') - Number(right.intakeOutcome !== 'MEAL_EXPECTED')
    || left.eventId.localeCompare(right.eventId));

  const outcomes = new Map();
  for (const record of records) {
    if (record.intakeOutcome === 'UNKNOWN'
      || (record.intakeOutcome === 'PARTLY_CONSUMED' && record.portionBasis !== 'OBSERVED_EXACT')
      || (['FULLY_CONSUMED', 'PARTLY_CONSUMED'].includes(record.intakeOutcome)
        && !(Number.isFinite(record.consumedEnergyKcal) && record.consumedEnergyKcal > 0))
      || (['REFUSED', 'UNAVAILABLE'].includes(record.intakeOutcome)
        && record.consumedEnergyKcal !== 0)) {
      return { recovered: false, reason: 'INTAKE_FACT_INCOMPLETE' };
    }
  }
  for (const record of byId.values()) {
    if (Date.parse(record.timestamp) < Math.floor(fromMs / 60000) * 60000
      || Date.parse(record.timestamp) > now) continue;
    if (record.scheduledStatus === 'SCHEDULED' && record.intakeOutcome !== 'MEAL_EXPECTED') {
      const prior = outcomes.get(record.mealId);
      if (!record.mealId || (prior && prior.eventId !== record.eventId)) {
        return { recovered: false, reason: 'CONFLICTING_SCHEDULED_OUTCOME' };
      }
      outcomes.set(record.mealId, record);
    }
  }
  for (const slotId of scheduledSlotsBetween(fromMs, now)) {
    if (!outcomes.has(slotId)) return { recovered: false, reason: 'SCHEDULED_MEAL_OUTCOME_UNKNOWN', slotId };
  }

  // Work on copies so malformed legacy tracks cannot leave a half-replayed
  // LIVE state behind or disable the whole Soma runtime.
  const recovered = JSON.parse(JSON.stringify(state));
  const recoveredFeeding = JSON.parse(JSON.stringify(feeding));
  recovered.status = 'LIVE';
  recovered.statusReason = 'RECONSTRUCTED_FROM_AUTHORITATIVE_LEDGER';
  recovered.inputUncertainty = (recovered.inputUncertainty || [])
    .filter((item) => item !== 'intake during runner downtime is unknown');
  let replayed = 0;
  try {
    for (const record of records) {
      const result = observePhysiologicalSatietyIntake(recovered, record);
      if (result.updated) replayed++;
      if (!recoveredFeeding.records.some((item) => item.eventId === record.eventId)) {
        recoveredFeeding.records.push(JSON.parse(JSON.stringify(record)));
        if (record.offeredStatus === 'OFFERED') recoveredFeeding.lastMealOfferedAt = record.timestamp;
        if (record.scheduledStatus === 'SCHEDULED') recoveredFeeding.latestScheduledMeal = JSON.parse(JSON.stringify(record));
        if (record.intakeOutcome !== 'MEAL_EXPECTED') recoveredFeeding.latestResolvedMeal = JSON.parse(JSON.stringify(record));
        if (['FULLY_CONSUMED', 'PARTLY_CONSUMED'].includes(record.intakeOutcome)) {
          recoveredFeeding.lastKnownIntakeAt = record.timestamp;
          recoveredFeeding.lastKnownIntakeEventId = record.eventId;
        }
      }
    }
    advancePhysiologicalSatiety(recovered, now);
  } catch {
    return { recovered: false, reason: 'MODEL_REPLAY_FAILED' };
  }
  recovered.recoveryProvenance = {
    method: 'RECONSTRUCTED_FROM_AUTHORITATIVE_LEDGER',
    fromMs, toMs: now, replayedRecords: replayed,
  };
  for (const gap of recoveredFeeding.unknownIntervals) {
    if (gap.reason === 'RUNNER_NOT_OBSERVING'
      && gap.startedAtMs >= fromMs && gap.endedAtMs <= now) {
      gap.resolution = 'RECONSTRUCTED_FROM_AUTHORITATIVE_LEDGER';
    }
  }
  somaState.physiologicalSatiety = recovered;
  somaState.feeding = recoveredFeeding;
  return { recovered: true, replayedRecords: replayed, fromMs, toMs: now };
}
