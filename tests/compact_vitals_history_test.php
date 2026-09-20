<?php
declare(strict_types=1);

require dirname(__DIR__) . '/lib/vitals_history.php';

function compact_expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$metric = static fn(float $value): array => [
    'value' => $value,
    'contributors' => array_fill(0, 1000, ['description' => str_repeat('x', 1000)]),
];
$rich = [
    'soma' => [
        'experienced' => [
            'metrics' => [
                'arousal' => $metric(62.5),
                'pain' => $metric(17.0),
                'hunger' => $metric(44.25),
                'anger' => $metric(23.0),
                'rumination' => $metric(81.75),
                'anxiety' => $metric(99.0),
                'fatigue' => $metric(50.0),
                'loneliness' => $metric(31.0),
            ],
            'brain' => [
                'amygdala' => ['value' => 0.61],
                'insula' => ['value' => 0.42],
                'acc' => ['value' => 0.33],
                'hippocampal' => ['value' => 0.24],
                'prefrontal' => ['value' => 0.15],
                'temporalSocial' => ['value' => 0.06],
            ],
        ],
        'operationalAnxiety' => [
            'status' => 'THREAT_IMMINENT',
            'activeConcerns' => array_fill(0, 5000, str_repeat('concern', 100)),
        ],
        'sleepHomeostasis' => ['sleepPressure' => 0.7123456789, 'history' => array_fill(0, 5000, 1)],
        'predictedSleepiness' => ['predictedKss' => 7.23456789, 'inspection' => str_repeat('z', 1000000)],
        'physiologicalSatiety' => ['headline' => [
            'status' => 'ESTIMATE_AVAILABLE',
            'estimate' => 4.7,
            'central95' => ['lower' => 4.3, 'upper' => 5.1],
        ], 'intakeHistory' => array_fill(0, 5000, str_repeat('meal', 100))],
        'circadianProcessC' => [
            'processCEstimate' => -0.123456,
            'processCMin' => -0.234567,
            'processCMax' => -0.012345,
            'history' => array_fill(0, 5000, str_repeat('phase', 100)),
        ],
        'somaticNociceptive' => [
            'headline' => ['activeInjuryCount' => 12],
            'activeInjuries' => array_fill(0, 5000, str_repeat('injury', 100)),
        ],
        'memory' => ['episodes' => array_fill(0, 5000, str_repeat('memory', 100))],
        'learnedControllability' => ['contingencies' => array_fill(0, 5000, str_repeat('learned', 100))],
    ],
    'relations' => array_fill(0, 5000, str_repeat('relation', 100)),
];

$compact = captive_compact_vitals_history_payload($rich);
$json = captive_compact_vitals_history_json($rich);
$typicalBytes = strlen($json);

compact_expect(array_keys($compact) === [
    'metrics', 'brain', 'anxiety', 'sleepPressure', 'predictedKss',
    'satiety', 'processC', 'activeInjuryCount',
], 'compact history contains an unexpected top-level field');
compact_expect(array_keys($compact['metrics']) === CAPTIVE_VITALS_HISTORY_METRICS,
    'compact history does not contain exactly the five charted readings');
compact_expect(array_keys($compact['brain']) === CAPTIVE_VITALS_HISTORY_BRAIN_REGIONS,
    'compact history does not contain exactly the six charted brain readings');
compact_expect($compact['anxiety'] === 'THREAT_IMMINENT', 'categorical Anxiety was not preserved');
compact_expect($compact['processC'] === [
    'estimate' => -0.123456, 'minimum' => -0.234567, 'maximum' => -0.012345,
], 'stored Process C sample or uncertainty range was not preserved');
compact_expect($compact['satiety'] === [
    'status' => 'ESTIMATE_AVAILABLE', 'estimate' => 4.7, 'minimum' => 4.3, 'maximum' => 5.1,
], 'satiety status, estimate, or range was not preserved');
compact_expect($typicalBytes < 1024, "compact history row exceeded 1 KiB: $typicalBytes");
compact_expect(!str_contains($json, 'memory')
    && !str_contains($json, 'history')
    && !str_contains($json, 'contributors')
    && !str_contains($json, 'contingencies'),
    'accumulated or durable model state leaked into compact history');

$before = $json;
$rich['soma']['memory']['episodes'][] = str_repeat('new-memory', 100000);
$rich['soma']['currentDefensiveContext']['contexts'] = array_fill(0, 10000, str_repeat('context', 100));
compact_expect(captive_compact_vitals_history_json($rich) === $before,
    'accumulated memory/context growth changed compact historical telemetry');

$beforeProjectionHash = hash('sha256', serialize($rich));
captive_compact_vitals_history_payload($rich);
compact_expect(hash('sha256', serialize($rich)) === $beforeProjectionHash,
    'history projection mutated recoverable or learned state');

$calibrating = $rich;
unset($calibrating['soma']['physiologicalSatiety']['headline']);
$calibrating['soma']['physiologicalSatiety']['status'] = 'CALIBRATING';
compact_expect(captive_compact_vitals_history_payload($calibrating)['satiety'] === [
    'status' => 'CALIBRATING', 'estimate' => null, 'minimum' => null, 'maximum' => null,
], 'satiety model status was lost while no estimate was available');

$worstCase = $rich;
foreach (CAPTIVE_VITALS_HISTORY_METRICS as $name) {
    $worstCase['soma']['experienced']['metrics'][$name]['value'] = PHP_FLOAT_MAX;
}
foreach (CAPTIVE_VITALS_HISTORY_BRAIN_REGIONS as $name) {
    $worstCase['soma']['experienced']['brain'][$name]['value'] = -PHP_FLOAT_MAX;
}
$worstCase['soma']['operationalAnxiety']['status'] = 'THREAT_IMMINENT';
$worstCase['soma']['sleepHomeostasis']['sleepPressure'] = PHP_FLOAT_MAX;
$worstCase['soma']['predictedSleepiness']['predictedKss'] = -PHP_FLOAT_MAX;
$worstCase['soma']['physiologicalSatiety']['headline'] = [
    'status' => 'INPUT_INCOMPLETE',
    'estimate' => PHP_FLOAT_MAX,
    'central95' => ['lower' => -PHP_FLOAT_MAX, 'upper' => PHP_FLOAT_MAX],
];
$worstCase['soma']['circadianProcessC'] = [
    'processCEstimate' => PHP_FLOAT_MAX,
    'processCMin' => -PHP_FLOAT_MAX,
    'processCMax' => PHP_FLOAT_MAX,
];
$worstCase['soma']['somaticNociceptive']['headline']['activeInjuryCount'] = 2147483647;
$worstCaseBytes = strlen(captive_compact_vitals_history_json($worstCase));
compact_expect($worstCaseBytes < 1024, "synthetic worst-case compact row exceeded 1 KiB: $worstCaseBytes");
compact_expect($worstCaseBytes * 1440 < 1_500_000, 'raw worst-case one-minute daily history exceeds 1.5 MB');

echo json_encode([
    'typical_bytes' => $typicalBytes,
    'synthetic_worst_case_bytes' => $worstCaseBytes,
    'rows_per_day' => 1440,
    'worst_case_raw_bytes_per_day' => $worstCaseBytes * 1440,
], JSON_UNESCAPED_SLASHES), "\n";
