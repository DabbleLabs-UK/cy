import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVitals, saveVitals } from './vitals.js';
import { createSomaRuntime } from './soma-runtime.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { observeEnvironmentRecord } from './grounded-environment-transition.js';
import { materialiseMealConsumption } from './environment.js';
import { mealChoiceState, mealContext, openMeal, decideMeal, recoverMeals, stageMealEvent } from './meal-choice.js';

test('real sectioned checkpoints recover committed intake and its outbox together exactly once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cy-meal-checkpoint-'));
  const path = join(directory, 'vitals.json');
  const nowMs = Date.parse('2026-10-23T06:30:00Z');
  const context = () => mealContext({ nowMs, date: '2026-10-23', phase: 'breakfast',
    location: { id: 'CELL', entered_at: '2026-10-23T05:30:00Z', source_event_id: 'cell-entry' },
    nextBoundaryAt: nowMs + 60_000 });
  try {
    const initial = await loadVitals(path);
    initial.mealChoice = mealChoiceState();
    const episode = openMeal(initial.mealChoice, {
      id: '2026-10-23:breakfast', meal: 'breakfast', available: true,
      availabilityEventId: 'availability-event', context: context(),
    }).episode;
    let checkpoint = 0;
    await assert.rejects(decideMeal(initial.mealChoice, episode, {
      readContext: context, generate: async () => '{"action":"eat"}',
      checkpoint: async () => {
        await saveVitals(path, initial);
        if (++checkpoint === 2) throw new Error('simulated death after commit');
      },
      apply: () => assert.fail('the original process died before intake'),
      unknown: () => assert.fail('a valid committed decision is not a refusal/unknown fallback'),
    }), /simulated death/);

    const recovered = await loadVitals(path);
    recovered.mealChoice = mealChoiceState(recovered.mealChoice);
    const soma = createSomaRuntime(recovered.cognition, {
      now: nowMs, onState: (state) => { recovered.cognition = state; },
    });
    let effects = 0;
    const callbacks = {
      readContext: context,
      unknown: () => assert.fail('still-live commit must recover'),
      apply: (current) => {
        effects++;
        const built = materialiseMealConsumption(current.meal, current.decision.action, {
          mealId: current.id, availabilityEventId: current.availabilityEventId,
          decisionId: current.decision.id,
        });
        const record = createEnvironmentRecord(createEnvironmentEvent(built.archetypeId, {
          id: current.effectEventId, timestamp: new Date(nowMs).toISOString(),
          eventType: built.name, world: built.world, observation: built.observation,
        }));
        observeEnvironmentRecord(soma, record);
        stageMealEvent(recovered.mealChoice, {
          kind: 'world_event_record', meal_episode_id: current.id, payload: record,
        });
      },
    };
    assert.equal(recoverMeals(recovered.mealChoice, callbacks), true);
    assert.equal(effects, 1);
    assert.equal(soma.state.feeding.records.length, 1);
    assert.equal(soma.state.feeding.records[0].intakeOutcome, 'FULLY_CONSUMED');
    await saveVitals(path, recovered);
    const afterEffect = await loadVitals(path);
    assert.equal(afterEffect.mealChoice.episodes[0].phase, 'APPLIED');
    assert.equal(afterEffect.cognition.feeding.records.length, 1);
    assert.deepEqual(afterEffect.mealChoice.pendingEvents, recovered.mealChoice.pendingEvents);
    assert.equal(recoverMeals(afterEffect.mealChoice, callbacks), false);
    assert.equal(effects, 1);
  } finally {
    // Exclusively owned fixture directory, never real CY state.
    await rm(directory, { recursive: true, force: true });
  }
});
