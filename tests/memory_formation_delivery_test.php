<?php
declare(strict_types=1);
require __DIR__ . '/../lib/autobiographical_memory.php';

$checks = [];
$checks['claim filter defaults preserve ordinary queue'] = captive_memory_formation_filter([])
    === ['sender_only' => false, 'min_age_seconds' => 0, 'visitor_id' => null];
$checks['sender priority uses source semantics'] = captive_memory_source_priority(['sourceType' => 'POSTCARD'])
    > captive_memory_source_priority(['sourceType' => 'CY_EXPRESSION']);
$checks['historical attempts do not define new failures'] = captive_memory_formation_retry(0, 'INVALID')
    === ['status' => 'RETRYABLE', 'failure_streak' => 1, 'delay_seconds' => 30];
$checks['backoff increases'] = captive_memory_formation_retry(3, 'TIMEOUT')['delay_seconds'] === 240;
$checks['six consecutive failures stop retries'] = captive_memory_formation_retry(5, 'ERROR')['status'] === 'FAILED';
$checks['backoff remains bounded'] = captive_memory_formation_retry(999, 'ERROR')['delay_seconds'] === 900;
$checks['preemption cannot condemn source'] = captive_memory_formation_retry(5, 'PREEMPTED')
    === ['status' => 'RETRYABLE', 'failure_streak' => 5, 'delay_seconds' => 30];
foreach ([['sender_only' => 'true'], ['min_age_seconds' => -1], ['min_age_seconds' => 86401], ['visitor_id' => 'bad']] as $i => $invalid) {
    try { captive_memory_formation_filter($invalid); $checks['invalid filter ' . $i] = false; }
    catch (InvalidArgumentException) { $checks['invalid filter ' . $i] = true; }
}
foreach ($checks as $label => $passed) {
    if (!$passed) { fwrite(STDERR, 'FAIL: ' . $label . PHP_EOL); exit(1); }
}
echo 'memory_formation_delivery_test.php: ' . count($checks) . " checks passed\n";
