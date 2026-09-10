<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';

header('Cache-Control: no-store');

try {
    $db = captive_db();
    if (!captive_is_admin($db)) {
        captive_error_response('not found', 404);
    }
    $stmt = $db->query('SELECT record FROM environment_events ORDER BY occurred_at ASC, event_id ASC');
    $pairs = [];
    $history = [];
    $model = null;
    while (($json = $stmt->fetchColumn()) !== false) {
        $record = json_decode((string)$json, true);
        $trace = is_array($record) ? ($record['threat_learning'] ?? null) : null;
        if (!is_array($trace)) {
            continue;
        }
        if ($model === null) {
            $model = [
                'modelId' => $trace['modelId'] ?? null,
                'modelVersion' => $trace['modelVersion'] ?? null,
                'provenance' => $trace['provenance'] ?? null,
            ];
        }
        foreach ($trace['results'] ?? [] as $result) {
            $update = is_array($result) && ($result['updated'] ?? false) === true
                ? ($result['update'] ?? null) : null;
            if (!is_array($update)) {
                continue;
            }
            $cue = (string)($update['cueId'] ?? '');
            $outcome = (string)($update['outcomeClass'] ?? '');
            if ($cue === '' || $outcome === '') {
                continue;
            }
            $history[] = $update;
            $pairs[$cue . '|' . $outcome] = [
                'cueId' => $cue,
                'cueType' => $update['cueType'] ?? null,
                'outcomeClass' => $outcome,
                'posterior' => $update['after'] ?? null,
                'lastUpdatedAt' => $update['timestamp'] ?? null,
            ];
        }
    }
    captive_json_response([
        'ok' => true,
        'inspection' => [
            'status' => 'IMPLEMENTED',
            'publicLabel' => 'LIVE',
            'model' => $model,
            'pairs' => array_values($pairs),
            'history' => $history,
            'resolvedUpdates' => count($history),
            'note' => 'Exact posteriors reconstructed from stored post-installation update traces. No historical prose was replayed.',
        ],
    ]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
