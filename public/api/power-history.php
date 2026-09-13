<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/power-history.php';

header('Cache-Control: no-store');

try {
    $db = captive_db();
    $now = new DateTimeImmutable('now', new DateTimeZone('Europe/London'));
    $cutoff = captive_power_history_cutoff($now);

    // Read newest-first so the hard safety cap always retains the most recent
    // part of the rolling window. Reverse before returning for chronological use.
    $stmt = $db->prepare(
        "SELECT seq, ts, payload
         FROM events FORCE INDEX (idx_kind_ts)
         WHERE kind = 'power' AND ts >= :cutoff
         ORDER BY seq DESC
         LIMIT " . CAPTIVE_POWER_HISTORY_MAX_ROWS
    );
    $stmt->execute([':cutoff' => $cutoff]);
    $rows = array_reverse($stmt->fetchAll());
    $events = array_map(static function (array $row): array {
        return [
            'seq' => (int)$row['seq'],
            'ts' => $row['ts'],
            'kind' => 'power',
            'payload' => captive_public_event_payload(
                'power',
                json_decode((string)$row['payload'], true)
            ),
        ];
    }, $rows);

    captive_json_response([
        'ok' => true,
        'windowMinutes' => CAPTIVE_POWER_HISTORY_MINUTES,
        'from' => $cutoff,
        'to' => $now->format('Y-m-d H:i:s.u'),
        'events' => $events,
    ]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}

