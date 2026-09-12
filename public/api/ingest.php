<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';
require __DIR__ . '/../../lib/tempo.php';
require __DIR__ . '/../../lib/postcard_queue.php';
require __DIR__ . '/../../lib/environment_event.php';
require __DIR__ . '/../../lib/world_simulation.php';

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
    $environmentInsert = $db->prepare(
        'INSERT INTO environment_events (event_id, occurred_at, event_type, event_family, record)
         VALUES (:event_id, :occurred_at, :event_type, :event_family, :record)
         ON DUPLICATE KEY UPDATE record = VALUES(record)'
    );
    // Persist Cy's updated standing/memory toward a visitor after he replies.
    // This is private and never enters the public event log or stream.
    $visitorUpd = $db->prepare(
        'UPDATE visitors
         SET warmth = :warmth, suspicion = :suspicion, grudge = :grudge, notes = :notes
         WHERE visitor_id = :id'
    );
    $postcardBlocked = $db->prepare(
        'UPDATE postcards
         SET blocked = 1, block_reason = :reason
         WHERE id = :id'
    );
    // The postcard row is authoritative for when mail was actually posted and
    // whether it came back out of the fan-mail bag. This also keeps events honest
    // when an older runner does not yet send those fields.
    $postcardProvenance = $db->prepare(
        'SELECT posted_at, (promoted_at IS NOT NULL) AS promoted, reply_attempts
         FROM postcards WHERE id = :id'
    );
    $postcardDeferred = $db->prepare(
        "SELECT reply_attempts FROM postcards
         WHERE id = :id AND mail_class = 'reply' AND replied_at IS NULL
           AND delivered_at IS NOT NULL AND blocked = 0
         FOR UPDATE"
    );
    $postcardRetry = $db->prepare(
        'UPDATE postcards
         SET reply_attempts = :attempts, mail_class = :mail_class,
             delivered_at = NULL, deliver_at = :deliver_at
         WHERE id = :id AND mail_class = \'reply\' AND replied_at IS NULL
           AND delivered_at IS NOT NULL AND blocked = 0'
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
    $contextInspectionInsert = $db->prepare(
        'INSERT INTO context_broker_inspections
            (generation_ref, consumer, generated_at, packet, final_rendering, metrics, created_at)
         VALUES (:generation_ref, :consumer, :generated_at, :packet, :rendering, :metrics, :created_at)'
    );
    $awgRunInsert = $db->prepare(
        'INSERT INTO ambient_world_runs
            (run_id, ran_at, candidate_type, context_packet_summary, candidate_output,
             validation_status, rejection_reason, created_world_event_ids, thread_changes,
             model_latency_ms, validation_latency_ms, total_latency_ms, provider, model, created_at)
         VALUES
            (:run_id, :ran_at, :candidate_type, :context_summary, :candidate_output,
             :validation_status, :rejection_reason, :created_event_ids, :thread_changes,
             :model_latency_ms, :validation_latency_ms, :total_latency_ms, :provider, :model, :created_at)
         ON DUPLICATE KEY UPDATE validation_status = VALUES(validation_status),
             rejection_reason = VALUES(rejection_reason), total_latency_ms = VALUES(total_latency_ms)'
    );
    $worldThreadUpsert = $db->prepare(
        'INSERT INTO world_threads
            (thread_id, thread_type, state, summary, participants, source_event_ids,
             next_eligible_at, resolution, visibility, created_at, updated_at)
         VALUES
            (:thread_id, :thread_type, :state, :summary, :participants, :source_event_ids,
             :next_eligible_at, :resolution, :visibility, :created_at, :updated_at)
         ON DUPLICATE KEY UPDATE thread_type = VALUES(thread_type), state = VALUES(state),
             summary = VALUES(summary), participants = VALUES(participants),
             source_event_ids = VALUES(source_event_ids), next_eligible_at = VALUES(next_eligible_at),
             resolution = VALUES(resolution), visibility = VALUES(visibility), updated_at = VALUES(updated_at)'
    );
    $worldObjectUpsert = $db->prepare(
        'INSERT INTO world_objects
            (object_id, object_type, owner_id, holder_id, location, status,
             visibility, source_event_id, created_at, updated_at)
         VALUES
            (:object_id, :object_type, :owner_id, :holder_id, :location, :status,
             :visibility, :source_event_id, :created_at, :updated_at)
         ON DUPLICATE KEY UPDATE object_type = VALUES(object_type), owner_id = VALUES(owner_id),
             holder_id = VALUES(holder_id), location = VALUES(location), status = VALUES(status),
             visibility = VALUES(visibility), source_event_id = VALUES(source_event_id),
             updated_at = VALUES(updated_at)'
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

        // A private structured world record. It is stored separately and never
        // inserted into the public events stream.
        if ($kind === 'world_event_record') {
            $record = is_array($event['payload'])
                ? captive_environment_record_validate($event['payload'])
                : throw new InvalidArgumentException('invalid environment event record');
            $world = $record['world_event'];
            $recordJson = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if ($recordJson === false) {
                throw new InvalidArgumentException('invalid environment event record');
            }
            $environmentInsert->execute([
                ':event_id' => (string)$world['id'],
                ':occurred_at' => (string)$event['ts'],
                ':event_type' => (string)$world['event_type'],
                ':event_family' => (string)$world['event_family'],
                ':record' => $recordJson,
            ]);
            continue;
        }

        // Context packets and ambient-world simulation state are private
        // observability side channels. None may enter the public events table.
        if ($kind === 'context_inspection') {
            $record = is_array($event['payload'])
                ? captive_context_inspection_validate($event['payload'])
                : throw new InvalidArgumentException('invalid context inspection');
            $contextInspectionInsert->execute([
                ':generation_ref' => $record['generation_ref'],
                ':consumer' => $record['consumer'],
                ':generated_at' => captive_world_datetime($record['generated_at']),
                ':packet' => json_encode($record['packet'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                ':rendering' => $record['rendering'],
                ':metrics' => json_encode($record['metrics'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                ':created_at' => (string)$event['ts'],
            ]);
            continue;
        }

        if ($kind === 'awg_run_record') {
            $record = is_array($event['payload'])
                ? captive_awg_run_validate($event['payload'])
                : throw new InvalidArgumentException('invalid AWG run record');
            $awgRunInsert->execute([
                ':run_id' => $record['run_id'], ':ran_at' => captive_world_datetime($record['ran_at']),
                ':candidate_type' => $record['candidate_type'],
                ':context_summary' => json_encode($record['context_summary']),
                ':candidate_output' => $record['candidate_output'] === null ? null : json_encode($record['candidate_output']),
                ':validation_status' => $record['validation_status'], ':rejection_reason' => $record['rejection_reason'],
                ':created_event_ids' => json_encode($record['created_event_ids']),
                ':thread_changes' => json_encode($record['thread_changes']),
                ':model_latency_ms' => $record['model_latency_ms'],
                ':validation_latency_ms' => $record['validation_latency_ms'],
                ':total_latency_ms' => $record['total_latency_ms'],
                ':provider' => $record['provider'], ':model' => $record['model'],
                ':created_at' => (string)$event['ts'],
            ]);
            continue;
        }

        if ($kind === 'world_thread_record') {
            $record = is_array($event['payload'])
                ? captive_world_thread_validate($event['payload'])
                : throw new InvalidArgumentException('invalid world thread record');
            $worldThreadUpsert->execute([
                ':thread_id' => $record['id'], ':thread_type' => $record['type'], ':state' => $record['state'],
                ':summary' => $record['summary'], ':participants' => json_encode($record['participants']),
                ':source_event_ids' => json_encode($record['source_event_ids']),
                ':next_eligible_at' => captive_world_datetime($record['next_eligible_at']),
                ':resolution' => $record['resolution'] === null ? null : json_encode($record['resolution']),
                ':visibility' => json_encode($record['visibility']),
                ':created_at' => captive_world_datetime($record['created_at']),
                ':updated_at' => captive_world_datetime($record['updated_at']),
            ]);
            continue;
        }

        if ($kind === 'world_object_record') {
            $record = is_array($event['payload'])
                ? captive_world_object_validate($event['payload'])
                : throw new InvalidArgumentException('invalid world object record');
            $updated = captive_world_datetime($record['updated_at']);
            $worldObjectUpsert->execute([
                ':object_id' => $record['id'], ':object_type' => $record['type'],
                ':owner_id' => $record['owner_id'], ':holder_id' => $record['holder_id'],
                ':location' => $record['location'], ':status' => $record['status'],
                ':visibility' => json_encode($record['visibility']), ':source_event_id' => $record['source_event_id'],
                ':created_at' => $updated, ':updated_at' => $updated,
            ]);
            continue;
        }

        // The authoritative public reply also closes the server-side queue item.
        // This happens in the same transaction as the event insert. Idempotence is
        // enforced by replied_at IS NULL, so a retried batch cannot advance the
        // fan-mail promotion counter twice.
        if ($kind === 'postcard_out') {
            $p = $event['payload'];
            $postcardId = is_array($p) ? (int)($p['reply_to'] ?? $p['id'] ?? 0) : 0;
            captive_postcard_mark_replied($db, $postcardId, (string)$event['ts']);
        }

        // Runner-side inbound moderation is authoritative. Record the result but
        // never put the rejected postcard or its reason into the public stream.
        if ($kind === 'postcard_blocked') {
            $p = $event['payload'];
            if (is_array($p) && (int)($p['id'] ?? 0) > 0) {
                $postcardBlocked->execute([
                    ':id' => (int)$p['id'],
                    ':reason' => mb_substr((string)($p['reason'] ?? 'screened'), 0, 80),
                ]);
            }
            continue;
        }

        // One empty/error generation is not a full tray. Release the claim and
        // retry it after a short delay. Only after the bounded attempt allowance
        // is exhausted does it become terminal fan mail and receive an archive
        // event on the next inbox poll.
        if ($kind === 'postcard_deferred') {
            $p = $event['payload'];
            $postcardId = is_array($p) ? (int)($p['id'] ?? 0) : 0;
            if ($postcardId > 0) {
                captive_postcard_queue_lock($db);
                $postcardDeferred->execute([':id' => $postcardId]);
                $claimed = $postcardDeferred->fetch();
                if ($claimed) {
                    $outcome = captive_postcard_failed_attempt((int)$claimed['reply_attempts']);
                    $postcardRetry->execute([
                        ':attempts' => $outcome['attempts'],
                        ':mail_class' => $outcome['mail_class'],
                        ':deliver_at' => gmdate('Y-m-d H:i:s', time() + $outcome['retry_after_seconds']),
                        ':id' => $postcardId,
                    ]);
                }
            }
            continue;
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

        $payload = $event['payload'];
        if ($kind === 'postcard_in' && is_array($payload)) {
            $postcardId = (int)($payload['id'] ?? 0);
            if ($postcardId > 0) {
                $postcardProvenance->execute([':id' => $postcardId]);
                $source = $postcardProvenance->fetch();
                if ($source && !captive_postcard_should_publish_arrival((int)$source['reply_attempts'])) {
                    continue;
                }
                $payload = captive_postcard_event_provenance($payload, $source ?: null);
            }
        }

        $payloadJson = json_encode($payload);
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
