<?php
declare(strict_types=1);

require __DIR__ . '/../lib/implementation_registry.php';
require __DIR__ . '/../lib/environment_event.php';

$failures = [];
function check_environment(bool $condition, string $message): void {
    global $failures;
    if (!$condition) {
        $failures[] = $message;
    }
}

$record = [
    'schema' => 'cy.environment-record',
    'version' => 1,
    'world_event' => [
        'schema' => 'cy.environment-event',
        'version' => 1,
        'id' => 'env-test',
        'timestamp' => '2026-09-10 12:00:00.000',
        'event_type' => 'cell_search',
        'event_family' => 'custody',
        'world' => ['situation' => ['possible_harm' => 'possible']],
    ],
    'observation' => ['modality' => 'direct', 'certainty' => 'certain'],
    'soma_input' => [
        'schema' => 'cy.soma-input',
        'version' => 1,
        'event_id' => 'env-test',
        'possible_harm' => 'possible',
        'uncertainty' => 'unknown',
    ],
    'consumed_by' => ['soma-input-staging-v1', 'legacy-experienced-state-v2'],
];

check_environment(captive_environment_record_validate($record) === $record, 'record validation changed the record');
$inspection = captive_environment_record_inspection($record, captive_implementation_registry());
check_environment($inspection['what_happened']['id'] === 'env-test', 'wrong event id');
check_environment($inspection['what_cy_observed']['modality'] === 'direct', 'wrong observation modality');
check_environment($inspection['what_soma_received']['possible_harm'] === 'possible', 'Soma input was not preserved');
check_environment(count($inspection['what_systems_consumed_it']['consumers']) === 2, 'wrong consumer count');
check_environment($inspection['what_systems_consumed_it']['consumers'][1]['public_label'] === 'PROVISIONAL', 'legacy consumer must be provisional');

$sleepRecord = $record;
$sleepRecord['world_event']['id'] = 'env-sleep-test';
$sleepRecord['world_event']['event_type'] = 'sleep_state_asleep';
$sleepRecord['world_event']['event_family'] = 'homeostasis';
$sleepRecord['soma_input']['event_id'] = 'env-sleep-test';
$sleepRecord['soma_input']['sleep_period'] = 'sleep_period';
$sleepRecord['consumed_by'] = ['soma-input-staging-v1', 'process-s-normalized-v1'];
$sleepInspection = captive_environment_record_inspection($sleepRecord, captive_implementation_registry());
check_environment($sleepInspection['what_systems_consumed_it']['consumers'][1]['public_label'] === 'LIVE', 'Process S consumer must be LIVE');
check_environment(str_contains($sleepInspection['what_systems_consumed_it']['consumers'][1]['detail'], 'Process S'), 'Process S consumer provenance is missing');

$source = file_get_contents(__DIR__ . '/../public/api/ingest.php');
check_environment(str_contains($source, "if (\$kind === 'world_event_record')"), 'ingest must handle private records');
check_environment(str_contains($source, 'continue;'), 'private records must not fall through to public events');

$invalid = $record;
$invalid['world_event']['world']['appraisal'] = ['anxiety' => 0.8];
$rejected = false;
try {
    captive_environment_record_validate($invalid);
} catch (InvalidArgumentException $e) {
    $rejected = str_contains($e->getMessage(), 'model output');
}
check_environment($rejected, 'environment records must reject emotional or appraisal output fields');

if ($failures !== []) {
    fwrite(STDERR, implode("\n", $failures) . "\n");
    exit(1);
}

echo "ALL PASS\n";
