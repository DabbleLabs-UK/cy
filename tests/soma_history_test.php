<?php
declare(strict_types=1);

require __DIR__ . '/../lib/soma-history.php';

$payload = static fn(float $value): string => json_encode([
    'soma' => ['experienced' => ['metrics' => ['anxiety' => ['value' => $value]]]],
], JSON_THROW_ON_ERROR);
$rows = [
    ['ts_ms' => 1000, 'payload' => $payload(20)],
    ['ts_ms' => 1500, 'payload' => $payload(22)],
    ['ts_ms' => 5000, 'payload' => $payload(38)],
    ['ts_ms' => 6000, 'payload' => json_encode(['soma' => []], JSON_THROW_ON_ERROR)],
];
$points = captive_soma_history_points($rows, 'anxiety', 0, 10000, 2);
if (count($points) !== 2 || $points[0]['value'] !== 22.0 || $points[1]['value'] !== 38.0) {
    fwrite(STDERR, "FAIL: stored points were not downsampled by taking the last real reading\n");
    exit(1);
}
try {
    captive_soma_history_config('month', 'anxiety');
    fwrite(STDERR, "FAIL: invalid range accepted\n");
    exit(1);
} catch (InvalidArgumentException $e) {
}
echo "ALL PASS\n";
