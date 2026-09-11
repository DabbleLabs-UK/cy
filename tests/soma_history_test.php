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
$sleepinessPayload = json_encode([
    'soma' => ['predictedSleepiness' => ['predictedKss' => 6.25]],
], JSON_THROW_ON_ERROR);
$sleepinessPoints = captive_soma_history_points(
    [['ts_ms' => 8000, 'payload' => $sleepinessPayload]],
    'sleepiness', 0, 10000, 10, 'sleepiness', 1.0
);
if (count($sleepinessPoints) !== 1 || $sleepinessPoints[0]['value'] !== 6.3) {
    fwrite(STDERR, "FAIL: predicted KSS history was not read on its native scale\n");
    exit(1);
}
$sleepinessConfig = captive_soma_history_config('24h', 'sleepiness', 'sleepiness');
if ($sleepinessConfig['jsonPath'] !== '$.soma.predictedSleepiness.predictedKss'
    || $sleepinessConfig['scale'] !== 1.0) {
    fwrite(STDERR, "FAIL: predicted KSS history config is incorrect\n");
    exit(1);
}
$satietyConfig = captive_soma_history_config('24h', 'satiety', 'satiety');
if ($satietyConfig['jsonPath'] !== '$.soma.physiologicalSatiety.current.midpoint'
    || $satietyConfig['jsonPathMin'] !== '$.soma.physiologicalSatiety.current.minimum'
    || $satietyConfig['jsonPathMax'] !== '$.soma.physiologicalSatiety.current.maximum'
    || $satietyConfig['scale'] !== 1.0) {
    fwrite(STDERR, "FAIL: physiological Satiety history config is incorrect\n");
    exit(1);
}
$satietyPoints = captive_soma_history_points([[
    'ts_ms' => 9000,
    'value' => '4.7',
    'minimum' => '4.3',
    'maximum' => '5.1',
]], 'satiety', 0, 10000, 10, 'satiety', 1.0);
if (count($satietyPoints) !== 1
    || $satietyPoints[0]['value'] !== 4.7
    || $satietyPoints[0]['minimum'] !== 4.3
    || $satietyPoints[0]['maximum'] !== 5.1) {
    fwrite(STDERR, "FAIL: physiological Satiety history did not preserve its uncertainty band\n");
    exit(1);
}
$satietyPayload = json_encode([
    'soma' => ['physiologicalSatiety' => ['current' => [
        'midpoint' => 4.7,
        'minimum' => 4.3,
        'maximum' => 5.1,
    ]]],
], JSON_THROW_ON_ERROR);
$satietyPayloadPoints = captive_soma_history_points(
    [['ts_ms' => 9250, 'payload' => $satietyPayload]],
    'satiety', 0, 10000, 10, 'satiety', 1.0
);
if ($satietyPayloadPoints !== [[
    'ts' => 9250,
    'value' => 4.7,
    'minimum' => 4.3,
    'maximum' => 5.1,
]]) {
    fwrite(STDERR, "FAIL: physiological Satiety payload fallback lost its uncertainty band\n");
    exit(1);
}
$legacyHungerPayload = json_encode([
    'soma' => ['experienced' => ['metrics' => ['hunger' => ['value' => 100]]]],
], JSON_THROW_ON_ERROR);
$satietyFromLegacyHunger = captive_soma_history_points(
    [['ts_ms' => 9500, 'payload' => $legacyHungerPayload]],
    'satiety', 0, 10000, 10, 'satiety', 1.0
);
if ($satietyFromLegacyHunger !== []) {
    fwrite(STDERR, "FAIL: legacy Hunger history leaked into physiological Satiety history\n");
    exit(1);
}

if (captive_soma_history_bucket_seconds(captive_soma_history_config('1h', 'anxiety')) !== 30
    || captive_soma_history_bucket_seconds(captive_soma_history_config('24h', 'anxiety')) !== 600
    || captive_soma_history_bucket_seconds(captive_soma_history_config('7d', 'anxiety')) !== 3600) {
    fwrite(STDERR, "FAIL: history query buckets do not match the bounded graph resolutions\n");
    exit(1);
}
$historyQuery = captive_soma_history_query('$.soma.experienced.metrics.anxiety.value', 600);
if (!str_contains($historyQuery, 'FORCE INDEX (idx_kind_ts)')
    || !str_contains($historyQuery, 'SELECT MAX(seq) AS seq')
    || !str_contains($historyQuery, 'GROUP BY FLOOR(UNIX_TIMESTAMP(ts) / 600)')) {
    fwrite(STDERR, "FAIL: history query does not sample indexed time buckets before reading payload JSON\n");
    exit(1);
}
$satietyQuery = captive_soma_history_query(
    '$.soma.physiologicalSatiety.current.midpoint',
    600,
    '$.soma.physiologicalSatiety.current.minimum',
    '$.soma.physiologicalSatiety.current.maximum'
);
if (!str_contains($satietyQuery, ' AS minimum') || !str_contains($satietyQuery, ' AS maximum')) {
    fwrite(STDERR, "FAIL: physiological Satiety query omits its uncertainty bounds\n");
    exit(1);
}

$circadianConfig = captive_soma_history_config('24h', 'processC', 'circadian');
if ($circadianConfig['jsonPath'] !== '$.soma.circadianProcessC.processCEstimate'
    || $circadianConfig['mathematicallyReconstructed'] !== true
    || $circadianConfig['points'] !== 144) {
    fwrite(STDERR, "FAIL: Process C history config is incorrect\n");
    exit(1);
}
$harmonics = [0.97, 0.22, 0.07, 0.03, 0.001];
$circadian = [
    'modelId' => 'borbely-achermann-process-c-five-harmonic',
    'modelVersion' => 'process-c-schedule-estimated-v1',
    'phaseBasis' => 'habitual_schedule_estimate',
    'harmonics' => $harmonics,
    'phiInterval' => [
        'startHour' => 7.49182571597256,
        'endHour' => 8.49182571597256,
        'midpointHour' => 7.99182571597256,
        'durationHours' => 1.0,
    ],
    'schedule' => ['timeZone' => 'Europe/London'],
];
$historyStart = (int)(new DateTimeImmutable('2026-09-10 00:00:00', new DateTimeZone('Europe/London')))->format('Uv');
$circadianPoints = captive_circadian_history_points(
    $circadian,
    $historyStart,
    $historyStart + 24 * 3600 * 1000,
    145
);
if (count($circadianPoints) !== 145) {
    fwrite(STDERR, "FAIL: Process C did not reconstruct the requested graph resolution\n");
    exit(1);
}
if (abs($circadianPoints[0]['value'] - $circadianPoints[144]['value']) > 0.000002) {
    fwrite(STDERR, "FAIL: reconstructed Process C graph is not 24-hour periodic\n");
    exit(1);
}
$values = array_column($circadianPoints, 'value');
if (max($values) <= 1.0 || min($values) >= -1.0) {
    fwrite(STDERR, "FAIL: reconstructed 24-hour graph does not contain the complete waveform\n");
    exit(1);
}
foreach ($circadianPoints as $point) {
    if ($point['value'] < $point['minimum'] - 0.000002 || $point['value'] > $point['maximum'] + 0.000002) {
        fwrite(STDERR, "FAIL: Process C estimate escaped its phase-uncertainty band\n");
        exit(1);
    }
}
echo "ALL PASS\n";
