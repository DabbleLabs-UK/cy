// Recover the persisted three-process sleep state from recorded transitions.
// A history transport failure must not reset the checkpoint or bypass the
// separate check for an unobserved scheduled sleep/wake boundary.

const ASLEEP = new Set(['sleep_period', 'asleep', 'sleep']);
const AWAKE = new Set(['awake', 'waking', 'forced_wakefulness', 'interrupted']);

function usableRecord(record) {
  if (!record || !Number.isFinite(record.occurred_at_ms)
    || !record.soma_input || typeof record.soma_input !== 'object') return false;
  const input = record.soma_input;
  return input.sleep_interruption === 'present'
    || ASLEEP.has(input.sleep_period) || AWAKE.has(input.sleep_period);
}

export async function restoreStartupSleepHistory({
  soma, fetchHistory, scheduleTransitionCrossed, now = Date.now(), log = console,
}) {
  let replayed = false;
  let recordCount = 0;
  try {
    const records = await fetchHistory();
    if (!Array.isArray(records) || !records.every(usableRecord)) {
      throw new Error('malformed structured sleep history');
    }
    const persisted = soma.state && soma.state.predictedSleepiness;
    if (records.length === 0 && Number.isFinite(persisted && persisted.lastObservedAtMs)) {
      throw new Error('empty history conflicts with persisted sleep observations');
    }
    soma.replayObservedSleepRecords(records, { now });
    recordCount = records.length;
    replayed = true;
    log.log(`[cy] TPM sleep history: ${recordCount} structured observations replayed`);
  } catch (error) {
    const persisted = soma.state && soma.state.predictedSleepiness;
    const label = persisted && persisted.continuityKnown
      && persisted.completeObservedSleepEpisodes >= 2 ? 'LIVE' : 'CALIBRATING';
    log.warn(`[cy] TPM sleep history unavailable; retained persisted ${label} state: ${error.message}`);
  }

  const state = soma.state && soma.state.predictedSleepiness;
  let continuityMarkedUnknown = false;
  if (state && state.continuityKnown && Number.isFinite(state.lastObservedAtMs)
    && scheduleTransitionCrossed(state.lastObservedAtMs, now)) {
    soma.markThreeProcessContinuityUnknown({
      now, source: 'restart-gap-crossed-unrecorded-schedule-transition',
    });
    continuityMarkedUnknown = true;
    log.log('[cy] TPM continuity marked unknown: downtime gap crossed an unrecorded schedule transition');
  }
  return { replayed, recordCount, continuityMarkedUnknown };
}
