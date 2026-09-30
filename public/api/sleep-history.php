<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';

try {
    captive_require_ingest_key();
    $db = captive_db();
    // All structured sleep producers use these event types. The existing
    // (event_type, occurred_at) index avoids scanning every large world record.
    // Project only the small input rather than returning entire world snapshots.
    $stmt = $db->query(
        "SELECT event_id, occurred_at, ROUND(UNIX_TIMESTAMP(occurred_at) * 1000) AS occurred_at_ms,
                JSON_EXTRACT(record, '$.soma_input') AS soma_input
         FROM environment_events
         WHERE event_type IN ('lights_on', 'lights_out', 'noise_night', 'regime_change',
                              'sleep_state_asleep', 'sleep_state_awake')
         ORDER BY occurred_at ASC"
    );
    $records = [];
    foreach ($stmt->fetchAll() as $row) {
        $input = json_decode((string)$row['soma_input'], true);
        if (!is_array($input)) {
            continue;
        }
        $records[] = [
            'event_id' => (string)$row['event_id'],
            'occurred_at' => (string)$row['occurred_at'],
            'occurred_at_ms' => (int)$row['occurred_at_ms'],
            'soma_input' => $input,
        ];
    }
    captive_json_response(['ok' => true, 'records' => $records]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
