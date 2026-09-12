<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/presence.php';

header('Cache-Control: no-store');

const STREAM_MAX_LIMIT = 100;

try {
    $db = captive_db();

    // Freeze every page at one head before selecting rows. The caller may then
    // safely use `now` as a catch-up baseline: anything inserted while this
    // response is assembled remains beyond the returned head for the next poll.
    $maxSeq = (int)$db->query('SELECT COALESCE(MAX(seq), 0) FROM events')->fetchColumn();

    // record that this poller is a live viewer (throttled, best-effort) so the
    // tempo control knows how many people are watching. Never let a presence
    // hiccup break the feed itself.
    try {
        captive_touch_presence($db);
    } catch (Throwable $e) {
        /* presence is best-effort */
    }

    $since = isset($_GET['since']) ? (int)$_GET['since'] : 0;
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : STREAM_MAX_LIMIT;
    if ($limit < 1) {
        $limit = STREAM_MAX_LIMIT;
    }
    if ($limit > STREAM_MAX_LIMIT) {
        $limit = STREAM_MAX_LIMIT;
    }

    if ($since < 0) {
        $count = min(abs($since), $limit);
        $stmt = $db->prepare('SELECT seq, ts, kind, payload FROM events WHERE seq <= :head ORDER BY seq DESC LIMIT :limit');
        $stmt->bindValue(':head', $maxSeq, PDO::PARAM_INT);
        $stmt->bindValue(':limit', $count, PDO::PARAM_INT);
        $stmt->execute();
        $rows = array_reverse($stmt->fetchAll());
    } else {
        $stmt = $db->prepare('SELECT seq, ts, kind, payload FROM events WHERE seq > :since AND seq <= :head ORDER BY seq ASC LIMIT :limit');
        $stmt->bindValue(':since', $since, PDO::PARAM_INT);
        $stmt->bindValue(':head', $maxSeq, PDO::PARAM_INT);
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll();
    }

    $events = array_map(static function (array $row): array {
        return [
            'seq' => (int)$row['seq'],
            'ts' => $row['ts'],
            'kind' => $row['kind'],
            'payload' => captive_public_event_payload((string)$row['kind'], json_decode($row['payload'], true)),
        ];
    }, $rows);

    captive_json_response(['now' => $maxSeq, 'events' => $events]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
