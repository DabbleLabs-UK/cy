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

if ($failures !== []) {
    fwrite(STDERR, implode("\n", $failures) . "\n");
    exit(1);
}

echo "ALL PASS\n";
