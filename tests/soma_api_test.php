<?php
declare(strict_types=1);

require __DIR__ . '/../lib/soma.php';

$failed = 0;
function check_soma(bool $condition, string $message): void
{
    global $failed;
    if (!$condition) {
        $failed++;
        fwrite(STDERR, "FAIL: $message\n");
    }
}

$state = [
    'version' => 1,
    'status' => 'implemented',
    'circuits' => ['attention' => ['value' => 0.71, 'source' => 'winner of current salience competition']],
    'attention' => ['text' => 'Mr Locke moved the postcard'],
    'memory' => ['episodes' => 2],
];
$implemented = captive_soma_api_payload([
    'seq' => '42',
    'ts' => '2026-09-10 12:00:00.000000',
    'payload' => json_encode(['mode' => 'journal', 'soma' => $state], JSON_THROW_ON_ERROR),
]);
check_soma($implemented['ok'] === true, 'implemented state is available');
check_soma($implemented['seq'] === 42, 'event sequence is preserved');
check_soma($implemented['soma'] === $state, 'runner snapshot is returned without recomputation');

$failedRuntime = captive_soma_api_payload([
    'seq' => '43',
    'ts' => '2026-09-10 12:00:05.000000',
    'payload' => json_encode(['soma' => ['status' => 'unavailable', 'reason' => 'bad persisted state']], JSON_THROW_ON_ERROR),
]);
check_soma($failedRuntime['ok'] === false, 'runtime failure stays unavailable');
check_soma($failedRuntime['reason'] === 'bad persisted state', 'runtime failure reason is preserved');

$missing = captive_soma_api_payload(null);
check_soma($missing['ok'] === false && $missing['soma'] === null, 'missing state is not fabricated');

echo $failed === 0 ? "ALL PASS\n" : "$failed FAILED\n";
exit($failed === 0 ? 0 : 1);
