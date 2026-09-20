<?php
declare(strict_types=1);

require __DIR__ . '/../lib/soma-history.php';

$payload = static fn(float $value): string => json_encode([
    'soma' => ['experienced' => ['metrics' => ['arousal' => ['value' => $value]]]],
], JSON_THROW_ON_ERROR);
$rows = [
    ['ts_ms' => 1000, 'payload' => $payload(20)],
    ['ts_ms' => 1500, 'payload' => $payload(22)],
    ['ts_ms' => 5000, 'payload' => $payload(38)],
    ['ts_ms' => 6000, 'payload' => json_encode(['soma' => []], JSON_THROW_ON_ERROR)],
];
$points = captive_soma_history_points($rows, 'arousal', 0, 10000, 2);
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
foreach (['1h', '24h', '7d'] as $range) {
    $anxietyConfig = captive_soma_history_config($range, 'anxiety', 'operational-anxiety');
    if ($anxietyConfig['jsonPath'] !== '$.soma.operationalAnxiety.status'
        || $anxietyConfig['compactJsonPath'] !== '$.anxiety'
        || $anxietyConfig['categorical'] !== true) {
        fwrite(STDERR, "FAIL: operational Anxiety $range history config is incorrect\n");
        exit(1);
    }
}
$anxietyPoints = captive_operational_anxiety_history_points([
    ['ts_ms' => 1000, 'value' => 'QUIET'],
    ['ts_ms' => 2000, 'value' => 'QUIET'],
    ['ts_ms' => 3000, 'value' => 'ANTICIPATING'],
    ['ts_ms' => 4000, 'value' => 'THREAT_ONGOING'],
    ['ts_ms' => 5000, 'value' => 'not-a-state'],
], 0, 10000);
if ($anxietyPoints !== [
    ['ts' => 1000, 'state' => 'QUIET', 'lastObservedTs' => 2000],
    ['ts' => 3000, 'state' => 'ANTICIPATING', 'lastObservedTs' => 3000],
    ['ts' => 4000, 'state' => 'THREAT_ONGOING', 'lastObservedTs' => 4000],
]) {
    fwrite(STDERR, "FAIL: operational Anxiety history did not preserve categorical transitions\n");
    exit(1);
}
$london = new DateTimeZone('Europe/London');
$midnightFrom = (new DateTimeImmutable('2026-09-13 23:55:00', $london))->getTimestamp() * 1000;
$midnightTo = (new DateTimeImmutable('2026-09-14 00:05:00', $london))->getTimestamp() * 1000;
$midnightPoints = captive_operational_anxiety_history_points([
    ['ts' => '2026-09-13 23:59:30.000', 'value' => 'ANTICIPATING'],
    ['ts' => '2026-09-14 00:01:15.000', 'value' => 'UNKNOWN'],
    ['ts' => '2026-09-14 00:03:45.000', 'value' => 'THREAT_IMMINENT'],
], $midnightFrom, $midnightTo);
if (array_column($midnightPoints, 'state') !== ['ANTICIPATING', 'UNKNOWN', 'THREAT_IMMINENT']
    || $midnightPoints[0]['ts'] >= $midnightPoints[1]['ts']
    || $midnightPoints[1]['ts'] >= $midnightPoints[2]['ts']) {
    fwrite(STDERR, "FAIL: operational Anxiety history did not cross local midnight with UNKNOWN preserved\n");
    exit(1);
}
try {
    captive_soma_history_config('24h', 'anxiety', 'metric');
    fwrite(STDERR, "FAIL: legacy numeric Anxiety remains available through public history\n");
    exit(1);
} catch (InvalidArgumentException $e) {
}
try {
    captive_soma_history_config('24h', 'loneliness', 'metric');
    fwrite(STDERR, "FAIL: legacy numeric Loneliness remains available through public history\n");
    exit(1);
} catch (InvalidArgumentException $e) {
}
$socialToMs = strtotime('2026-09-12 00:15:00 UTC') * 1000;
$socialFromMs = $socialToMs - 3600000;
if (gmdate('Y-m-d H:i', (int)($socialFromMs / 1000)) !== '2026-09-11 23:15') {
    fwrite(STDERR, "FAIL: rolling one-hour social history does not cross midnight\n");
    exit(1);
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
if ($brainConfig['compactJsonPath'] !== '$.brain.amygdala') {
    fwrite(STDERR, "FAIL: compact brain-region history path is incorrect\n");
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
if ($satietyConfig['jsonPath'] !== '$.soma.physiologicalSatiety.headline.estimate'
    || $satietyConfig['jsonPathMin'] !== '$.soma.physiologicalSatiety.headline.central95.lower'
    || $satietyConfig['jsonPathMax'] !== '$.soma.physiologicalSatiety.headline.central95.upper'
    || $satietyConfig['compactJsonPath'] !== '$.satiety.estimate'
    || $satietyConfig['compactJsonPathMin'] !== '$.satiety.minimum'
    || $satietyConfig['compactJsonPathMax'] !== '$.satiety.maximum'
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
    'soma' => ['physiologicalSatiety' => ['headline' => [
        'status' => 'ESTIMATE_AVAILABLE',
        'estimate' => 4.7,
        'central95' => ['lower' => 4.3, 'upper' => 5.1],
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

if (captive_soma_history_bucket_seconds(captive_soma_history_config('1h', 'arousal')) !== 30
    || captive_soma_history_bucket_seconds(captive_soma_history_config('24h', 'arousal')) !== 600
    || captive_soma_history_bucket_seconds(captive_soma_history_config('7d', 'arousal')) !== 3600) {
    fwrite(STDERR, "FAIL: history query buckets do not match the bounded graph resolutions\n");
    exit(1);
}
$historyQuery = captive_soma_history_query('$.soma.experienced.metrics.arousal.value', 600);
if (!str_contains($historyQuery, 'FORCE INDEX (idx_kind_ts)')
    || !str_contains($historyQuery, 'SELECT MAX(seq) AS seq')
    || !str_contains($historyQuery, 'GROUP BY FLOOR(UNIX_TIMESTAMP(ts) / 600)')) {
    fwrite(STDERR, "FAIL: history query does not sample indexed time buckets before reading payload JSON\n");
    exit(1);
}
$combinedHistoryQuery = captive_combined_soma_history_query(
    '$.soma.experienced.metrics.arousal.value', '$.metrics.arousal', 600
);
if (!str_contains($combinedHistoryQuery, 'FROM vitals_history h')
    || !str_contains($combinedHistoryQuery, 'FROM events FORCE INDEX (idx_kind_ts)')
    || !str_contains($combinedHistoryQuery, 'UNION ALL')
    || !str_contains($combinedHistoryQuery, "'$.metrics.arousal'")) {
    fwrite(STDERR, "FAIL: combined history query does not bridge legacy and compact storage\n");
    exit(1);
}
$anxietyBoundary = captive_operational_anxiety_boundary_query(true);
if (!str_contains($anxietyBoundary, 'FROM vitals_history h')
    || !str_contains($anxietyBoundary, "'$.soma.operationalAnxiety.status'")
    || !str_contains($anxietyBoundary, 'ORDER BY boundary.ts DESC')) {
    fwrite(STDERR, "FAIL: Anxiety boundary query does not bridge legacy and compact storage\n");
    exit(1);
}
$satietyQuery = captive_soma_history_query(
    '$.soma.physiologicalSatiety.headline.estimate',
    600,
    '$.soma.physiologicalSatiety.headline.central95.lower',
    '$.soma.physiologicalSatiety.headline.central95.upper'
);
if (!str_contains($satietyQuery, ' AS minimum') || !str_contains($satietyQuery, ' AS maximum')) {
    fwrite(STDERR, "FAIL: physiological Satiety query omits its uncertainty bounds\n");
    exit(1);
}

$circadianConfig = captive_soma_history_config('24h', 'processC', 'circadian');
if ($circadianConfig['jsonPath'] !== '$.soma.circadianProcessC.processCEstimate'
    || $circadianConfig['jsonPathMin'] !== '$.soma.circadianProcessC.processCMin'
    || $circadianConfig['jsonPathMax'] !== '$.soma.circadianProcessC.processCMax'
    || $circadianConfig['compactJsonPath'] !== '$.processC.estimate'
    || $circadianConfig['compactJsonPathMin'] !== '$.processC.minimum'
    || $circadianConfig['compactJsonPathMax'] !== '$.processC.maximum'
    || $circadianConfig['mathematicallyReconstructed'] !== false
    || $circadianConfig['storedHistoricalSamples'] !== true
    || $circadianConfig['points'] !== 144) {
    fwrite(STDERR, "FAIL: Process C history config is incorrect\n");
    exit(1);
}
$storedCircadianPoints = captive_soma_history_points([[
    'ts_ms' => 9300,
    'value' => '-0.123456',
    'minimum' => '-0.234567',
    'maximum' => '-0.012345',
]], 'processC', 0, 10000, 10, 'circadian', 1.0);
if ($storedCircadianPoints !== [[
    'ts' => 9300,
    'value' => -0.123456,
    'minimum' => -0.234567,
    'maximum' => -0.012345,
]]) {
    fwrite(STDERR, "FAIL: stored Process C sample was recomputed or lost its uncertainty range\n");
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

$somaticConfig = captive_soma_history_config('24h', 'somatic_harm_headline', 'somatic');
if ($somaticConfig['jsonPath'] !== '$.soma.somaticNociceptive.headline.activeInjuryCount'
    || $somaticConfig['scale'] !== 1.0) {
    fwrite(STDERR, "FAIL: Somatic Harm history config is incorrect\n");
    exit(1);
}
$somaticEvent = static function (string $timestamp, string $stimulusStatus, string $injuryReason): array {
    return ['record' => json_encode([
        'somatic_nociceptive' => [
            'updated' => true,
            'injuryUpdate' => ['reason' => $injuryReason],
            'event' => [
                'timestamp' => $timestamp,
                'stimulus' => [
                    'status' => $stimulusStatus,
                    'noxiousStimulus' => 'YES',
                    'modality' => 'MECHANICAL',
                ],
                'body' => ['site' => 'left_hand', 'laterality' => 'LEFT'],
                'tissue' => ['damageStatus' => 'CONFIRMED', 'injuryStatus' => 'ACTIVE'],
            ],
        ],
    ], JSON_THROW_ON_ERROR)];
};
$somaticFrom = (int)(new DateTimeImmutable('2026-09-11 10:00:00', new DateTimeZone('Europe/London')))->format('Uv');
$somaticRows = [
    $somaticEvent('2026-09-11 10:15:00.000', 'ACTIVE', 'injury_created'),
    $somaticEvent('2026-09-11 10:45:00.000', 'ENDED', 'no_injury_identity'),
];
$somaticEvents = captive_somatic_history_events($somaticRows, $somaticFrom, $somaticFrom + 3600 * 1000);
if (array_column($somaticEvents, 'type') !== [
    'NOXIOUS_STIMULUS_ONSET', 'INJURY_CREATION', 'NOXIOUS_STIMULUS_END',
]) {
    fwrite(STDERR, "FAIL: Somatic Harm history did not preserve factual event transitions\n");
    exit(1);
}
if ($somaticEvents[0]['bodySite'] !== 'left_hand' || $somaticEvents[0]['modality'] !== 'MECHANICAL') {
    fwrite(STDERR, "FAIL: Somatic Harm history did not preserve factual site and modality\n");
    exit(1);
}
if (captive_somatic_history_events($somaticRows, $somaticFrom - 7200000, $somaticFrom - 3600000) !== []) {
    fwrite(STDERR, "FAIL: Somatic Harm history included an event outside the selected range\n");
    exit(1);
}
echo "ALL PASS\n";
