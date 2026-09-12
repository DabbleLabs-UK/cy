<?php
declare(strict_types=1);

require __DIR__ . '/../lib/world_simulation.php';

$failures = [];
function check_world_simulation(bool $condition, string $message): void {
    global $failures;
    if (!$condition) {
        $failures[] = $message;
    }
}

$packet = [
    'schema' => 'cy.shared-context-packet',
    'consumer' => 'AWG',
    'generatedAt' => '2026-09-12T12:00:00.000Z',
    'metrics' => ['sourceCount' => 2, 'selectedCount' => 1],
];
$inspection = captive_context_inspection_validate([
    'generation_ref' => 'awg-context:test',
    'packet' => $packet,
    'rendering' => '<SHARED_CONTEXT consumer="AWG">test</SHARED_CONTEXT>',
]);
check_world_simulation($inspection['consumer'] === 'AWG', 'context consumer was not preserved');
check_world_simulation($inspection['generation_ref'] === 'awg-context:test', 'generation reference was not preserved');

$run = captive_awg_run_validate([
    'runId' => 'awg-run:test',
    'ranAt' => '2026-09-12T12:00:00.000Z',
    'candidateType' => 'NO_EVENT',
    'contextPacketSummary' => ['selectedCount' => 3],
    'candidateOutput' => ['decision' => 'NO_EVENT'],
    'validationStatus' => 'ACCEPTED_NO_EVENT',
    'createdWorldEventIds' => [],
    'threadChanges' => [],
    'modelLatencyMs' => 100,
    'validationLatencyMs' => 2,
    'totalLatencyMs' => 102,
    'provider' => 'ollama',
    'model' => 'test-model',
]);
check_world_simulation($run['validation_status'] === 'ACCEPTED_NO_EVENT', 'AWG run status was not preserved');
check_world_simulation($run['total_latency_ms'] === 102, 'AWG latency was not preserved');

$thread = captive_world_thread_validate([
    'id' => 'thread:test-note',
    'type' => 'note_delivery',
    'state' => 'OPEN',
    'summary' => 'A note remains undelivered.',
    'participants' => ['daemon', 'cy'],
    'sourceEventIds' => ['world:test-note'],
    'nextEligibleAt' => null,
    'resolution' => null,
    'visibility' => [['observerId' => 'cy', 'access' => 'CY_DIRECT']],
    'createdAt' => '2026-09-12T12:00:00.000Z',
    'updatedAt' => '2026-09-12T12:00:00.000Z',
]);
check_world_simulation($thread['state'] === 'OPEN', 'world thread state was not preserved');

$object = captive_world_object_validate([
    'id' => 'object:test-note',
    'type' => 'note',
    'ownerId' => 'daemon',
    'holderId' => 'cy',
    'location' => 'cell',
    'status' => 'ACTIVE',
    'visibility' => [['observerId' => 'cy', 'access' => 'CY_DIRECT']],
    'sourceEventId' => 'world:test-note',
    'updatedAt' => '2026-09-12T12:00:00.000Z',
]);
check_world_simulation($object['holder_id'] === 'cy', 'world object holder was not preserved');

$rejected = false;
try {
    captive_context_inspection_validate([
        'packet' => [...$packet, 'consumer' => 'UNAPPROVED_CONSUMER'],
        'rendering' => 'unsafe',
    ]);
} catch (InvalidArgumentException) {
    $rejected = true;
}
check_world_simulation($rejected, 'unknown context consumers must be rejected');

$ingest = file_get_contents(__DIR__ . '/../public/api/ingest.php');
foreach (['context_inspection', 'awg_run_record', 'world_thread_record', 'world_object_record'] as $kind) {
    check_world_simulation(
        str_contains($ingest, "if (\$kind === '$kind')"),
        "$kind must have a private ingest branch"
    );
}
$inspectionApi = file_get_contents(__DIR__ . '/../public/api/world-inspection.php');
check_world_simulation(str_contains($inspectionApi, 'captive_is_admin'), 'world inspection must be admin-only');
check_world_simulation(str_contains($inspectionApi, 'LIMIT 60'), 'world inspection must expose bounded selectable generations');

$migration = file_get_contents(__DIR__ . '/../sql/016_context_broker_awg.sql');
foreach (['context_broker_inspections', 'ambient_world_runs', 'world_threads', 'world_objects'] as $table) {
    check_world_simulation(str_contains($migration, "CREATE TABLE $table"), "migration is missing $table");
}

if ($failures !== []) {
    fwrite(STDERR, implode("\n", $failures) . "\n");
    exit(1);
}

echo "ALL PASS\n";
