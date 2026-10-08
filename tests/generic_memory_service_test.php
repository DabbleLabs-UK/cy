<?php
declare(strict_types=1);
require __DIR__ . '/../lib/autobiographical_memory.php';

$checks = [];
foreach (CY_MEMORY_GENERIC_SOURCE_TYPES as $type) {
    $checks['allowed generic class ' . $type] = captive_memory_generic_source_type($type) === $type;
}
foreach (['POSTCARD', 'CY_REPLY', 'AMBIENT_EVENT', 'environment_event', '', null, [], 1,
    "ENVIRONMENT_EVENT' OR 1=1"] as $i => $invalid) {
    try { captive_memory_generic_source_type($invalid); $checks['reject generic class ' . $i] = false; }
    catch (InvalidArgumentException) { $checks['reject generic class ' . $i] = true; }
}
$checks['ordinary filter remains compatible'] = captive_memory_formation_filter([])
    === ['sender_only' => false, 'min_age_seconds' => 0, 'visitor_id' => null];
$checks['HTTP fields cannot choose internal class'] = captive_memory_formation_filter([
    'generic_source_type' => 'POSTCARD', 'source_type' => 'POSTCARD', 'cadence_ms' => 0,
]) === captive_memory_formation_filter([]);
foreach ([['sender_only' => 1], ['min_age_seconds' => -1], ['min_age_seconds' => '120'],
    ['min_age_seconds' => 86401], ['visitor_id' => 'bad']] as $i => $invalid) {
    try { captive_memory_formation_filter($invalid); $checks['reject claim filter ' . $i] = false; }
    catch (InvalidArgumentException) { $checks['reject claim filter ' . $i] = true; }
}
$checks['negative wait is bounded'] = captive_memory_generic_admission('EMPTY', -1)['admission']['wait_ms'] === 0;
$checks['large wait is bounded'] = captive_memory_generic_admission('CADENCE', PHP_INT_MAX)['admission']['wait_ms'] === 1800000;
$checks['decline contains no job payload'] = captive_memory_generic_admission('BUSY', 30000)
    === ['job' => null, 'admission' => ['reason' => 'BUSY', 'wait_ms' => 30000]];
foreach ($checks as $label => $passed) {
    if (!$passed) { fwrite(STDERR, 'FAIL: ' . $label . PHP_EOL); exit(1); }
}
echo 'generic_memory_service_test.php: ' . count($checks) . " checks passed\n";
