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
$londonPoint = captive_soma_history_points([
    ['ts' => '2026-09-10 15:38:05.515', 'value' => '41.5'],
], 'anxiety', 1789051080000, 1789051090000, 10);
if (count($londonPoint) !== 1 || $londonPoint[0]['ts'] !== 1789051085515) {
    fwrite(STDERR, "FAIL: Europe/London event time was not converted with DST\n");
    exit(1);
}
try {
    captive_soma_history_config('month', 'anxiety');
    fwrite(STDERR, "FAIL: invalid range accepted\n");
    exit(1);
} catch (InvalidArgumentException $e) {
}
$brainPayload = json_encode([
    'soma' => ['experienced' => ['brain' => ['amygdala' => ['value' => 0.64]]]],
], JSON_THROW_ON_ERROR);
$brainPoints = captive_soma_history_points(
    [['ts_ms' => 5000, 'payload' => $brainPayload]],
    'amygdala',
    0,
    10000,
    10,
    'brain',
    100.0
);
if (count($brainPoints) !== 1 || $brainPoints[0]['value'] !== 64.0) {
    fwrite(STDERR, "FAIL: brain-region readings were not converted to the shared 0-100 graph scale\n");
    exit(1);
}
$brainConfig = captive_soma_history_config('7d', 'amygdala', 'brain');
if ($brainConfig['jsonPath'] !== '$.soma.experienced.brain.amygdala.value' || $brainConfig['scale'] !== 100.0) {
    fwrite(STDERR, "FAIL: brain-region history config is incorrect\n");
    exit(1);
}
try {
    captive_soma_history_config('24h', 'unknown', 'brain');
    fwrite(STDERR, "FAIL: invalid brain region accepted\n");
    exit(1);
} catch (InvalidArgumentException $e) {
}
$sleepPayload = json_encode([
    'soma' => ['sleepHomeostasis' => ['sleepPressure' => 0.683]],
], JSON_THROW_ON_ERROR);
$sleepPoints = captive_soma_history_points(
    [['ts_ms' => 7000, 'payload' => $sleepPayload]],
    'sleepPressure',
    0,
    10000,
    10,
    'sleep',
    100.0
);
if (count($sleepPoints) !== 1 || $sleepPoints[0]['value'] !== 68.3) {
    fwrite(STDERR, "FAIL: Process S readings were not converted to the shared 0-100 graph scale\n");
    exit(1);
}
$sleepConfig = captive_soma_history_config('24h', 'sleepPressure', 'sleep');
if ($sleepConfig['jsonPath'] !== '$.soma.sleepHomeostasis.sleepPressure' || $sleepConfig['scale'] !== 100.0) {
    fwrite(STDERR, "FAIL: Process S history config is incorrect\n");
    exit(1);
}
echo "ALL PASS\n";
