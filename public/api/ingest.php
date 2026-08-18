<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';
require __DIR__ . '/../../lib/tempo.php';

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
    // Persist Cy's updated standing/memory toward a visitor after he replies.
    // This is private and never enters the public event log or stream.
    $visitorUpd = $db->prepare(
        'UPDATE visitors
         SET warmth = :warmth, suspicion = :suspicion, grudge = :grudge, notes = :notes
         WHERE visitor_id = :id'
    );
    // Persist a completed drawing. Like visitor_seen this is a side-channel: the
    // per-pass `draw` events already carry the animation into the public stream,
    // and this writes the durable record. ON DUPLICATE keeps a re-sent batch
    // idempotent. strokes/mood are bound as strings (no CAST AS JSON in MariaDB).
    $drawInsert = $db->prepare(
        'INSERT INTO drawings (id, ts, title, subject, strokes, mood, stroke_count, requested_by)
         VALUES (:id, :ts, :title, :subject, :strokes, :mood, :stroke_count, :requested_by)
         ON DUPLICATE KEY UPDATE
            strokes = VALUES(strokes), mood = VALUES(mood),
            stroke_count = VALUES(stroke_count), title = VALUES(title),
            subject = VALUES(subject), requested_by = VALUES(requested_by)'
    );
    $inserted = 0;

    foreach ($input['events'] as $event) {
        if (!is_array($event) || !isset($event['ts'], $event['kind'], $event['payload'])) {
            throw new InvalidArgumentException('malformed event');
        }
        $kind = (string)$event['kind'];
        if ($kind === '' || strlen($kind) > 24) {
            throw new InvalidArgumentException('invalid kind');
        }

        // visitor_seen is a side-channel memory update, not a streamed event.
        if ($kind === 'visitor_seen') {
            $p = $event['payload'];
            if (is_array($p) && !empty($p['visitor_id'])) {
                $clamp = static fn($x) => max(0.0, min(1.0, (float)$x));
                $notes = isset($p['notes']) ? mb_substr((string)$p['notes'], 0, 600) : null;
                $visitorUpd->bindValue(':warmth', $clamp($p['warmth'] ?? 0.3));
                $visitorUpd->bindValue(':suspicion', $clamp($p['suspicion'] ?? 0.35));
                $visitorUpd->bindValue(':grudge', $clamp($p['grudge'] ?? 0.05));
                $visitorUpd->bindValue(':notes', $notes, $notes !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
                $visitorUpd->bindValue(':id', (string)$p['visitor_id'], PDO::PARAM_STR);
                $visitorUpd->execute();
            }
            continue;
        }

        // capability is a side-channel runner status update (not streamed): it
        // records whether the runner currently has a DeepSeek key, so the admin
        // switch can refuse a DeepSeek selection with a clear reason when it does
        // not. Idempotent - the runner re-reports on startup and on any change.
        if ($kind === 'capability') {
            $p = $event['payload'];
            if (is_array($p) && array_key_exists('deepseek', $p)) {
                captive_tempo_set_deepseek_available($db, (bool)$p['deepseek']);
            }
            continue;
        }

        // draw_saved is a side-channel record of a finished drawing, not streamed.
        if ($kind === 'draw_saved') {
            $p = $event['payload'];
            if (is_array($p) && !empty($p['id']) && isset($p['strokes'])) {
                $strokesJson = json_encode($p['strokes']);
                $moodJson = isset($p['mood']) ? json_encode($p['mood']) : null;
                if ($strokesJson === false) {
                    throw new InvalidArgumentException('invalid drawing strokes');
                }
                $title = isset($p['title']) ? mb_substr((string)$p['title'], 0, 200) : null;
                $subject = isset($p['subject']) ? mb_substr((string)$p['subject'], 0, 120) : null;
                $requestedBy = !empty($p['requested_by']) ? (string)$p['requested_by'] : null;
                $ts = isset($p['ts']) ? (string)$p['ts'] : (string)$event['ts'];
                $drawInsert->bindValue(':id', (string)$p['id'], PDO::PARAM_STR);
                $drawInsert->bindValue(':ts', $ts, PDO::PARAM_STR);
                $drawInsert->bindValue(':title', $title, $title !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
                $drawInsert->bindValue(':subject', $subject, $subject !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
                $drawInsert->bindValue(':strokes', $strokesJson, PDO::PARAM_STR);
                $drawInsert->bindValue(':mood', $moodJson, $moodJson !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
                $drawInsert->bindValue(':stroke_count', (int)($p['stroke_count'] ?? 0), PDO::PARAM_INT);
                $drawInsert->bindValue(':requested_by', $requestedBy, $requestedBy !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
                $drawInsert->execute();
            }
            continue;
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

    // Record DELL's public IP (this request is X-Cy-Key authenticated, so it is
    // DELL). It backs the automatic same-network admin unlock in lib/admin.php.
    // Deliberately AFTER the commit and self-guarded: a missing ingest_origin
    // table on an un-migrated deploy must never break ingestion.
    captive_admin_record_ingest_ip($db, captive_admin_client_ip());

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
