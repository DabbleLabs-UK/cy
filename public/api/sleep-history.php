<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';

try {
    captive_require_ingest_key();
    $db = captive_db();
    $stmt = $db->query(
        "SELECT event_id, occurred_at, ROUND(UNIX_TIMESTAMP(occurred_at) * 1000) AS occurred_at_ms, record
         FROM environment_events
         WHERE JSON_UNQUOTE(JSON_EXTRACT(record, '$.soma_input.sleep_period'))
                   IN ('sleep_period', 'asleep', 'sleep', 'awake', 'waking', 'forced_wakefulness', 'interrupted')
            OR JSON_UNQUOTE(JSON_EXTRACT(record, '$.soma_input.sleep_interruption')) = 'present'
         ORDER BY occurred_at ASC"
    );
    $records = [];
    foreach ($stmt->fetchAll() as $row) {
        $record = json_decode((string)$row['record'], true);
        if (!is_array($record) || !is_array($record['soma_input'] ?? null)) {
            continue;
        }
        $records[] = [
            'event_id' => (string)$row['event_id'],
            'occurred_at' => (string)$row['occurred_at'],
            'occurred_at_ms' => (int)$row['occurred_at_ms'],
            'soma_input' => $record['soma_input'],
        ];
    }
    captive_json_response(['ok' => true, 'records' => $records]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
