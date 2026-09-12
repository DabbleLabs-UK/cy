import assert from 'node:assert/strict';
import {
  implementationRegistry,
  implementationEntry,
  somaImplementationStatus,
} from './implementation-registry.js';
import { createEnvironmentEvent, environmentEventToSomaInput } from './environment-schema.js';

const registry = implementationRegistry;
assert.equal(registry.schema, 'cy.implementation-registry');
assert.equal(registry.soma_variables.length, 9);
assert.equal(registry.soma_variables.filter((entry) => entry.implementation_status === 'IMPLEMENTED').length, 3);
assert.equal(somaImplementationStatus(), 'provisional');
assert.equal(implementationEntry('soma_subsystems', 'grounded_soma_prose_context').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'grounded_soma_to_expressive_context').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'model_mediated_expressive_choice').implementation_status, 'IMPLEMENTED');
assert.deepEqual(implementationEntry('soma_subsystems', 'model_mediated_expressive_choice').classification,
  ['SUBJECTIVE_CHARACTER_LAYER', 'NOT_SCIENTIFIC_PSYCHOLOGICAL_MODEL']);
assert.equal(implementationEntry('soma_subsystems', 'heuristic_drive_expressive_selector').lifecycle_status, 'DISABLED_LEGACY');
assert.equal(implementationEntry('soma_subsystems', 'grounded_soma_action_selection').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'sleep_homeostasis').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'predicted_sleepiness_tpm').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'legacy_fatigue_metric').lifecycle_status, 'DIAGNOSTICS_ONLY');
assert.equal(implementationEntry('soma_subsystems', 'general_fatigue').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'sleep_inertia').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'circadian_process_c').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'circadian_process_c').phase_basis, 'schedule_estimated');
assert.equal(implementationEntry('soma_subsystems', 'circadian_entrainment').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'probabilistic_threat_learning').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'threat_volatility').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'threat_generalisation').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'threat_contextual_inference').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'current_defensive_context').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'objective_controllability').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'threat_imminence_representation').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'perceived_controllability').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'action_opportunity_model').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'learned_controllability').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'causal_controllability').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'bayesian_controllability_model_comparison').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'action_selection_from_control').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'prison_instrumental_opportunities').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'grounded_instrumental_action_selection').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'remembered_imagined_threat_cues').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'feeding_event_model').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'ingestion_ledger').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'feeding_deprivation_history').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'energy_homeostatic_state').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'gut_satiety').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'hedonic_appetite').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'learned_meal_anticipation').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'feeding_action_selection').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'cy_embodiment_model').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'somatic_event_model').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_variables', 'somatic_harm_headline').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_variables', 'pain').lifecycle_status, 'DIAGNOSTICS_ONLY');
assert.equal(implementationEntry('soma_subsystems', 'noxious_stimulus_representation').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'injury_ledger').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'active_injury_count').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'injury_severity_model').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'computational_nociceptive_input_analogue').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'injury_healing_dynamics').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'subjective_pain').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'predictive_pain_inference').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'peripheral_sensitisation').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'central_sensitisation').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'nocifensive_action_model').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_variables', 'anxiety').implementation_status, 'PROVISIONAL');
assert.equal(implementationEntry('brain_regions', 'amygdala').implementation_status, 'PROVISIONAL');
assert.equal(implementationEntry('brain_regions', 'acc').implementation_status, 'PROVISIONAL');
assert.equal(implementationEntry('brain_regions', 'bnstUncertainThreat').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'pagImminentDefense').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'vmpfcControl').implementation_status, 'NOT_IMPLEMENTED');
assert.ok(implementationEntry('brain_regions', 'vmpfcControl').available_future_dependencies.includes('learned_controllability'));
assert.equal(implementationEntry('brain_regions', 'bnstUncertainThreat').ui_exposed, false);
assert.equal(implementationEntry('soma_variables', 'sleepiness').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_variables', 'satiety').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'scnCircadian').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'hypothalamic').implementation_status, 'NOT_IMPLEMENTED');
assert.ok(implementationEntry('brain_regions', 'hypothalamic').available_future_dependencies.includes('ingestion_ledger'));
assert.ok(implementationEntry('brain_regions', 'insula').available_future_dependencies.includes('ingestion_ledger'));
assert.ok(registry.brain_regions.filter((entry) => entry.implementation_status === 'PROVISIONAL').length >= 1);

const schemaKeys = new Set(Object.keys(environmentEventToSomaInput(createEnvironmentEvent('calm_routine', {
  id: 'registry-schema-check',
  timestamp: '2026-09-10 12:00:00.000',
}))));
for (const entry of registry.soma_variables) {
  for (const dependency of entry.data_dependencies) {
    assert.ok(schemaKeys.has(dependency), `${entry.id} dependency ${dependency} must exist in cy.soma-input`);
  }
}

console.log('implementation-registry.test.js: all checks passed');
