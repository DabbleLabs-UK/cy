<?php
declare(strict_types=1);

const CAPTIVE_SOMA_RANGES = [
    '1h' => ['seconds' => 3600, 'points' => 120],
    '24h' => ['seconds' => 86400, 'points' => 144],
    '7d' => ['seconds' => 604800, 'points' => 168],
];

const CAPTIVE_SOMA_METRICS = [
    'anxiety', 'arousal', 'pain', 'hunger', 'loneliness', 'anger', 'rumination',
];

const CAPTIVE_SOMA_BRAIN_REGIONS = [
    'amygdala', 'insula', 'acc', 'hippocampal', 'prefrontal', 'temporalSocial',
];

const CAPTIVE_PROCESS_C_MODEL_ID = 'borbely-achermann-process-c-five-harmonic';
const CAPTIVE_PROCESS_C_MODEL_VERSION = 'process-c-schedule-estimated-v1';
const CAPTIVE_PROCESS_C_PERIOD_HOURS = 24.0;
const CAPTIVE_PROCESS_C_HARMONICS = [0.97, 0.22, 0.07, 0.03, 0.001];
const CAPTIVE_PROCESS_C_PHASE_RANGE_SCAN_STEPS = 256;
const CAPTIVE_PROCESS_C_ROOT_BISECTION_ITERATIONS = 80;

function captive_soma_history_config(string $range, string $key, string $scope = 'metric'): array
{
    if (!isset(CAPTIVE_SOMA_RANGES[$range])) {
        throw new InvalidArgumentException('range must be 1h, 24h, or 7d');
    }
    if ($scope === 'metric' && in_array($key, CAPTIVE_SOMA_METRICS, true)) {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.experienced.metrics.' . $key . '.value',
            'scale' => 1.0,
        ];
    }
    if ($scope === 'brain' && in_array($key, CAPTIVE_SOMA_BRAIN_REGIONS, true)) {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.experienced.brain.' . $key . '.value',
            'scale' => 100.0,
        ];
    }
    if ($scope === 'sleep' && $key === 'sleepPressure') {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.sleepHomeostasis.sleepPressure',
            'scale' => 100.0,
        ];
    }
    if ($scope === 'sleepiness' && $key === 'sleepiness') {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.predictedSleepiness.predictedKss',
            'scale' => 1.0,
        ];
    }
    if ($scope === 'satiety' && $key === 'satiety') {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.physiologicalSatiety.current.midpoint',
            'jsonPathMin' => '$.soma.physiologicalSatiety.current.minimum',
            'jsonPathMax' => '$.soma.physiologicalSatiety.current.maximum',
            'scale' => 1.0,
        ];
    }
    if ($scope === 'circadian' && $key === 'processC') {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.circadianProcessC.processCEstimate',
            'scale' => 1.0,
            'mathematicallyReconstructed' => true,
        ];
    }
    throw new InvalidArgumentException($scope === 'brain' ? 'unknown Soma brain region' : 'unknown Soma metric');
}

function captive_soma_history_bucket_seconds(array $config): int
{
    return max(1, (int)ceil((int)$config['seconds'] / max(1, (int)$config['points'])));
}

function captive_soma_history_query(
    string $jsonPath,
    int $bucketSeconds,
    ?string $jsonPathMin = null,
    ?string $jsonPathMax = null
): string
{
    $bucketSeconds = max(1, $bucketSeconds);
    $rangeColumns = $jsonPathMin !== null && $jsonPathMax !== null
        ? ", JSON_UNQUOTE(JSON_EXTRACT(e.payload, '$jsonPathMin')) AS minimum,
             JSON_UNQUOTE(JSON_EXTRACT(e.payload, '$jsonPathMax')) AS maximum"
        : '';
    return "SELECT e.ts, JSON_UNQUOTE(JSON_EXTRACT(e.payload, '$jsonPath')) AS value$rangeColumns
            FROM events e
            JOIN (
                SELECT MAX(seq) AS seq
                FROM events FORCE INDEX (idx_kind_ts)
                WHERE kind = 'vitals' AND ts >= ?
                GROUP BY FLOOR(UNIX_TIMESTAMP(ts) / $bucketSeconds)
            ) sampled ON sampled.seq = e.seq
            ORDER BY e.ts ASC";
}

function captive_circadian_normalize_hour(float $hours): float
{
    $value = fmod($hours, CAPTIVE_PROCESS_C_PERIOD_HOURS);
    return $value < 0.0 ? $value + CAPTIVE_PROCESS_C_PERIOD_HOURS : $value;
}

function captive_process_c_value(float $clockHours, float $phiHours, array $harmonics): float
{
    $phase = 2.0 * M_PI * ($clockHours - $phiHours) / CAPTIVE_PROCESS_C_PERIOD_HOURS;
    $value = 0.0;
    foreach ($harmonics as $index => $coefficient) {
        $value += (float)$coefficient * sin(((int)$index + 1) * $phase);
    }
    return $value;
}

function captive_process_c_derivative(float $clockHours, float $phiHours, array $harmonics): float
{
    $phase = 2.0 * M_PI * ($clockHours - $phiHours) / CAPTIVE_PROCESS_C_PERIOD_HOURS;
    $value = 0.0;
    foreach ($harmonics as $index => $coefficient) {
        $harmonic = (int)$index + 1;
        $value += (float)$coefficient * (2.0 * M_PI * $harmonic / CAPTIVE_PROCESS_C_PERIOD_HOURS) * cos($harmonic * $phase);
    }
    return $value;
}

function captive_process_c_phase_range(float $clockHours, float $startPhi, float $width, array $harmonics): array
{
    // ENGINEERING / NUMERICAL: matches the locked model specification and the
    // runner root finder. These values cannot change the published waveform.
    $steps = CAPTIVE_PROCESS_C_PHASE_RANGE_SCAN_STEPS;
    $iterations = CAPTIVE_PROCESS_C_ROOT_BISECTION_ITERATIONS;
    $candidates = [$startPhi, $startPhi + $width];
    $left = $startPhi;
    $fLeft = captive_process_c_derivative($clockHours, $left, $harmonics);
    for ($index = 1; $index <= $steps; $index++) {
        $right = $startPhi + $width * $index / $steps;
        $fRight = captive_process_c_derivative($clockHours, $right, $harmonics);
        if ($fLeft == 0.0) {
            $candidates[] = $left;
        }
        if ($fRight == 0.0) {
            $candidates[] = $right;
        }
        if ($fLeft != 0.0 && $fRight != 0.0 && (($fLeft < 0.0) !== ($fRight < 0.0))) {
            $lo = $left;
            $hi = $right;
            $fLo = $fLeft;
            for ($iteration = 0; $iteration < $iterations; $iteration++) {
                $mid = ($lo + $hi) / 2.0;
                $fMid = captive_process_c_derivative($clockHours, $mid, $harmonics);
                if (($fLo < 0.0) === ($fMid < 0.0)) {
                    $lo = $mid;
                    $fLo = $fMid;
                } else {
                    $hi = $mid;
                }
            }
            $candidates[] = ($lo + $hi) / 2.0;
        }
        $left = $right;
        $fLeft = $fRight;
    }
    $values = array_map(
        static fn(float $phi): float => captive_process_c_value($clockHours, $phi, $harmonics),
        $candidates
    );
    return ['minimum' => min($values), 'maximum' => max($values)];
}

function captive_circadian_clock_hours(int $timestampMs, string $timeZone): float
{
    $seconds = (int)floor($timestampMs / 1000);
    $milliseconds = $timestampMs - $seconds * 1000;
    $date = (new DateTimeImmutable('@' . (string)$seconds))->setTimezone(new DateTimeZone($timeZone));
    return (int)$date->format('H') + (int)$date->format('i') / 60.0
        + (int)$date->format('s') / 3600.0 + $milliseconds / 3600000.0;
}

function captive_circadian_history_points(
    array $circadian,
    int $fromMs,
    int $toMs,
    int $maximum
): array {
    if (($circadian['modelId'] ?? null) !== CAPTIVE_PROCESS_C_MODEL_ID
        || ($circadian['modelVersion'] ?? null) !== CAPTIVE_PROCESS_C_MODEL_VERSION
        || ($circadian['phaseBasis'] ?? null) !== 'habitual_schedule_estimate') {
        return [];
    }
    $harmonics = $circadian['harmonics'] ?? null;
    $phi = $circadian['phiInterval'] ?? null;
    $timeZone = (string)($circadian['schedule']['timeZone'] ?? '');
    if ($harmonics !== CAPTIVE_PROCESS_C_HARMONICS || !is_array($phi)
        || !is_numeric($phi['startHour'] ?? null) || !is_numeric($phi['durationHours'] ?? null)
        || $timeZone === '') {
        return [];
    }
    $points = [];
    $count = max(2, $maximum);
    $span = max(1, $toMs - $fromMs);
    for ($index = 0; $index < $count; $index++) {
        $timestampMs = (int)round($fromMs + $span * $index / ($count - 1));
        $clockHours = captive_circadian_clock_hours($timestampMs, $timeZone);
        $estimate = captive_process_c_value($clockHours, (float)$phi['midpointHour'], CAPTIVE_PROCESS_C_HARMONICS);
        $range = captive_process_c_phase_range(
            $clockHours,
            (float)$phi['startHour'],
            (float)$phi['durationHours'],
            CAPTIVE_PROCESS_C_HARMONICS
        );
        $points[] = [
            'ts' => $timestampMs,
            'value' => round($estimate, 6),
            'minimum' => round($range['minimum'], 6),
            'maximum' => round($range['maximum'], 6),
        ];
    }
    return $points;
}

function captive_soma_history_points(
    array $rows,
    string $key,
    int $fromMs,
    int $toMs,
    int $maximum,
    string $scope = 'metric',
    float $scale = 1.0
): array
{
    $span = max(1, $toMs - $fromMs);
    $bucketMs = max(1, (int)ceil($span / max(1, $maximum)));
    $buckets = [];
    foreach ($rows as $row) {
        $value = $row['value'] ?? null;
        if ($value === null && isset($row['payload'])) {
            $payload = json_decode((string)$row['payload'], true);
            if ($scope === 'sleep') {
                $value = $payload['soma']['sleepHomeostasis']['sleepPressure'] ?? null;
            } elseif ($scope === 'sleepiness') {
                $value = $payload['soma']['predictedSleepiness']['predictedKss'] ?? null;
            } elseif ($scope === 'circadian') {
                $value = $payload['soma']['circadianProcessC']['processCEstimate'] ?? null;
            } elseif ($scope === 'satiety') {
                $current = $payload['soma']['physiologicalSatiety']['current'] ?? null;
                if (is_array($current)) {
                    $value = $current['midpoint'] ?? null;
                    $row['minimum'] = $current['minimum'] ?? null;
                    $row['maximum'] = $current['maximum'] ?? null;
                }
            } else {
                $group = $scope === 'brain' ? 'brain' : 'metrics';
                $value = $payload['soma']['experienced'][$group][$key]['value'] ?? null;
            }
        }
        if (!is_numeric($value)) {
            continue;
        }
        if (isset($row['ts_ms']) && is_numeric($row['ts_ms'])) {
            $tsMs = (int)round((float)$row['ts_ms']);
        } else {
            $rawTs = (string)($row['ts'] ?? '');
            $zone = new DateTimeZone('Europe/London');
            $date = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s.u', $rawTs, $zone)
                ?: DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $rawTs, $zone);
            if ($date === false) {
                continue;
            }
            $tsMs = $date->getTimestamp() * 1000 + (int)floor((int)$date->format('u') / 1000);
        }
        if ($tsMs < $fromMs || $tsMs > $toMs) {
            continue;
        }
        $bucket = (int)floor(($tsMs - $fromMs) / $bucketMs);
        // Keep the last real reading in each bucket. No interpolation or fake
        // samples are introduced when the runner was offline.
        $digits = $scope === 'satiety' ? 3 : 1;
        $point = ['ts' => $tsMs, 'value' => round((float)$value * $scale, $digits)];
        if ($scope === 'satiety' && is_numeric($row['minimum'] ?? null) && is_numeric($row['maximum'] ?? null)) {
            $point['minimum'] = round((float)$row['minimum'] * $scale, 3);
            $point['maximum'] = round((float)$row['maximum'] * $scale, 3);
        } elseif ($scope === 'satiety') {
            continue;
        }
        $buckets[$bucket] = $point;
    }
    ksort($buckets, SORT_NUMERIC);
    return array_values($buckets);
}
