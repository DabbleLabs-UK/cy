<?php
declare(strict_types=1);

const CAPTIVE_SOMA_RANGES = [
    '1h' => ['seconds' => 3600, 'points' => 120],
    '24h' => ['seconds' => 86400, 'points' => 144],
    '7d' => ['seconds' => 604800, 'points' => 168],
];

const CAPTIVE_SOMA_METRICS = [
    'arousal', 'pain', 'hunger', 'anger', 'rumination',
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
            'compactJsonPath' => '$.metrics.' . $key,
            'scale' => 1.0,
        ];
    }
    if ($scope === 'operational-anxiety' && $key === 'anxiety') {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.operationalAnxiety.status',
            'compactJsonPath' => '$.anxiety',
            'categorical' => true,
        ];
    }
    if ($scope === 'brain' && in_array($key, CAPTIVE_SOMA_BRAIN_REGIONS, true)) {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.experienced.brain.' . $key . '.value',
            'compactJsonPath' => '$.brain.' . $key,
            'scale' => 100.0,
        ];
    }
    if ($scope === 'sleep' && $key === 'sleepPressure') {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.sleepHomeostasis.sleepPressure',
            'compactJsonPath' => '$.sleepPressure',
            'scale' => 100.0,
        ];
    }
    if ($scope === 'sleepiness' && $key === 'sleepiness') {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.predictedSleepiness.predictedKss',
            'compactJsonPath' => '$.predictedKss',
            'scale' => 1.0,
        ];
    }
    if ($scope === 'satiety' && $key === 'satiety') {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.physiologicalSatiety.headline.estimate',
            'jsonPathMin' => '$.soma.physiologicalSatiety.headline.central95.lower',
            'jsonPathMax' => '$.soma.physiologicalSatiety.headline.central95.upper',
            'compactJsonPath' => '$.satiety.estimate',
            'compactJsonPathMin' => '$.satiety.minimum',
            'compactJsonPathMax' => '$.satiety.maximum',
            'scale' => 1.0,
        ];
    }
    if ($scope === 'circadian' && $key === 'processC') {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.circadianProcessC.processCEstimate',
            'jsonPathMin' => '$.soma.circadianProcessC.processCMin',
            'jsonPathMax' => '$.soma.circadianProcessC.processCMax',
            'compactJsonPath' => '$.processC.estimate',
            'compactJsonPathMin' => '$.processC.minimum',
            'compactJsonPathMax' => '$.processC.maximum',
            'scale' => 1.0,
            'mathematicallyReconstructed' => false,
            'storedHistoricalSamples' => true,
        ];
    }
    if ($scope === 'somatic' && $key === 'somatic_harm_headline') {
        return CAPTIVE_SOMA_RANGES[$range] + [
            'scope' => $scope,
            'key' => $key,
            'jsonPath' => '$.soma.somaticNociceptive.headline.activeInjuryCount',
            'compactJsonPath' => '$.activeInjuryCount',
            'scale' => 1.0,
        ];
    }
    throw new InvalidArgumentException($scope === 'brain' ? 'unknown Soma brain region' : 'unknown Soma metric');
}

function captive_operational_anxiety_history_points(
    array $rows,
    int $fromMs,
    int $toMs
): array {
    $valid = ['QUIET', 'ANTICIPATING', 'THREAT_IMMINENT', 'THREAT_ONGOING', 'UNKNOWN'];
    $points = [];
    $previous = null;
    foreach ($rows as $row) {
        $state = strtoupper(trim((string)($row['value'] ?? '')));
        if (!in_array($state, $valid, true)) {
            continue;
        }
        $tsMs = captive_soma_row_timestamp_ms($row);
        if ($tsMs === null) continue;
        if ($tsMs < $fromMs || $tsMs > $toMs) {
            continue;
        }
        if ($state === $previous && $points !== []) {
            $points[count($points) - 1]['lastObservedTs'] = $tsMs;
            continue;
        }
        $points[] = ['ts' => $tsMs, 'state' => $state, 'lastObservedTs' => $tsMs];
        $previous = $state;
    }
    return $points;
}

function captive_soma_row_timestamp_ms(array $row): ?int
{
    if (isset($row['ts_ms']) && is_numeric($row['ts_ms'])) {
        return (int)round((float)$row['ts_ms']);
    }
    $rawTs = (string)($row['ts'] ?? '');
    $zone = new DateTimeZone('Europe/London');
    $date = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s.u', $rawTs, $zone)
        ?: DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $rawTs, $zone);
    if ($date === false) return null;
    return $date->getTimestamp() * 1000 + (int)floor((int)$date->format('u') / 1000);
}

function captive_somatic_history_events(array $rows, int $fromMs, int $toMs): array
{
    $events = [];
    foreach ($rows as $row) {
        $record = json_decode((string)($row['record'] ?? ''), true);
        $trace = is_array($record) ? ($record['somatic_nociceptive'] ?? null) : null;
        $event = is_array($trace) ? ($trace['event'] ?? null) : null;
        if (!is_array($event) || ($trace['updated'] ?? false) !== true) {
            continue;
        }
        $timestamp = (string)($event['timestamp'] ?? '');
        $date = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s.u', $timestamp, new DateTimeZone('Europe/London'))
            ?: DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $timestamp, new DateTimeZone('Europe/London'));
        if ($date === false) {
            continue;
        }
        $tsMs = $date->getTimestamp() * 1000 + (int)floor((int)$date->format('u') / 1000);
        if ($tsMs < $fromMs || $tsMs > $toMs) {
            continue;
        }
        $stimulus = is_array($event['stimulus'] ?? null) ? $event['stimulus'] : [];
        $body = is_array($event['body'] ?? null) ? $event['body'] : [];
        $tissue = is_array($event['tissue'] ?? null) ? $event['tissue'] : [];
        $injuryReason = (string)($trace['injuryUpdate']['reason'] ?? '');
        $types = [];
        if (($stimulus['noxiousStimulus'] ?? null) === 'YES') {
            $stimulusStatus = (string)($stimulus['status'] ?? 'UNKNOWN');
            if ($stimulusStatus === 'ACTIVE') {
                $types[] = 'NOXIOUS_STIMULUS_ONSET';
            } elseif ($stimulusStatus === 'ENDED') {
                $types[] = 'NOXIOUS_STIMULUS_END';
            } elseif ($stimulusStatus === 'POINT') {
                $types[] = 'NOXIOUS_STIMULUS';
            }
        }
        if ($injuryReason === 'injury_created') {
            $types[] = 'INJURY_CREATION';
        } elseif ($injuryReason === 'injury_resolved') {
            $types[] = 'INJURY_RESOLUTION';
        } elseif ($injuryReason === 'injury_followup') {
            $types[] = 'INJURY_OBSERVATION';
        }
        foreach (array_values(array_unique($types)) as $type) {
            $events[] = [
                'ts' => $tsMs,
                'type' => $type,
                'bodySite' => (string)($body['site'] ?? 'UNKNOWN'),
                'laterality' => (string)($body['laterality'] ?? 'UNKNOWN'),
                'modality' => (string)($stimulus['modality'] ?? 'UNKNOWN'),
                'tissueDamage' => (string)($tissue['damageStatus'] ?? 'UNKNOWN'),
                'injuryStatus' => (string)($tissue['injuryStatus'] ?? 'UNKNOWN'),
            ];
        }
    }
    usort($events, static fn(array $left, array $right): int => $left['ts'] <=> $right['ts']);
    return $events;
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

// Bridge the immutable legacy vitals rows and the new compact history table.
// Legacy rows are considered only before the first compact sample, so a rolling
// deployment cannot duplicate or reorder a bucket at the cutover boundary.
function captive_combined_soma_history_query(
    string $legacyJsonPath,
    string $compactJsonPath,
    int $bucketSeconds,
    ?string $legacyJsonPathMin = null,
    ?string $legacyJsonPathMax = null,
    ?string $compactJsonPathMin = null,
    ?string $compactJsonPathMax = null
): string {
    $bucketSeconds = max(1, $bucketSeconds);
    $legacyRanges = $legacyJsonPathMin !== null && $legacyJsonPathMax !== null
        ? ", JSON_UNQUOTE(JSON_EXTRACT(e.payload, '$legacyJsonPathMin')) AS minimum,
             JSON_UNQUOTE(JSON_EXTRACT(e.payload, '$legacyJsonPathMax')) AS maximum"
        : ', NULL AS minimum, NULL AS maximum';
    $compactRanges = $compactJsonPathMin !== null && $compactJsonPathMax !== null
        ? ", JSON_UNQUOTE(JSON_EXTRACT(h.payload, '$compactJsonPathMin')) AS minimum,
             JSON_UNQUOTE(JSON_EXTRACT(h.payload, '$compactJsonPathMax')) AS maximum"
        : ', NULL AS minimum, NULL AS maximum';
    return "SELECT combined.ts, combined.value, combined.minimum, combined.maximum
            FROM (
                SELECT e.ts,
                       JSON_UNQUOTE(JSON_EXTRACT(e.payload, '$legacyJsonPath')) AS value
                       $legacyRanges
                FROM events e
                JOIN (
                    SELECT MAX(seq) AS seq
                    FROM events FORCE INDEX (idx_kind_ts)
                    WHERE kind = 'vitals' AND ts >= ?
                      AND ts < COALESCE(
                          (SELECT MIN(observed_at) FROM vitals_history),
                          '9999-12-31 23:59:59.999'
                      )
                    GROUP BY FLOOR(UNIX_TIMESTAMP(ts) / $bucketSeconds)
                ) legacy_sampled ON legacy_sampled.seq = e.seq
                UNION ALL
                SELECT h.observed_at AS ts,
                       JSON_UNQUOTE(JSON_EXTRACT(h.payload, '$compactJsonPath')) AS value
                       $compactRanges
                FROM vitals_history h
                JOIN (
                    SELECT MAX(observed_at) AS observed_at
                    FROM vitals_history
                    WHERE schema_version = 1 AND observed_at >= ?
                    GROUP BY FLOOR(UNIX_TIMESTAMP(observed_at) / $bucketSeconds)
                ) compact_sampled ON compact_sampled.observed_at = h.observed_at
                WHERE h.schema_version = 1
            ) combined
            ORDER BY combined.ts ASC";
}

// Finds the single most recent (before) or earliest (after) qualifying
// operational-Anxiety reading across the two storage generations, without
// ever scanning more than a handful of rows regardless of total history size.
//
// The previous version wrapped both branches in a single derived table and
// applied ORDER BY/LIMIT only to the OUTER query. Neither MySQL nor MariaDB
// can push a LIMIT from an outer UNION query down into its member SELECTs, so
// the optimizer had to materialize every legacy 'vitals' row on the matching
// side of the comparison (unbounded - it grows with total history, not with
// the requested window) and filesort the whole thing just to keep one row.
// EXPLAIN showed this touching ~719K rows even for a 1H request.
//
// The fix: give EACH branch its own ORDER BY + LIMIT 1, wrapped in
// parentheses so it scopes to that branch only. That lets each branch use its
// existing covering index (idx_kind_ts / idx_vitals_history_schema_time) as a
// direct indexed seek to the one qualifying row it contributes - "seek to the
// last (or first) row where kind='vitals' AND ts < X", not "collect every
// such row". The outer query then only ever compares AT MOST two candidate
// rows (one per branch) and picks the correct one - the same semantics as
// before (latest non-null reading before the window, or earliest non-null
// reading at/after it, whichever storage generation actually has it), just
// reached without materializing the legacy table. The non-null filter moves
// into each branch's WHERE clause (rather than only the outer query) because
// with a per-branch LIMIT 1 in place, a branch's single candidate must
// already be non-null for the outer choice between branches to be correct -
// this is required for the rewrite to preserve the original result, not an
// incidental change; in practice every persisted vitals/vitals_history row
// carries a resolved Anxiety status, so this defensive filter is not expected
// to ever exclude a real row.
function captive_operational_anxiety_boundary_query(bool $before): string
{
    $operator = $before ? '<' : '>=';
    $direction = $before ? 'DESC' : 'ASC';
    return "SELECT boundary.ts, boundary.value
            FROM (
                (SELECT e.ts,
                        JSON_UNQUOTE(JSON_EXTRACT(e.payload, '$.soma.operationalAnxiety.status')) AS value
                 FROM events e FORCE INDEX (idx_kind_ts)
                 WHERE e.kind = 'vitals' AND e.ts $operator ?
                   AND e.ts < COALESCE(
                       (SELECT MIN(observed_at) FROM vitals_history),
                       '9999-12-31 23:59:59.999'
                   )
                   AND JSON_EXTRACT(e.payload, '$.soma.operationalAnxiety.status') IS NOT NULL
                 ORDER BY e.ts $direction
                 LIMIT 1)
                UNION ALL
                (SELECT h.observed_at AS ts,
                        JSON_UNQUOTE(JSON_EXTRACT(h.payload, '$.anxiety')) AS value
                 FROM vitals_history h
                 WHERE h.schema_version = 1 AND h.observed_at $operator ?
                   AND JSON_EXTRACT(h.payload, '$.anxiety') IS NOT NULL
                 ORDER BY h.observed_at $direction
                 LIMIT 1)
            ) boundary
            WHERE boundary.value IS NOT NULL
            ORDER BY boundary.ts $direction
            LIMIT 1";
}

// Transitions within the requested window, for the operational-Anxiety
// chart's step line. Reads occurred_at and the Anxiety status from the
// generated/indexed operational_anxiety_status column (migration 021)
// instead of JSON_EXTRACT-ing environment_events.record inline: that JSON
// document averages ~650KB/row (the table is ~1GB across only ~2,500 rows),
// so filtering on it directly forced MariaDB to read and parse the full
// record of every row in the requested range just to keep one short status
// string - measured at ~20-27s for a 7-day window alone. Reading the small
// generated column via its own covering index (idx_environment_anxiety)
// resolves the same rows without ever touching `record`. The column must be
// STORED (see migration 021) - a VIRTUAL column read back through this same
// covering index reproducibly returned NULL for every row on this MariaDB
// version, verified by diffing this query's output against the pre-migration
// inline JSON_EXTRACT query row-for-row before this was trusted in production.
function captive_operational_anxiety_transition_query(): string
{
    return "SELECT occurred_at AS ts, operational_anxiety_status AS value
            FROM environment_events FORCE INDEX (idx_environment_anxiety)
            WHERE occurred_at >= ?
              AND operational_anxiety_status IS NOT NULL
            ORDER BY occurred_at ASC, event_id ASC";
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
                $headline = $payload['soma']['physiologicalSatiety']['headline'] ?? null;
                if (is_array($headline) && ($headline['status'] ?? null) === 'ESTIMATE_AVAILABLE') {
                    $value = $headline['estimate'] ?? null;
                    $row['minimum'] = $headline['central95']['lower'] ?? null;
                    $row['maximum'] = $headline['central95']['upper'] ?? null;
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
        $digits = in_array($scope, ['satiety', 'circadian'], true) ? ($scope === 'circadian' ? 6 : 3) : 1;
        $point = ['ts' => $tsMs, 'value' => round((float)$value * $scale, $digits)];
        if (in_array($scope, ['satiety', 'circadian'], true)
            && is_numeric($row['minimum'] ?? null) && is_numeric($row['maximum'] ?? null)) {
            $point['minimum'] = round((float)$row['minimum'] * $scale, $digits);
            $point['maximum'] = round((float)$row['maximum'] * $scale, $digits);
        } elseif (in_array($scope, ['satiety', 'circadian'], true)) {
            continue;
        }
        $buckets[$bucket] = $point;
    }
    ksort($buckets, SORT_NUMERIC);
    return array_values($buckets);
}
