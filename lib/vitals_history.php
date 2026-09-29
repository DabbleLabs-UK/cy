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
    // The model is LIVE (tracks exist) far more often than it has an exact
    // observed composition, so headline.estimate/central95 (only set when
    // ESTIMATE_AVAILABLE) leaves this permanently null for the common
    // scenario-bounded case - the model still computes a real scenario
    // envelope then, it's just never captured. Fall back to it, but only
    // when the model's own artefact check (ghrelin outside the physical
    // domain - see physiological-satiety.js ghrelinPublicSummary) hasn't
    // flagged the scenarios as numerically degenerate; a saturated/invalid
    // model state must stay absent rather than be recorded as a real range.
    $satietyEnvelope = is_array($soma['physiologicalSatiety']['scenarioEnvelope'] ?? null)
        ? $soma['physiologicalSatiety']['scenarioEnvelope']
        : [];
    $satietyScenarios = is_array($soma['physiologicalSatiety']['scenarios'] ?? null)
        ? $soma['physiologicalSatiety']['scenarios']
        : [];
    $satietyScenariosTrustworthy = $satietyScenarios !== [] && !array_any(
        $satietyScenarios,
        static fn(mixed $scenario): bool => is_array($scenario)
            && is_array($scenario['ghrelin'] ?? null)
            && ($scenario['ghrelin']['status'] ?? null) === 'MODEL_ARTEFACT_OUTSIDE_PHYSICAL_DOMAIN'
    );
    $satietyEnvelopeMin = $satietyScenariosTrustworthy
        ? captive_vitals_history_number($satietyEnvelope['minimumScenarioMedian'] ?? null) : null;
    $satietyEnvelopeMax = $satietyScenariosTrustworthy
        ? captive_vitals_history_number($satietyEnvelope['maximumScenarioMedian'] ?? null) : null;
    $satietyEnvelopeMid = ($satietyEnvelopeMin !== null && $satietyEnvelopeMax !== null)
        ? round(($satietyEnvelopeMin + $satietyEnvelopeMax) / 2, 3)
        : null;
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
            'estimate' => captive_vitals_history_number($satiety['estimate'] ?? null) ?? $satietyEnvelopeMid,
            'minimum' => captive_vitals_history_number($satietyRange['lower'] ?? null) ?? $satietyEnvelopeMin,
            'maximum' => captive_vitals_history_number($satietyRange['upper'] ?? null) ?? $satietyEnvelopeMax,
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
