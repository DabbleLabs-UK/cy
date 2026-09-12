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

    if ($action === 'query') {
        $visitorId = isset($input['visitor_id']) && preg_match('/^[a-f0-9]{32}$/', (string)$input['visitor_id'])
            ? (string)$input['visitor_id'] : null;
        $query = is_array($input['query'] ?? null) ? $input['query'] : [];
        $limit = max(1, min(CY_MEMORY_CANDIDATE_LIMIT, (int)($input['limit'] ?? CY_MEMORY_CANDIDATE_LIMIT)));
        $candidates = captive_memory_query($db, $query, $visitorId, $limit);
        captive_json_response([
            'ok' => true,
            'candidates' => $candidates,
            'retrieval' => [
                'mechanisms' => ['EXACT_PERSON', 'STRUCTURED_TAG', 'LEXICAL_TOKEN'],
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
        $json = static fn(mixed $value): string => json_encode($value ?? [], JSON_UNESCAPED_SLASHES) ?: '[]';
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
