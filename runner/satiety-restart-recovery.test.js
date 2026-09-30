import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { feedingSnapshot, ingestionRecordFromEnvironment, touchFeedingContinuity } from './feeding-homeostasis.js';
import { advancePhysiologicalSatiety, gastricDistention, physiologicalSatietySnapshot } from './physiological-satiety.js';
import { observeSomaFeedingRecord, reconcileSoma } from './soma.js';
import { recoverSatietyAfterRestart, SATIETY_RECOVERY_MAX_GAP_MS } from './satiety-restart-recovery.js';
import { Client } from './client.js';

const at = (hour, minute, second = 0) => Date.parse(`2026-09-30T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`);
const clone = (value) => JSON.parse(JSON.stringify(value));

function meal(id, type, when, energy, outcome = 'full_consumed', explicitNutrition = true) {
  const consumed = outcome === 'full_consumed' ? 'full' : outcome === 'partial_consumed' ? 'partial' : 'none';
  const label = type === 'supper_snack' ? 'supper snack' : type;
  return createEnvironmentRecord(createEnvironmentEvent('meal', {
    id, timestamp: new Date(when).toISOString(),
    eventType: `${label}_${outcome === 'full_consumed' ? 'eaten'
      : outcome === 'partial_consumed' ? 'partial' : outcome === 'unavailable' ? 'missed' : 'refused'}`,
    world: { physical: { food: {
      meal_id: `2026-09-30:${type}`, meal_type: type, scheduled: 'yes',
      offered: outcome === 'unavailable' ? 'no' : 'yes',
      available: outcome === 'unavailable' ? 'no' : 'yes',
      received: outcome === 'unavailable' ? 'no' : 'yes',
      consumed, intake_outcome: outcome,
      portion_category: consumed, portion_fraction: consumed === 'full' ? 1 : consumed === 'partial' ? 0.45 : 0,
      ...(explicitNutrition ? { nutrition: { energy_kcal: energy, fat_g: energy * 0.04,
        carbohydrate_g: energy * 0.16, protein_g: energy * 0.04 } } : {}),
    } } },
  }));
}

const breakfast = meal('breakfast', 'breakfast', at(6, 30), 500);
const lunch = meal('lunch', 'lunch', at(10, 45), 750);
const tea = meal('tea', 'tea', at(15, 45), 750);
const snack = meal('snack', 'supper_snack', at(20, 0), 500);
assert.match(readFileSync(new URL('../public/api/satiety-recovery-history.php', import.meta.url), 'utf8'),
  /'supper snack'/, 'the private history query includes the actual persisted supper-snack event name');
assert.equal(lunch.world_event.event_family, 'homeostasis');
assert.equal(lunch.world_event.event_type, 'lunch_eaten');
const storedLunch = clone(lunch);
storedLunch.feeding = { ledger: observeSomaFeedingRecord(reconcileSoma(null, { now: at(10, 45) }), lunch).ledger };
assert.equal(storedLunch.feeding.ledger.record.eventId, 'lunch',
  'private world-event records expose the canonical ingestion fact used by the recovery endpoint');

function started() {
  const state = reconcileSoma(null, { now: at(6, 29) });
  observeSomaFeedingRecord(state, breakfast);
  return state;
}

function checkpoint(state, when) {
  advancePhysiologicalSatiety(state.physiologicalSatiety, when);
  touchFeedingContinuity(state.feeding, when);
  return clone(state);
}

function restarted(raw, now, authoritative = []) {
  const state = reconcileSoma(raw, { now });
  assert.equal(state.physiologicalSatiety.status, 'INPUT_INCOMPLETE');
  const result = recoverSatietyAfterRestart(state, authoritative.map(ingestionRecordFromEnvironment), {
    now, historyComplete: true,
  });
  return { state, result };
}

function compare(reference, recovered, label) {
  assert.equal(recovered.physiologicalSatiety.status, 'LIVE', label);
  const left = reference.physiologicalSatiety;
  const right = recovered.physiologicalSatiety;
  assert.equal(left.tracks.length, right.tracks.length, label);
  let maxDifference = 0;
  for (let index = 0; index < left.tracks.length; index++) {
    for (const section of ['stomach', 'upperSmallIntestine', 'lowerSmallIntestine', 'largeIntestine', 'hormones', 'intake']) {
      for (const [key, value] of Object.entries(left.tracks[index][section])) {
        if (typeof value === 'number') {
          maxDifference = Math.max(maxDifference, Math.abs(value - right.tracks[index][section][key]));
        }
      }
    }
  }
  assert.ok(maxDifference < 1e-9, `${label}: maximum compartment/hormone difference ${maxDifference}`);
  assert.deepEqual(physiologicalSatietySnapshot(left).headline,
    physiologicalSatietySnapshot(right).headline, `${label}: fullness headline`);
  return maxDifference;
}

// Restart five minutes after known 500 kcal breakfast.
{
  const base = started();
  const saved = checkpoint(base, at(6, 30));
  const reference = clone(base);
  advancePhysiologicalSatiety(reference.physiologicalSatiety, at(6, 35));
  const { state, result } = restarted(saved, at(6, 35), [breakfast]);
  assert.equal(result.recovered, true);
  assert.equal(result.replayedRecords, 0);
  assert.equal(feedingSnapshot(state.feeding).intakeKnowledgeStatus, 'COMPLETE');
  compare(reference, state, '500 kcal five-minute restart');
  const fiveSecondReference = clone(base);
  for (let when = at(6, 30) + 5000; when <= at(6, 35); when += 5000) {
    advancePhysiologicalSatiety(fiveSecondReference.physiologicalSatiety, when);
  }
  const maximumDistentionDifference = Math.max(...state.physiologicalSatiety.tracks.map((track, index) =>
    Math.abs(gastricDistention(track) - gastricDistention(fiveSecondReference.physiologicalSatiety.tracks[index]))));
  assert.ok(maximumDistentionDifference < 5, `five-second numerical cadence drift ${maximumDistentionDifference} mL`);
  console.log(`five-minute 500 kcal replay vs five-second cadence: maximum gastric difference ${maximumDistentionDifference.toFixed(6)} mL`);
}

// Restart five minutes after known 750 kcal lunch, with a complete prior state.
{
  const base = started();
  advancePhysiologicalSatiety(base.physiologicalSatiety, at(10, 45));
  observeSomaFeedingRecord(base, lunch);
  const saved = checkpoint(base, at(10, 45));
  const reference = clone(base);
  advancePhysiologicalSatiety(reference.physiologicalSatiety, at(10, 50));
  const { state, result } = restarted(saved, at(10, 50), [breakfast, lunch]);
  assert.equal(result.recovered, true);
  compare(reference, state, '750 kcal five-minute restart');
  const fiveSecondReference = clone(base);
  for (let when = at(10, 45) + 5000; when <= at(10, 50); when += 5000) {
    advancePhysiologicalSatiety(fiveSecondReference.physiologicalSatiety, when);
  }
  const maximumDistentionDifference = Math.max(...state.physiologicalSatiety.tracks.map((track, index) =>
    Math.abs(gastricDistention(track) - gastricDistention(fiveSecondReference.physiologicalSatiety.tracks[index]))));
  assert.ok(maximumDistentionDifference < 5, `750 kcal five-second cadence drift ${maximumDistentionDifference} mL`);
  console.log(`five-minute 750 kcal replay vs five-second cadence: maximum gastric difference ${maximumDistentionDifference.toFixed(6)} mL`);
}

// Production meal events use a reference ration, not measured nutrition.
// Replay must preserve the scenario ensemble and label that uncertainty.
{
  const referenceBreakfast = meal('reference-breakfast', 'breakfast', at(6, 30), 500, 'full_consumed', false);
  const base = reconcileSoma(null, { now: at(6, 29) });
  observeSomaFeedingRecord(base, referenceBreakfast);
  const saved = checkpoint(base, at(6, 30));
  const uninterrupted = clone(saved);
  advancePhysiologicalSatiety(uninterrupted.physiologicalSatiety, at(6, 35));
  const { state, result } = restarted(saved, at(6, 35), [referenceBreakfast]);
  assert.equal(result.recovered, true);
  assert.equal(state.physiologicalSatiety.latestKnownIntake.nutritionBasis,
    'HMPPS_REFERENCE_PRISON_RATION');
  compare(uninterrupted, state, 'reference-ration uncertainty retained');
}

// No scheduled intake between a saved state and the next meal opportunity.
{
  const base = started();
  const saved = checkpoint(base, at(9, 0));
  const reference = clone(base);
  advancePhysiologicalSatiety(reference.physiologicalSatiety, at(9, 10));
  const { state, result } = restarted(saved, at(9, 10), [breakfast]);
  assert.equal(result.recovered, true);
  compare(reference, state, 'between meals');
}

// A persisted lunch can be replayed across downtime, exactly once.
{
  const base = started();
  const saved = checkpoint(base, at(10, 43));
  const reference = clone(base);
  observeSomaFeedingRecord(reference, lunch);
  advancePhysiologicalSatiety(reference.physiologicalSatiety, at(10, 50));
  const { state, result } = restarted(saved, at(10, 50), [breakfast, lunch, lunch]);
  assert.equal(result.recovered, true);
  assert.equal(result.replayedRecords, 1);
  assert.equal(state.feeding.records.filter((item) => item.eventId === 'lunch').length, 1);
  compare(reference, state, 'persisted lunch replay');
}

// The scheduled opportunity alone is not evidence of the outcome.
{
  const saved = checkpoint(started(), at(10, 43));
  const { state, result } = restarted(saved, at(10, 50), [breakfast]);
  assert.equal(result.recovered, false);
  assert.equal(result.reason, 'SCHEDULED_MEAL_OUTCOME_UNKNOWN');
  assert.equal(state.physiologicalSatiety.status, 'INPUT_INCOMPLETE');
}

// An explicit missed/refused meal is evidence of zero intake, not a guessed meal.
{
  const missedLunch = meal('missed-lunch', 'lunch', at(10, 45), 750, 'unavailable');
  const saved = checkpoint(started(), at(10, 43));
  const reference = clone(saved);
  observeSomaFeedingRecord(reference, missedLunch);
  advancePhysiologicalSatiety(reference.physiologicalSatiety, at(10, 50));
  const { state, result } = restarted(saved, at(10, 50), [breakfast, missedLunch]);
  assert.equal(result.recovered, true);
  compare(reference, state, 'explicit missed meal');
}

// A partial meal without a measured portion cannot be reconstructed.
{
  const uncertain = ingestionRecordFromEnvironment(meal('partial-lunch', 'lunch', at(10, 45), 750, 'partial_consumed'));
  uncertain.portionBasis = 'CATEGORICAL_ONLY';
  uncertain.consumedEnergyKcal = null;
  const state = reconcileSoma(checkpoint(started(), at(10, 43)), { now: at(10, 50) });
  const result = recoverSatietyAfterRestart(state, [uncertain], { now: at(10, 50), historyComplete: true });
  assert.equal(result.reason, 'INTAKE_FACT_INCOMPLETE');
  assert.equal(state.physiologicalSatiety.status, 'INPUT_INCOMPLETE');
}

// A private-ledger outage is not proof that no meal occurred.
{
  const state = reconcileSoma(checkpoint(started(), at(9, 0)), { now: at(9, 10) });
  const result = recoverSatietyAfterRestart(state, [], { now: at(9, 10), historyComplete: false });
  assert.equal(result.reason, 'AUTHORITATIVE_HISTORY_UNAVAILABLE');
  assert.equal(state.physiologicalSatiety.status, 'INPUT_INCOMPLETE');
}

// A corrupt saved model cannot be partly promoted to LIVE by a failed replay.
{
  const state = reconcileSoma(checkpoint(started(), at(9, 0)), { now: at(9, 10) });
  state.physiologicalSatiety.tracks[0].stomach = null;
  const before = clone(state.physiologicalSatiety);
  const result = recoverSatietyAfterRestart(state, [], { now: at(9, 10), historyComplete: true });
  assert.equal(result.reason, 'MODEL_REPLAY_FAILED');
  assert.deepEqual(state.physiologicalSatiety, before);
}

// Long gaps cannot claim complete bounded history.
{
  const saved = checkpoint(started(), at(6, 31));
  const { state, result } = restarted(saved, at(6, 31) + SATIETY_RECOVERY_MAX_GAP_MS + 1, [breakfast]);
  assert.equal(result.reason, 'GAP_OUTSIDE_BOUNDED_REPLAY');
  assert.equal(state.physiologicalSatiety.status, 'INPUT_INCOMPLETE');
}

// Restart before lunch, then observe lunch normally. No special breakfast reset.
{
  const saved = checkpoint(started(), at(10, 43));
  const { state, result } = restarted(saved, at(10, 44), [breakfast]);
  assert.equal(result.recovered, true);
  observeSomaFeedingRecord(state, lunch);
  assert.equal(state.physiologicalSatiety.status, 'LIVE');
  assert.equal(state.physiologicalSatiety.intakeHistory.filter((item) => item.eventId === 'lunch').length, 1);
}

// Restart just after lunch: it is in the authoritative DB but not checkpoint.
{
  const saved = checkpoint(started(), at(10, 44));
  const { state, result } = restarted(saved, at(10, 46), [breakfast, lunch]);
  assert.equal(result.recovered, true);
  assert.equal(result.replayedRecords, 1);
  assert.equal(state.physiologicalSatiety.latestKnownIntake.eventId, 'lunch');
}

// Multiple persisted meal outcomes, including a zero-intake outcome, remain distinct.
{
  const saved = checkpoint(started(), at(10, 43));
  const reference = clone(saved);
  observeSomaFeedingRecord(reference, lunch);
  observeSomaFeedingRecord(reference, tea);
  advancePhysiologicalSatiety(reference.physiologicalSatiety, at(16, 0));
  const { state, result } = restarted(saved, at(16, 0), [breakfast, lunch, tea]);
  assert.equal(result.recovered, true);
  assert.equal(result.replayedRecords, 2);
  compare(reference, state, 'multiple known meals');
}

// The 21:00 local supper-snack slot uses a different event label and meal key.
{
  const base = started();
  observeSomaFeedingRecord(base, lunch);
  observeSomaFeedingRecord(base, tea);
  const saved = checkpoint(base, at(19, 58));
  const reference = clone(saved);
  observeSomaFeedingRecord(reference, snack);
  advancePhysiologicalSatiety(reference.physiologicalSatiety, at(20, 5));
  const { state, result } = restarted(saved, at(20, 5), [breakfast, lunch, tea, snack]);
  assert.equal(result.recovered, true);
  assert.equal(snack.world_event.event_type, 'supper snack_eaten');
  compare(reference, state, 'supper snack');
}

// A second checkpoint/restart does not ingest either meal twice.
{
  const saved = checkpoint(started(), at(10, 43));
  const first = restarted(saved, at(10, 50), [breakfast, lunch]);
  assert.equal(first.result.recovered, true);
  const second = restarted(checkpoint(first.state, at(10, 50)), at(10, 55), [breakfast, lunch]);
  assert.equal(second.result.recovered, true);
  assert.equal(second.result.replayedRecords, 0);
  assert.equal(second.state.physiologicalSatiety.intakeHistory.filter((item) => item.eventId === 'lunch').length, 1);
}

// The authenticated startup API transports canonical records and can derive
// an older direct-observation world record lacking an embedded feeding trace.
{
  const previousFetch = globalThis.fetch;
  const temp = await mkdtemp(join(tmpdir(), 'cy-satiety-recovery-'));
  try {
    await writeFile(join(temp, 'queue.jsonl'), `${JSON.stringify({ kind: 'world_event_record', payload: tea })}\n`);
    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/api\/satiety-recovery-history\.php$/);
      assert.equal(options.headers['X-Cy-Key'], 'test-ingest-key');
      return Response.json({ ok: true, complete: true,
        records: [ingestionRecordFromEnvironment(breakfast), lunch] });
    };
    const client = new Client({ apiBase: 'https://example.invalid', ingestKey: 'test-ingest-key' }, temp);
    const history = await client.fetchSatietyRecoveryHistory();
    assert.equal(history.complete, true);
    assert.deepEqual(history.records.map((record) => record.eventId), ['breakfast', 'lunch', 'tea']);
    await writeFile(join(temp, 'queue.jsonl'), '{broken\n');
    assert.equal((await client.fetchSatietyRecoveryHistory()).complete, false,
      'a corrupt pending-event queue cannot be mistaken for complete history');
  } finally {
    globalThis.fetch = previousFetch;
    await rm(temp, { recursive: true, force: true });
  }
}

console.log('satiety-restart-recovery.test.js: all checks passed');
