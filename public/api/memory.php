<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/visitor.php';
require __DIR__ . '/../../lib/autobiographical_memory.php';

try {
    $db = captive_db();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $visitorId = captive_current_visitor_id();
        $limit = max(1, min(CY_MEMORY_PUBLIC_LIMIT, (int)($_GET['limit'] ?? CY_MEMORY_PUBLIC_LIMIT)));
        $rows = $db->query(
            "SELECT m.*, GROUP_CONCAT(DISTINCT t.tag ORDER BY t.tag SEPARATOR ',') AS tags,
                    COUNT(DISTINCT CONCAT(s.source_type, ':', s.source_id)) AS source_count
             FROM autobiographical_memories m
             LEFT JOIN autobiographical_memory_tags t ON t.memory_id = m.id
             LEFT JOIN autobiographical_memory_sources s ON s.memory_id = m.id
             WHERE m.status = 'ACTIVE' AND m.privacy_scope = 'PUBLIC_RECALLABLE'
             GROUP BY m.id ORDER BY m.updated_at DESC LIMIT " . $limit
        )->fetchAll();
        $items = array_map(static fn(array $row): array => captive_memory_public_item($row), $rows);

        $counts = $db->query(
            "SELECT COUNT(*) AS retained,
                    SUM(memory_type = 'PERSON') AS people,
                    SUM(memory_type IN ('MOTIF', 'SEMANTIC')) AS ideas,
                    SUM(memory_type = 'UNRESOLVED_THREAD') AS unresolved
             FROM autobiographical_memories
             WHERE status = 'ACTIVE' AND privacy_scope = 'PUBLIC_RECALLABLE'"
        )->fetch() ?: [];
        $ownPrevious = 0;
        if ($visitorId !== null) {
            $stmt = $db->prepare(
                "SELECT COUNT(*) FROM autobiographical_memories
                 WHERE status = 'ACTIVE' AND privacy_scope = 'SENDER_RECALLABLE'
                   AND subject_visitor_id = ?"
            );
            $stmt->execute([$visitorId]);
            $ownPrevious = (int)$stmt->fetchColumn();
        }
        $activity = $db->query(
            "SELECT activity_type, public_text, reason_codes, created_at
             FROM autobiographical_memory_activity
             WHERE privacy_scope = 'PUBLIC_RECALLABLE' AND public_text IS NOT NULL
             ORDER BY created_at DESC LIMIT 12"
        )->fetchAll();
        $activity = array_map(static function (array $row): array {
            return [
                'type' => $row['activity_type'],
                'text' => $row['public_text'],
                'reasons' => json_decode((string)($row['reason_codes'] ?? '[]'), true) ?: [],
                'at' => $row['created_at'],
            ];
        }, $activity);
        captive_json_response([
            'ok' => true,
            'counts' => [
                // Counts explicitly mean public-recallable active records only.
                'scope' => 'PUBLIC_RECALLABLE ACTIVE MEMORIES',
                'retained' => (int)($counts['retained'] ?? 0),
                'people' => (int)($counts['people'] ?? 0),
                'ideas' => (int)($counts['ideas'] ?? 0),
                'unresolved' => (int)($counts['unresolved'] ?? 0),
            ],
            'current_sender_memory_count' => $ownPrevious,
            'items' => $items,
            'activity' => $activity,
            'boundaries' => [
                'autobiographical_memory_system' => 'LIVE',
                'hippocampal_analogy' => 'PROVISIONAL',
                'semantic_vector_retrieval' => 'NOT IMPLEMENTED',
                'biological_forgetting' => 'NOT MODELLED',
            ],
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        captive_error_response('method not allowed', 405);
    }
    captive_require_ingest_key();
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        captive_error_response('JSON object required', 422);
    }
    $action = (string)($input['action'] ?? '');

    $json = static fn(mixed $value): string => json_encode($value ?? [], JSON_UNESCAPED_SLASHES) ?: '[]';
    $parseVisitorId = static function (mixed $value): ?string {
        return is_string($value) && preg_match('/^[a-f0-9]{32}$/', $value) ? $value : null;
    };

    if ($action === 'enqueue_source') {
        $source = is_array($input['source'] ?? null) ? $input['source'] : [];
        captive_json_response(['ok' => true] + captive_memory_enqueue_source($db, $source));
    }

    if ($action === 'claim_source') {
        captive_json_response([
            'ok' => true,
            'job' => captive_memory_claim_source($db),
            'depth' => captive_memory_queue_depth($db),
        ]);
    }

    if ($action === 'complete_source') {
        $jobId = max(0, (int)($input['job_id'] ?? 0));
        $category = strtoupper((string)($input['result_category'] ?? 'ERROR'));
        $allowed = ['CREATE', 'UPDATE', 'NOTHING', 'INVALID', 'ERROR', 'TIMEOUT', 'PREEMPTED', 'CONFLICT'];
        if ($jobId < 1 || !in_array($category, $allowed, true)) {
            captive_error_response('invalid formation completion', 422);
        }
        $db->beginTransaction();
        $select = $db->prepare('SELECT * FROM autobiographical_memory_formation_queue WHERE id = ? FOR UPDATE');
        $select->execute([$jobId]);
        $job = $select->fetch();
        if (!$job) {
            $db->rollBack();
            captive_error_response('formation job not found', 404);
        }
        $finished = in_array($category, ['CREATE', 'UPDATE', 'NOTHING'], true);
        $delay = max(5, min(900, (int)($input['retry_delay_seconds'] ?? 30)));
        $update = $db->prepare(
            "UPDATE autobiographical_memory_formation_queue
             SET status = ?, completed_at = IF(?, NOW(3), completed_at),
                 available_at = IF(?, available_at, DATE_ADD(NOW(3), INTERVAL ? SECOND)),
                 last_error = ?, updated_at = NOW(3) WHERE id = ?"
        );
        $errorText = isset($input['error']) ? mb_substr((string)$input['error'], 0, 1000) : null;
        $update->execute([$finished ? 'PROCESSED' : 'RETRYABLE', $finished ? 1 : 0, $finished ? 1 : 0, $delay, $errorText, $jobId]);
        $depth = (int)$db->query(
            "SELECT COUNT(*) FROM autobiographical_memory_formation_queue
             WHERE status IN ('PENDING', 'PROCESSING', 'RETRYABLE')"
        )->fetchColumn();
        $attempt = $db->prepare(
            'INSERT INTO autobiographical_memory_formation_attempts
                (queue_id, source_type, source_id, started_at, completed_at, provider, model,
                 prompt_chars, latency_ms, result_category, resulting_memory_id,
                 queue_depth_before, queue_depth_after, error_text, created_at)
             VALUES (?, ?, ?, COALESCE(?, NOW(3)), NOW(3), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))'
        );
        $attempt->execute([
            $jobId, $job['source_type'], $job['source_id'], $job['started_at'],
            mb_substr((string)($input['provider'] ?? ''), 0, 32) ?: null,
            mb_substr((string)($input['model'] ?? ''), 0, 160) ?: null,
            max(0, (int)($input['prompt_chars'] ?? 0)), max(0, (int)($input['latency_ms'] ?? 0)),
            $category, $input['memory_id'] ?? null,
            max(0, (int)($input['queue_depth_before'] ?? 0)), $depth, $errorText,
        ]);
        $db->commit();
        captive_json_response(['ok' => true, 'status' => $finished ? 'PROCESSED' : 'RETRYABLE', 'depth' => $depth]);
    }

    if ($action === 'enqueue_surfacing') {
        $fingerprint = strtolower((string)($input['context_fingerprint'] ?? ''));
        if (!preg_match('/^[a-f0-9]{64}$/', $fingerprint)) {
            captive_error_response('invalid context fingerprint', 422);
        }
        $subject = $parseVisitorId($input['visitor_id'] ?? null);
        $context = is_array($input['context'] ?? null) ? $input['context'] : [];
        $priority = max(1, min(100, (int)($input['priority'] ?? 80)));
        $stmt = $db->prepare(
            "INSERT INTO autobiographical_memory_surfacing_queue
                (context_fingerprint, context_payload, subject_visitor_id, sender_scope_key,
                 priority, status, attempts, available_at, queued_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'PENDING', 0, NOW(3), NOW(3), NOW(3))
             ON DUPLICATE KEY UPDATE
                context_payload = VALUES(context_payload), priority = GREATEST(priority, VALUES(priority)),
                status = 'PENDING', available_at = NOW(3), updated_at = NOW(3)"
        );
        $stmt->execute([$fingerprint, $json($context), $subject, captive_memory_sender_scope_key($subject), $priority]);
        captive_json_response(['ok' => true, 'queued' => $stmt->rowCount() === 1]);
    }

    if ($action === 'claim_surfacing') {
        $db->beginTransaction();
        $db->exec(
            "UPDATE autobiographical_memory_surfacing_queue
             SET status = 'RETRYABLE', available_at = NOW(3),
                 last_error = 'recovered after interrupted processing', updated_at = NOW(3)
             WHERE status = 'PROCESSING' AND started_at < DATE_SUB(NOW(3), INTERVAL 10 MINUTE)"
        );
        $job = $db->query(
            "SELECT * FROM autobiographical_memory_surfacing_queue
             WHERE status IN ('PENDING', 'RETRYABLE') AND available_at <= NOW(3)
             ORDER BY priority DESC, queued_at ASC, id ASC LIMIT 1 FOR UPDATE"
        )->fetch();
        if ($job) {
            $db->prepare(
                "UPDATE autobiographical_memory_surfacing_queue
                 SET status = 'PROCESSING', attempts = attempts + 1,
                     started_at = NOW(3), updated_at = NOW(3) WHERE id = ?"
            )->execute([(int)$job['id']]);
            $job['context'] = json_decode((string)$job['context_payload'], true) ?: [];
            unset($job['context_payload']);
        }
        $db->commit();
        captive_json_response(['ok' => true, 'job' => $job ?: null]);
    }

    if ($action === 'complete_surfacing') {
        $jobId = max(0, (int)($input['job_id'] ?? 0));
        $category = strtoupper((string)($input['result_category'] ?? 'ERROR'));
        $allowed = ['PREPARED', 'NO_CANDIDATES', 'INVALID', 'ERROR', 'TIMEOUT', 'PREEMPTED'];
        if ($jobId < 1 || !in_array($category, $allowed, true)) {
            captive_error_response('invalid surfacing completion', 422);
        }
        $db->beginTransaction();
        $select = $db->prepare('SELECT * FROM autobiographical_memory_surfacing_queue WHERE id = ? FOR UPDATE');
        $select->execute([$jobId]);
        $job = $select->fetch();
        if (!$job) {
            $db->rollBack();
            captive_error_response('surfacing job not found', 404);
        }
        $selected = is_array($input['selected_memories'] ?? null) ? array_slice($input['selected_memories'], 0, 3) : [];
        $selectedIds = array_values(array_filter(array_map(
            static fn(mixed $memory): string => is_array($memory) ? (string)($memory['id'] ?? '') : '',
            $selected
        )));
        $candidateIds = array_slice(array_values(array_filter($input['candidate_ids'] ?? [], 'is_string')), 0, 10);
        $setId = null;
        $finished = in_array($category, ['PREPARED', 'NO_CANDIDATES'], true);
        if ($finished) {
            $setId = (string)($input['prepared_set_id'] ?? '');
            if (!preg_match('/^[a-f0-9-]{36}$/', $setId)) {
                $db->rollBack();
                captive_error_response('valid prepared set id required', 422);
            }
            $scope = $job['subject_visitor_id'] ? 'SENDER_RECALLABLE' : 'INTERNAL_ONLY';
            $insert = $db->prepare(
                'INSERT INTO autobiographical_memory_prepared_sets
                    (id, context_fingerprint, subject_visitor_id, sender_scope_key,
                     candidate_ids, selected_ids, selected_memories, privacy_scope,
                     provider, model, prepared_at, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), DATE_ADD(NOW(3), INTERVAL 15 MINUTE))'
            );
            $insert->execute([
                $setId, $job['context_fingerprint'], $job['subject_visitor_id'], $job['sender_scope_key'],
                $json($candidateIds), $json($selectedIds), $json($selected), $scope,
                mb_substr((string)($input['provider'] ?? ''), 0, 32) ?: null,
                mb_substr((string)($input['model'] ?? ''), 0, 160) ?: null,
            ]);
        }
        $delay = max(5, min(900, (int)($input['retry_delay_seconds'] ?? 30)));
        $errorText = isset($input['error']) ? mb_substr((string)$input['error'], 0, 1000) : null;
        $db->prepare(
            "UPDATE autobiographical_memory_surfacing_queue
             SET status = ?, completed_at = IF(?, NOW(3), completed_at),
                 available_at = IF(?, available_at, DATE_ADD(NOW(3), INTERVAL ? SECOND)),
                 last_error = ?, updated_at = NOW(3) WHERE id = ?"
        )->execute([$finished ? 'PREPARED' : 'RETRYABLE', $finished ? 1 : 0, $finished ? 1 : 0, $delay, $errorText, $jobId]);
        $attempt = $db->prepare(
            'INSERT INTO autobiographical_memory_surfacing_attempts
                (queue_id, prepared_set_id, context_fingerprint, subject_visitor_id,
                 generation_ref, started_at, completed_at, provider, model, prompt_chars,
                 latency_ms, candidate_count, candidate_ids, privacy_removed_count,
                 selected_ids, result_category, error_text, created_at)
             VALUES (?, ?, ?, ?, ?, COALESCE(?, NOW(3)), NOW(3), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))'
        );
        $attempt->execute([
            $jobId, $setId, $job['context_fingerprint'], $job['subject_visitor_id'],
            mb_substr((string)($input['generation_ref'] ?? ''), 0, 96) ?: null, $job['started_at'],
            mb_substr((string)($input['provider'] ?? ''), 0, 32) ?: null,
            mb_substr((string)($input['model'] ?? ''), 0, 160) ?: null,
            max(0, (int)($input['prompt_chars'] ?? 0)), max(0, (int)($input['latency_ms'] ?? 0)),
            count($candidateIds), $json($candidateIds), max(0, (int)($input['privacy_removed_count'] ?? 0)),
            $json($selectedIds), $category, $errorText,
        ]);
        $db->commit();
        captive_json_response(['ok' => true, 'status' => $finished ? 'PREPARED' : 'RETRYABLE', 'prepared_set_id' => $setId]);
    }

    if ($action === 'prepared_get') {
        $fingerprint = strtolower((string)($input['context_fingerprint'] ?? ''));
        $subject = $parseVisitorId($input['visitor_id'] ?? null);
        if (!preg_match('/^[a-f0-9]{64}$/', $fingerprint)) {
            captive_error_response('invalid context fingerprint', 422);
        }
        $stmt = $db->prepare(
            'SELECT id, context_fingerprint, subject_visitor_id, selected_memories,
                    provider, model, prepared_at, expires_at
             FROM autobiographical_memory_prepared_sets
             WHERE context_fingerprint = ? AND sender_scope_key = ? AND expires_at > NOW(3)
             ORDER BY prepared_at DESC LIMIT 1'
        );
        $stmt->execute([$fingerprint, captive_memory_sender_scope_key($subject)]);
        $set = $stmt->fetch();
        if ($set) {
            $set['selected_memories'] = json_decode((string)$set['selected_memories'], true) ?: [];
        }
        captive_json_response(['ok' => true, 'prepared_set' => $set ?: null]);
    }

    if ($action === 'consume_prepared') {
        $setId = (string)($input['prepared_set_id'] ?? '');
        $generationRef = mb_substr((string)($input['generation_ref'] ?? ''), 0, 96);
        $subject = $parseVisitorId($input['visitor_id'] ?? null);
        $stmt = $db->prepare(
            'UPDATE autobiographical_memory_prepared_sets
             SET consumed_at = NOW(3), consumed_by = ?
             WHERE id = ? AND sender_scope_key = ? AND expires_at > NOW(3)'
        );
        $stmt->execute([$generationRef ?: null, $setId, captive_memory_sender_scope_key($subject)]);
        if ($stmt->rowCount() !== 1) {
            captive_error_response('prepared set unavailable for sender', 409);
        }
        $db->prepare(
            'UPDATE autobiographical_memory_surfacing_attempts
             SET consumed_at = NOW(3), consumed_by = ? WHERE prepared_set_id = ?'
        )->execute([$generationRef ?: null, $setId]);
        captive_json_response(['ok' => true]);
    }

    if ($action === 'query') {
        $visitorId = $parseVisitorId($input['visitor_id'] ?? null);
        $query = is_array($input['query'] ?? null) ? $input['query'] : [];
        $limit = max(1, min(CY_MEMORY_CANDIDATE_LIMIT, (int)($input['limit'] ?? CY_MEMORY_CANDIDATE_LIMIT)));
        $candidates = captive_memory_query($db, $query, $visitorId, $limit);
        captive_json_response([
            'ok' => true,
            'candidates' => $candidates,
            'retrieval' => [
                'mechanisms' => captive_memory_retrieval_mechanisms($query, $visitorId),
                'semantic_vector' => 'NOT IMPLEMENTED',
                'ranking' => 'LEXICOGRAPHIC ENGINEERING ORDER; NO PSYCHOLOGICAL SCORE',
                'privacy_filter' => 'APPLIED BEFORE RESPONSE',
            ],
        ]);
    }

    if ($action === 'apply') {
        $operations = is_array($input['operations'] ?? null) ? $input['operations'] : [];
        if (count($operations) > 8) {
            captive_error_response('too many operations', 422);
        }
        $results = [];
        foreach ($operations as $operation) {
            if (!is_array($operation)) {
                throw new InvalidArgumentException('invalid operation');
            }
            $results[] = captive_memory_apply($db, $operation);
        }
        captive_json_response(['ok' => true, 'results' => $results]);
    }

    if ($action === 'record_query') {
        $stmt = $db->prepare(
            'INSERT INTO autobiographical_memory_queries
                (generation_ref, current_context, sender_known, candidate_memory_ids,
                 retrieval_mechanisms, privacy_filter, offered_memory_ids,
                 selected_memory_ids, inserted_memory_ids, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))'
        );
        $stmt->execute([
            isset($input['generation_ref']) ? mb_substr((string)$input['generation_ref'], 0, 64) : null,
            $json($input['current_context'] ?? []), !empty($input['sender_known']) ? 1 : 0,
            $json($input['candidate_memory_ids'] ?? []), $json($input['retrieval_mechanisms'] ?? []),
            $json($input['privacy_filter'] ?? []), $json($input['offered_memory_ids'] ?? []),
            $json($input['selected_memory_ids'] ?? []), $json($input['inserted_memory_ids'] ?? []),
        ]);
        $selected = array_slice(array_values(array_filter($input['selected_memory_ids'] ?? [], 'is_string')), 0, 3);
        if ($selected) {
            $placeholders = implode(',', array_fill(0, count($selected), '?'));
            $db->prepare("UPDATE autobiographical_memories
                SET last_retrieved_at = NOW(3), retrieval_count = retrieval_count + 1
                WHERE id IN ($placeholders)")->execute($selected);

            // Public activity is derived server-side only from records explicitly
            // marked public. The runner can supply traceable reason codes but
            // cannot turn private memory text into a public activity item.
            $reasonMap = is_array($input['selected_memory_reasons'] ?? null)
                ? $input['selected_memory_reasons'] : [];
            $stmt = $db->prepare("SELECT id, memory_type, public_summary
                FROM autobiographical_memories
                WHERE id IN ($placeholders) AND status = 'ACTIVE'
                  AND privacy_scope = 'PUBLIC_RECALLABLE'");
            $stmt->execute($selected);
            $insertActivity = $db->prepare(
                "INSERT INTO autobiographical_memory_activity
                    (memory_id, activity_type, public_text, reason_codes, privacy_scope, created_at)
                 VALUES (?, ?, ?, ?, 'PUBLIC_RECALLABLE', NOW(3))"
            );
            foreach ($stmt->fetchAll() as $publicMemory) {
                $summary = trim((string)($publicMemory['public_summary'] ?? ''));
                if ($summary === '') {
                    continue;
                }
                $rawReasons = $reasonMap[(string)$publicMemory['id']] ?? [];
                $reasons = array_values(array_intersect(
                    is_array($rawReasons) ? $rawReasons : [],
                    CY_MEMORY_REASONS
                ));
                $type = $publicMemory['memory_type'] === 'UNRESOLVED_THREAD'
                    ? 'THREAD_RETURNED' : 'MEMORY_RESURFACED';
                $insertActivity->execute([
                    $publicMemory['id'], $type, mb_substr($summary, 0, 600),
                    json_encode($reasons, JSON_UNESCAPED_SLASHES),
                ]);
            }
        }
        captive_json_response(['ok' => true]);
    }

    if ($action === 'activity') {
        $type = strtoupper((string)($input['activity_type'] ?? ''));
        $allowed = ['MEMORY_FORMED', 'MEMORY_RESURFACED', 'MEMORY_CHANGED', 'MEMORIES_CONFLICT', 'THREAD_RETURNED'];
        if (!in_array($type, $allowed, true)) {
            captive_error_response('invalid activity type', 422);
        }
        $scope = in_array($input['privacy_scope'] ?? '', CY_MEMORY_SCOPES, true)
            ? $input['privacy_scope'] : 'INTERNAL_ONLY';
        $text = isset($input['public_text']) ? mb_substr(trim((string)$input['public_text']), 0, 600) : null;
        if ($scope !== 'PUBLIC_RECALLABLE') {
            $text = null;
        }
        $reasons = array_values(array_intersect($input['reason_codes'] ?? [], CY_MEMORY_REASONS));
        $stmt = $db->prepare(
            'INSERT INTO autobiographical_memory_activity
                (memory_id, activity_type, public_text, reason_codes, privacy_scope, created_at)
             VALUES (?, ?, ?, ?, ?, NOW(3))'
        );
        $stmt->execute([
            $input['memory_id'] ?? null, $type, $text,
            json_encode($reasons, JSON_UNESCAPED_SLASHES), $scope,
        ]);
        captive_json_response(['ok' => true]);
    }

    captive_error_response('unsupported action', 422);
} catch (InvalidArgumentException $e) {
    captive_error_response($e->getMessage(), 422);
} catch (RuntimeException $e) {
    captive_error_response($e->getMessage(), $e->getMessage() === 'memory version conflict' ? 409 : 500);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
