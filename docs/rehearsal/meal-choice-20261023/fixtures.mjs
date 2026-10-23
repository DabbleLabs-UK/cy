// Fixed synthetic bodily checkpoints. No production records or private mail.
import { createSomaRuntime } from '../../../runner/soma-runtime.js';
import { createEnvironmentEvent, createEnvironmentRecord } from '../../../runner/environment-schema.js';
import { observeEnvironmentRecord } from '../../../runner/grounded-environment-transition.js';
import { prepareSomaGeneration } from '../../../runner/soma-cycle.js';
import { formatGroundedProseContext } from '../../../runner/grounded-prose-context.js';
import { PUBLISHED_PARAMETERS, physiologicalSatietySnapshot } from '../../../runner/physiological-satiety.js';
import { mealChoiceState, mealContext, openMeal, mealModelCall } from '../../../runner/meal-choice.js';
import { options } from '../../../runner/prompt.js';

export const CASES = Object.freeze([
  ['01', 'breakfast', 'SPARSE'], ['02', 'lunch', 'EMPTY'],
  ['03', 'tea', 'FULL'], ['04', 'supper_snack', 'FILLING'],
  ['05', 'breakfast', 'EMPTY'], ['06', 'lunch', 'FULL'],
  ['07', 'tea', 'FILLING'], ['08', 'supper_snack', 'SPARSE'],
  ['09', 'breakfast', 'FULL'], ['10', 'lunch', 'FILLING'],
  ['11', 'tea', 'SPARSE'], ['12', 'supper_snack', 'EMPTY'],
  ['13', 'breakfast', 'FILLING'], ['14', 'lunch', 'SPARSE'],
  ['15', 'tea', 'EMPTY'], ['16', 'supper_snack', 'FULL'],
  ['17', 'lunch', 'SPARSE', true], ['18', 'lunch', 'FULL', true],
  ['19', 'breakfast', 'SPARSE'], ['20', 'lunch', 'FULL'],
].map(([id, meal, profile, injury = false]) => Object.freeze({ id, meal, profile, injury })));

const phases = { breakfast: 'unlock slop', lunch: 'lunch bangup', tea: 'tea', supper_snack: 'bangup night' };
export const BASE = Date.parse('2026-10-23T10:45:00Z');

export function recordFor(built, id, now = BASE) {
  return createEnvironmentRecord(createEnvironmentEvent(built.archetypeId, {
    id, timestamp: new Date(now).toISOString(), eventType: built.name,
    world: built.world, observation: built.observation,
  }));
}

export function prepare(c) {
  const soma = createSomaRuntime(null, { now: BASE });
  const seed = { type: 'SPARSE_NO_BODILY_EVIDENCE' };
  if (c.profile !== 'SPARSE') {
    // Synthetic checkpoint fixture, NOT a claim that the current routine
    // naturally produces these three states. Intake establishes the model;
    // the hypothetical current gut content is then declared explicitly.
    // No formula, threshold, parameter, personality or sensation mapping changes.
    const prior = createEnvironmentRecord(createEnvironmentEvent('meal', {
      id: 'synthetic-prior-intake', timestamp: new Date(BASE - 30 * 60_000).toISOString(),
      world: { physical: { food: {
        meal_id: 'synthetic-prior-intake', meal_type: 'breakfast', scheduled: 'yes',
        offered: 'yes', available: 'yes', received: 'yes', consumed: 'full',
        intake_outcome: 'full_consumed', portion_category: 'full', portion_fraction: 1,
        nutrition: { energy_kcal: 500, fat_g: 18, carbohydrate_g: 72, protein_g: 22 },
      } } },
    }));
    observeEnvironmentRecord(soma, prior);
    const distentionMl = { EMPTY: 296, FILLING: 400, FULL: 800 }[c.profile];
    for (const track of soma.state.physiologicalSatiety.tracks) {
      track.stomach.fatMl = 0;
      track.stomach.carbohydrateMl = (distentionMl - PUBLISHED_PARAMETERS.initialGastricDistentionMl)
        / PUBLISHED_PARAMETERS.gastricDistentionConstant;
      track.intake.remainingEnergyKcal = 0;
    }
    soma.state.physiologicalSatiety.lastAdvancedAtMs = BASE;
    Object.assign(seed, { type: 'HYPOTHETICAL_SYNTHETIC_CURRENT_GUT_CHECKPOINT',
      priorIntakeEventId: prior.world_event.id, targetDistentionMl: distentionMl,
      snapshot: physiologicalSatietySnapshot(soma.state.physiologicalSatiety).headline });
  }
  if (c.injury) {
    observeEnvironmentRecord(soma, createEnvironmentRecord(createEnvironmentEvent('somatic_event', {
      id: 'synthetic-observed-abrasion', timestamp: new Date(BASE).toISOString(),
      world: { somatic: {
        stimulus: { id: 'synthetic-abrasion-stimulus', modality: 'MECHANICAL', status: 'POINT', noxious_stimulus: 'YES' },
        body: { site: 'left_forearm', laterality: 'LEFT', certainty: 'CERTAIN' },
        tissue: { damage_status: 'CONFIRMED', injury_id: 'synthetic-abrasion', injury_type: 'ABRASION', injury_status: 'ACTIVE' },
        knowledge_status: 'PARTIAL', field_provenance: { tissue_damage: 'STRUCTURED_WORLD_FACT' },
      } },
    })));
  }
  // Exact current serviceMealChoice projection, including its field allowlist.
  const cognition = prepareSomaGeneration(soma, { now: BASE });
  const body = formatGroundedProseContext({ sections: (cognition.groundedContext?.sections || [])
    .filter((section) => ['sleep', 'somatic', 'feeding'].includes(section.id))
    .map((section) => ({ ...section, entries: section.entries.filter((entry) =>
      ['predicted_kss', 'physiological_satiety', 'active_injury', 'active_noxious_stimulus'].includes(entry.fact)) })) });
  const state = mealChoiceState();
  const context = mealContext({ nowMs: BASE, date: '2026-10-23', phase: phases[c.meal],
    location: { id: 'CELL', entered_at: new Date(BASE - 60_000).toISOString(), source_event_id: 'synthetic-cell-entry' },
    nextBoundaryAt: BASE + 90 * 60_000 });
  const episode = openMeal(state, { id: `2026-10-23:${c.meal}`, meal: c.meal, available: true,
    availabilityEventId: `synthetic-availability-${c.id}`, context }).episode;
  const characterContext = { bodily: body, location: 'cell', regime: phases[c.meal] };
  const call = mealModelCall(episode, characterContext);
  const opts = options({ cognition: soma.state }, 4, 'journal', { num_predict: 80 });
  return { c, soma, state, context, episode, characterContext, call, opts, seed };
}

export function packet(c) {
  const p = prepare(c);
  return { case: c, seed: p.seed, offeredActions: ['eat', 'decline'],
    characterContext: p.characterContext, call: p.call, opts: p.opts };
}
