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
    $contexts = [];
    $history = [];
    $model = null;
    while (($json = $stmt->fetchColumn()) !== false) {
        $record = json_decode((string)$json, true);
        $trace = is_array($record) ? ($record['current_defensive_context'] ?? null) : null;
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
        foreach ($trace['transitions'] ?? [] as $transition) {
            if (!is_array($transition)) {
                continue;
            }
            $key = (string)($transition['contextKey'] ?? '');
            if ($key === '') {
                continue;
            }
            $history[] = $transition;
            $contexts[$key] = $transition;
        }
    }
    $current = array_values($contexts);
    $active = array_values(array_filter(
        $current,
        static fn(array $context): bool => ($context['active'] ?? false) === true
    ));
    captive_json_response([
        'ok' => true,
        'inspection' => [
            'status' => 'IMPLEMENTED',
            'publicLabel' => 'LIVE',
            'model' => $model,
            'activeContexts' => $active,
            'contexts' => $current,
            'history' => $history,
            'note' => 'Exact event-driven context transitions reconstructed from stored post-installation traces. No journal prose was interpreted or replayed.',
        ],
    ]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
