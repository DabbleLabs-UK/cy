<?php
declare(strict_types=1);

const CAPTIVE_SOMA_RANGES = [
    '1h' => ['seconds' => 3600, 'points' => 120],
    '24h' => ['seconds' => 86400, 'points' => 144],
    '7d' => ['seconds' => 604800, 'points' => 168],
];

const CAPTIVE_SOMA_METRICS = [
    'anxiety', 'arousal', 'pain', 'hunger', 'fatigue', 'loneliness', 'anger', 'rumination',
];

function captive_soma_history_config(string $range, string $metric): array
{
    if (!isset(CAPTIVE_SOMA_RANGES[$range])) {
        throw new InvalidArgumentException('range must be 1h, 24h, or 7d');
    }
    if (!in_array($metric, CAPTIVE_SOMA_METRICS, true)) {
        throw new InvalidArgumentException('unknown Soma metric');
    }
    return CAPTIVE_SOMA_RANGES[$range];
}

function captive_soma_history_points(array $rows, string $metric, int $fromMs, int $toMs, int $maximum): array
{
    $span = max(1, $toMs - $fromMs);
    $bucketMs = max(1, (int)ceil($span / max(1, $maximum)));
    $buckets = [];
    foreach ($rows as $row) {
        $value = $row['value'] ?? null;
        if ($value === null && isset($row['payload'])) {
            $payload = json_decode((string)$row['payload'], true);
            $value = $payload['soma']['experienced']['metrics'][$metric]['value'] ?? null;
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
        $buckets[$bucket] = ['ts' => $tsMs, 'value' => round((float)$value, 1)];
    }
    ksort($buckets, SORT_NUMERIC);
    return array_values($buckets);
}
