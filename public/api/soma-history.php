<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/soma-history.php';
require __DIR__ . '/../../lib/live_vitals.php';

header('Cache-Control: private, max-age=5');

$range = strtolower(trim((string)($_GET['range'] ?? '24h')));
$scope = strtolower(trim((string)($_GET['scope'] ?? 'metric')));
// Keep metric= working for older cached clients while the shared reading UI
// uses scope=metric|brain and key=<reading>.
$key = trim((string)($_GET['key'] ?? $_GET['metric'] ?? 'anxiety'));

try {
    $config = captive_soma_history_config($range, $key, $scope);
    $db = captive_db();
    $toMs = (int)round(microtime(true) * 1000);
    $fromMs = $toMs - $config['seconds'] * 1000;
    $fromSql = (new DateTimeImmutable('@' . (string)floor($fromMs / 1000)))
        ->setTimezone(new DateTimeZone('Europe/London'))
        ->format('Y-m-d H:i:s');
    if ($scope === 'somatic') {
        $eventStmt = $db->prepare(
            "SELECT record FROM environment_events
             WHERE occurred_at >= ?
               AND JSON_UNQUOTE(JSON_EXTRACT(record, '$.somatic_nociceptive.updated')) = 'true'
             ORDER BY occurred_at ASC, event_id ASC"
        );
        $eventStmt->execute([$fromSql]);
        $events = captive_somatic_history_events($eventStmt->fetchAll(), $fromMs, $toMs);
        $countStmt = $db->prepare(captive_combined_soma_history_query(
            $config['jsonPath'],
            $config['compactJsonPath'],
            captive_soma_history_bucket_seconds($config)
        ));
        $countStmt->execute([$fromSql, $fromSql]);
        $points = captive_soma_history_points(
            $countStmt->fetchAll(),
            $key,
            $fromMs,
            $toMs,
            $config['points'],
            $scope,
            1.0
        );
        captive_json_response([
            'ok' => true,
            'scope' => $scope,
            'key' => $key,
            'range' => $range,
            'fromMs' => $fromMs,
            'toMs' => $toMs,
            'events' => $events,
            'points' => $events === [] ? [] : $points,
            'axisLabel' => 'ACTIVE INJURIES',
            'sampledFromStoredVitals' => true,
        ]);
    }
    if ($scope === 'operational-anxiety') {
        $baselineStmt = $db->prepare(captive_operational_anxiety_boundary_query(true));
        $baselineStmt->execute([$fromSql, $fromSql]);
        $rows = $baselineStmt->fetchAll();
        if ($rows !== []) {
            $rows[0]['ts_ms'] = $fromMs;
        } else {
            $firstStmt = $db->prepare(captive_operational_anxiety_boundary_query(false));
            $firstStmt->execute([$fromSql, $fromSql]);
            $rows = $firstStmt->fetchAll();
        }
        $transitionStmt = $db->prepare(
            "SELECT occurred_at AS ts,
                    JSON_UNQUOTE(JSON_EXTRACT(record, '$.current_defensive_context.operationalAnxiety.status')) AS value
             FROM environment_events FORCE INDEX (idx_environment_occurred)
             WHERE occurred_at >= ?
               AND JSON_EXTRACT(record, '$.current_defensive_context.operationalAnxiety.status') IS NOT NULL
             ORDER BY occurred_at ASC, event_id ASC"
        );
        $transitionStmt->execute([$fromSql]);
        $rows = array_merge($rows, $transitionStmt->fetchAll());
        usort($rows, static function (array $left, array $right): int {
            return (captive_soma_row_timestamp_ms($left) ?? PHP_INT_MAX)
                <=> (captive_soma_row_timestamp_ms($right) ?? PHP_INT_MAX);
        });
        $points = captive_operational_anxiety_history_points($rows, $fromMs, $toMs);
        captive_json_response([
            'ok' => true,
            'scope' => $scope,
            'key' => $key,
            'range' => $range,
            'fromMs' => $fromMs,
            'toMs' => $toMs,
            'points' => $points,
            'sampledFromStoredVitals' => false,
            'transitionSource' => 'structured environment records with one compact or legacy boundary state',
            'categorical' => true,
            'interpolated' => false,
        ]);
    }
    $stmt = $db->prepare(captive_combined_soma_history_query(
        $config['jsonPath'],
        $config['compactJsonPath'],
        captive_soma_history_bucket_seconds($config),
        $config['jsonPathMin'] ?? null,
        $config['jsonPathMax'] ?? null,
        $config['compactJsonPathMin'] ?? null,
        $config['compactJsonPathMax'] ?? null
    ));
    $stmt->execute([$fromSql, $fromSql]);
    $points = captive_soma_history_points(
        $stmt->fetchAll(),
        $key,
        $fromMs,
        $toMs,
        $config['points'],
        $scope,
        $config['scale']
    );
    $response = [
        'ok' => true,
        'scope' => $scope,
        'key' => $key,
        'range' => $range,
        'fromMs' => $fromMs,
        'toMs' => $toMs,
        'points' => $points,
        'sampledFromStoredVitals' => true,
    ];
    if ($scope === 'circadian') {
        $latest = captive_latest_vitals_row($db);
        $payload = $latest ? json_decode((string)$latest['payload'], true) : null;
        $response['mathematicallyReconstructed'] = false;
        $response['storedHistoricalSamples'] = true;
        $response['directBiologicalPhaseObserved'] = false;
        $response['waveformRange'] = is_array($payload)
            ? ($payload['soma']['circadianProcessC']['waveformRange'] ?? null)
            : null;
    }
    captive_json_response($response);
} catch (InvalidArgumentException $e) {
    captive_error_response($e->getMessage(), 400);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
