<?php
declare(strict_types=1);

const CAPTIVE_VITALS_HISTORY_SCHEMA_VERSION = 1;
const CAPTIVE_VITALS_HISTORY_METRICS = [
    'arousal', 'pain', 'hunger', 'anger', 'rumination',
];
const CAPTIVE_VITALS_HISTORY_BRAIN_REGIONS = [
    'amygdala', 'insula', 'acc', 'hippocampal', 'prefrontal', 'temporalSocial',
];
const CAPTIVE_VITALS_HISTORY_ANXIETY_STATES = [
    'QUIET', 'ANTICIPATING', 'THREAT_IMMINENT', 'THREAT_ONGOING', 'UNKNOWN',
];
const CAPTIVE_VITALS_HISTORY_SATIETY_STATES = [
    'ESTIMATE_AVAILABLE', 'INPUT_UNCERTAIN', 'INPUT_INCOMPLETE', 'CALIBRATING', 'LIVE', 'UNKNOWN',
];

function captive_vitals_history_number(mixed $value): ?float
{
    if (!is_int($value) && !is_float($value)) {
        return null;
    }
    $number = (float)$value;
    return is_finite($number) ? $number : null;
}

function captive_vitals_history_enum(mixed $value, array $allowed): string
{
    $candidate = is_string($value) ? strtoupper(trim($value)) : 'UNKNOWN';
    return in_array($candidate, $allowed, true) ? $candidate : 'UNKNOWN';
}

// Project one rich current-state payload into the complete permanent time-series
// contract. No descriptions, contributors, memories, ledgers or recovery state
// are copied. Adding accumulated state to the source therefore cannot grow this
// record.
function captive_compact_vitals_history_payload(array $payload): array
{
    $soma = is_array($payload['soma'] ?? null) ? $payload['soma'] : [];
    $experienced = is_array($soma['experienced'] ?? null) ? $soma['experienced'] : [];
    $metricsSource = is_array($experienced['metrics'] ?? null) ? $experienced['metrics'] : [];
    $brainSource = is_array($experienced['brain'] ?? null) ? $experienced['brain'] : [];

    $metrics = [];
    foreach (CAPTIVE_VITALS_HISTORY_METRICS as $name) {
        $metrics[$name] = captive_vitals_history_number($metricsSource[$name]['value'] ?? null);
    }

    $brain = [];
    foreach (CAPTIVE_VITALS_HISTORY_BRAIN_REGIONS as $name) {
        $brain[$name] = captive_vitals_history_number($brainSource[$name]['value'] ?? null);
    }

    $satiety = is_array($soma['physiologicalSatiety']['headline'] ?? null)
        ? $soma['physiologicalSatiety']['headline']
        : [];
    $satietyRange = is_array($satiety['central95'] ?? null) ? $satiety['central95'] : [];
    $processC = is_array($soma['circadianProcessC'] ?? null) ? $soma['circadianProcessC'] : [];

    return [
        'metrics' => $metrics,
        'brain' => $brain,
        'anxiety' => captive_vitals_history_enum(
            $soma['operationalAnxiety']['status'] ?? null,
            CAPTIVE_VITALS_HISTORY_ANXIETY_STATES
        ),
        'sleepPressure' => captive_vitals_history_number(
            $soma['sleepHomeostasis']['sleepPressure'] ?? null
        ),
        'predictedKss' => captive_vitals_history_number(
            $soma['predictedSleepiness']['predictedKss'] ?? null
        ),
        'satiety' => [
            'status' => captive_vitals_history_enum(
                $satiety['status'] ?? ($soma['physiologicalSatiety']['status'] ?? null),
                CAPTIVE_VITALS_HISTORY_SATIETY_STATES
            ),
            'estimate' => captive_vitals_history_number($satiety['estimate'] ?? null),
            'minimum' => captive_vitals_history_number($satietyRange['lower'] ?? null),
            'maximum' => captive_vitals_history_number($satietyRange['upper'] ?? null),
        ],
        'processC' => [
            'estimate' => captive_vitals_history_number($processC['processCEstimate'] ?? null),
            'minimum' => captive_vitals_history_number($processC['processCMin'] ?? null),
            'maximum' => captive_vitals_history_number($processC['processCMax'] ?? null),
        ],
        'activeInjuryCount' => max(0, (int)(
            captive_vitals_history_number(
                $soma['somaticNociceptive']['headline']['activeInjuryCount'] ?? null
            ) ?? 0
        )),
    ];
}

function captive_compact_vitals_history_json(array $payload): string
{
    $json = json_encode(
        captive_compact_vitals_history_payload($payload),
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION
    );
    if ($json === false) {
        throw new InvalidArgumentException('invalid compact vitals history payload');
    }
    return $json;
}
