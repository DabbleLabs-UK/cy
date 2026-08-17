<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';

header('Cache-Control: no-store');

try {
    $db = captive_db();

    $since = isset($_GET['since']) ? (int)$_GET['since'] : 0;
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 500;
    if ($limit < 1 || $limit > 500) {
        $limit = 500;
    }

    if ($since < 0) {
        $count = min(abs($since), 500);
        $stmt = $db->prepare('SELECT seq, ts, kind, payload FROM events ORDER BY seq DESC LIMIT :limit');
        $stmt->bindValue(':limit', $count, PDO::PARAM_INT);
        $stmt->execute();
        $rows = array_reverse($stmt->fetchAll());
    } else {
        $stmt = $db->prepare('SELECT seq, ts, kind, payload FROM events WHERE seq > :since ORDER BY seq ASC LIMIT :limit');
        $stmt->bindValue(':since', $since, PDO::PARAM_INT);
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll();
    }

    $events = array_map(static function (array $row): array {
        return [
            'seq' => (int)$row['seq'],
            'ts' => $row['ts'],
            'kind' => $row['kind'],
            'payload' => json_decode($row['payload'], true),
        ];
    }, $rows);

    $maxSeq = (int)$db->query('SELECT COALESCE(MAX(seq), 0) FROM events')->fetchColumn();

    captive_json_response(['now' => $maxSeq, 'events' => $events]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
