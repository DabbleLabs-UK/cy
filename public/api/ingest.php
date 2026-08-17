<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        captive_error_response('method not allowed', 405);
    }

    captive_require_ingest_key();

    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input) || !isset($input['events']) || !is_array($input['events'])) {
        captive_error_response('events array required', 422);
    }

    $db = captive_db();
    $db->beginTransaction();

    $insert = $db->prepare('INSERT INTO events (ts, kind, payload) VALUES (:ts, :kind, :payload)');
    $inserted = 0;

    foreach ($input['events'] as $event) {
        if (!is_array($event) || !isset($event['ts'], $event['kind'], $event['payload'])) {
            throw new InvalidArgumentException('malformed event');
        }
        $kind = (string)$event['kind'];
        if ($kind === '' || strlen($kind) > 24) {
            throw new InvalidArgumentException('invalid kind');
        }
        $payloadJson = json_encode($event['payload']);
        if ($payloadJson === false) {
            throw new InvalidArgumentException('invalid payload');
        }

        $insert->bindValue(':ts', (string)$event['ts'], PDO::PARAM_STR);
        $insert->bindValue(':kind', $kind, PDO::PARAM_STR);
        $insert->bindValue(':payload', $payloadJson, PDO::PARAM_STR);
        $insert->execute();
        $inserted++;
    }

    $maxSeq = (int)$db->query('SELECT COALESCE(MAX(seq), 0) FROM events')->fetchColumn();
    $db->commit();

    captive_json_response(['ok' => true, 'inserted' => $inserted, 'now' => $maxSeq]);
} catch (InvalidArgumentException $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    captive_error_response($e->getMessage(), 422);
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    captive_error_response('internal error', 500);
}
