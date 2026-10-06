<?php
declare(strict_types=1);
require __DIR__ . '/../lib/autobiographical_memory.php';

$checks = [];
$checks['claim filter defaults preserve ordinary queue'] = captive_memory_formation_filter([])
    === ['sender_only' => false, 'min_age_seconds' => 0, 'visitor_id' => null];
$checks['sender priority uses source semantics'] = captive_memory_source_priority(['sourceType' => 'POSTCARD'])
    > captive_memory_source_priority(['sourceType' => 'CY_EXPRESSION']);
$checks['historical attempts do not define new failures'] = captive_memory_formation_retry(0, 'INVALID')
    === ['status' => 'RETRYABLE', 'failure_streak' => 1, 'model_invalid_streak' => 1, 'delay_seconds' => 30];
$checks['backoff increases'] = captive_memory_formation_retry(3, 'TIMEOUT')['delay_seconds'] === 240;
$checks['six invalid decisions stop retries'] = captive_memory_formation_retry(5, 'INVALID', 5)['status'] === 'FAILED';
$checks['five operational failures and one invalid stay retryable'] = captive_memory_formation_retry(5, 'INVALID', 0)
    === ['status' => 'RETRYABLE', 'failure_streak' => 6, 'model_invalid_streak' => 1, 'delay_seconds' => 900];
$checks['six transport failures remain recoverable'] = captive_memory_formation_retry(5, 'ERROR')['status'] === 'RETRYABLE';
$checks['six model-access timeouts remain recoverable'] = captive_memory_formation_retry(5, 'TIMEOUT')['status'] === 'RETRYABLE';
$checks['backoff remains bounded'] = captive_memory_formation_retry(999, 'ERROR')['delay_seconds'] === 900;
$checks['preemption cannot condemn source'] = captive_memory_formation_retry(5, 'PREEMPTED')
    === ['status' => 'RETRYABLE', 'failure_streak' => 5, 'model_invalid_streak' => 0, 'delay_seconds' => 30];
foreach (['TIMEOUT', 'ERROR', 'CONFLICT', 'PREEMPTED'] as $category) {
    $checks[$category . ' does not consume decision budget'] = captive_memory_formation_retry(5, $category, 3)['model_invalid_streak'] === 3;
}
foreach (CY_MEMORY_FORMATION_REJECTION_CODES as $code) {
    $checks['safe rejection code ' . $code] = captive_memory_formation_rejection_code($code) === $code;
}
$checks['legacy absent diagnostic remains compatible'] = captive_memory_formation_rejection_code(null) === null;
foreach (['private raw text', 'SCHEMA: private text', '', [], 1] as $i => $invalid) {
    try { captive_memory_formation_rejection_code($invalid); $checks['invalid diagnostic ' . $i] = false; }
    catch (InvalidArgumentException) { $checks['invalid diagnostic ' . $i] = true; }
}
foreach ([['sender_only' => 'true'], ['min_age_seconds' => -1], ['min_age_seconds' => 86401], ['visitor_id' => 'bad']] as $i => $invalid) {
    try { captive_memory_formation_filter($invalid); $checks['invalid filter ' . $i] = false; }
    catch (InvalidArgumentException) { $checks['invalid filter ' . $i] = true; }
}
foreach ($checks as $label => $passed) {
    if (!$passed) { fwrite(STDERR, 'FAIL: ' . $label . PHP_EOL); exit(1); }
}
echo 'memory_formation_delivery_test.php: ' . count($checks) . " checks passed\n";
