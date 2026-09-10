<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/soma-history.php';

header('Cache-Control: no-store');

$range = strtolower(trim((string)($_GET['range'] ?? '24h')));
$metric = strtolower(trim((string)($_GET['metric'] ?? 'anxiety')));

try {
    $config = captive_soma_history_config($range, $metric);
    $db = captive_db();
    $toMs = (int)round((float)$db->query('SELECT UNIX_TIMESTAMP(UTC_TIMESTAMP(3)) * 1000')->fetchColumn());
    $fromMs = $toMs - $config['seconds'] * 1000;
    $jsonPath = '$.soma.experienced.metrics.' . $metric . '.value';
    $stmt = $db->prepare(
        "SELECT UNIX_TIMESTAMP(ts) * 1000 AS ts_ms,
                JSON_UNQUOTE(JSON_EXTRACT(payload, '$jsonPath')) AS value
         FROM events
         WHERE kind = 'vitals' AND ts >= FROM_UNIXTIME(?)
         ORDER BY ts ASC"
    );
    $stmt->execute([$fromMs / 1000]);
    $points = captive_soma_history_points($stmt->fetchAll(), $metric, $fromMs, $toMs, $config['points']);
    captive_json_response([
        'ok' => true,
        'metric' => $metric,
        'range' => $range,
        'fromMs' => $fromMs,
        'toMs' => $toMs,
        'points' => $points,
        'sampledFromStoredVitals' => true,
    ]);
} catch (InvalidArgumentException $e) {
    captive_error_response($e->getMessage(), 400);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
