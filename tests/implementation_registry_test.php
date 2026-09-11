<?php
declare(strict_types=1);

require __DIR__ . '/../lib/implementation_registry.php';

$failures = [];
function check_registry(bool $condition, string $message): void {
    global $failures;
    if (!$condition) {
        $failures[] = $message;
    }
}

$registry = captive_implementation_registry();
check_registry($registry['schema'] === 'cy.implementation-registry', 'wrong registry schema');
check_registry(count($registry['soma_variables']) === 8, 'registry must contain eight Soma variables');
check_registry(captive_implementation_overall_status($registry) === 'provisional', 'overall status must be provisional');
check_registry(captive_implementation_public_label($registry, 'IMPLEMENTED') === 'LIVE', 'implemented public label');
check_registry(captive_implementation_public_label($registry, 'PROVISIONAL') === 'PROVISIONAL', 'provisional public label');
check_registry(captive_implementation_public_label($registry, 'NOT_IMPLEMENTED') === 'NOT MODELLED', 'not implemented public label');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'sleep_homeostasis')['implementation_status'] === 'IMPLEMENTED', 'sleep homeostasis must be implemented');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'circadian_process_c')['implementation_status'] === 'IMPLEMENTED', 'Process C must be implemented');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'circadian_process_c')['phase_basis'] === 'schedule_estimated', 'Process C phase must be schedule-estimated');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'circadian_entrainment')['implementation_status'] === 'NOT_IMPLEMENTED', 'circadian entrainment must remain not implemented');
check_registry(captive_implementation_registry_entry($registry, 'soma_variables', 'fatigue')['implementation_status'] === 'PROVISIONAL', 'subjective fatigue must remain provisional');
check_registry(captive_implementation_registry_entry($registry, 'brain_regions', 'scnCircadian')['implementation_status'] === 'IMPLEMENTED', 'specific SCN circadian analogy must be implemented');
check_registry(captive_implementation_registry_entry($registry, 'brain_regions', 'hypothalamic')['implementation_status'] === 'NOT_IMPLEMENTED', 'hypothalamic mapping must not be implemented');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'feeding_event_model')['implementation_status'] === 'IMPLEMENTED', 'feeding event model must be implemented');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'ingestion_ledger')['implementation_status'] === 'IMPLEMENTED', 'ingestion ledger must be implemented');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'feeding_deprivation_history')['implementation_status'] === 'IMPLEMENTED', 'feeding history must be implemented');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'energy_homeostatic_state')['implementation_status'] === 'NOT_IMPLEMENTED', 'energy homeostasis must remain not modelled');
check_registry(captive_implementation_registry_entry($registry, 'soma_variables', 'hunger')['implementation_status'] === 'PROVISIONAL', 'subjective Hunger must remain provisional');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'action_opportunity_model')['implementation_status'] === 'IMPLEMENTED', 'action opportunity model must be implemented');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'learned_controllability')['implementation_status'] === 'IMPLEMENTED', 'action-outcome contingency must be implemented');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'causal_controllability')['implementation_status'] === 'NOT_IMPLEMENTED', 'causal control must remain not modelled');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'perceived_controllability')['implementation_status'] === 'NOT_IMPLEMENTED', 'perceived control must remain not modelled');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'prison_instrumental_opportunities')['implementation_status'] === 'IMPLEMENTED', 'prison instrumental opportunities must be implemented');
check_registry(captive_implementation_registry_entry($registry, 'soma_subsystems', 'grounded_instrumental_action_selection')['implementation_status'] === 'NOT_IMPLEMENTED', 'grounded instrumental action selection must remain not modelled');
check_registry(captive_implementation_registry_entry($registry, 'soma_variables', 'anxiety')['implementation_status'] === 'PROVISIONAL', 'Anxiety must remain provisional');
check_registry(captive_implementation_registry_entry($registry, 'brain_regions', 'vmpfcControl')['implementation_status'] === 'NOT_IMPLEMENTED', 'vmPFC activation must remain not modelled');

if ($failures !== []) {
    fwrite(STDERR, implode("\n", $failures) . "\n");
    exit(1);
}

echo "ALL PASS\n";
