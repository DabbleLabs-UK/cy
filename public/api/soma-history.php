<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/soma-history.php';

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
    if ($scope === 'circadian') {
        $latest = $db->query("SELECT payload FROM events WHERE kind = 'vitals' ORDER BY seq DESC LIMIT 1")->fetch();
        $payload = $latest ? json_decode((string)$latest['payload'], true) : null;
        $circadian = is_array($payload) && isset($payload['soma']['circadianProcessC'])
            && is_array($payload['soma']['circadianProcessC'])
            ? $payload['soma']['circadianProcessC']
            : [];
        $points = captive_circadian_history_points(
            $circadian,
            $fromMs,
            $toMs,
            $config['points']
        );
        captive_json_response([
            'ok' => true,
            'scope' => $scope,
            'key' => $key,
            'range' => $range,
            'fromMs' => $fromMs,
            'toMs' => $toMs,
            'points' => $points,
            'sampledFromStoredVitals' => false,
            'mathematicallyReconstructed' => true,
            'phaseBasisSource' => 'latest stored habitual schedule estimate',
            'directBiologicalPhaseObserved' => false,
            'waveformRange' => $circadian['waveformRange'] ?? null,
        ]);
    }
    $jsonPath = $config['jsonPath'];
    $stmt = $db->prepare(captive_soma_history_query(
        $jsonPath,
        captive_soma_history_bucket_seconds($config),
        $config['jsonPathMin'] ?? null,
        $config['jsonPathMax'] ?? null
    ));
    $stmt->execute([$fromSql]);
    $points = captive_soma_history_points(
        $stmt->fetchAll(),
        $key,
        $fromMs,
        $toMs,
        $config['points'],
        $scope,
        $config['scale']
    );
    captive_json_response([
        'ok' => true,
        'scope' => $scope,
        'key' => $key,
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
