<?php
declare(strict_types=1);

// Owner-only access traces for autobiographical recall. Exact memory IDs and
// current-query details never enter the public event stream or public memory API.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';

header('Cache-Control: no-store');

function captive_memory_inspection_json(mixed $value): mixed
{
    if (!is_string($value) || $value === '') {
        return [];
    }
    $decoded = json_decode($value, true);
    return $decoded ?? [];
}

try {
    $db = captive_db();
    if (!captive_is_admin($db)) {
        captive_error_response('not found', 404);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        captive_error_response('method not allowed', 405);
    }
    $rows = $db->query(
        'SELECT id, generation_ref, current_context, sender_known,
                candidate_memory_ids, retrieval_mechanisms, privacy_filter,
                offered_memory_ids, selected_memory_ids, inserted_memory_ids,
                created_at
         FROM autobiographical_memory_queries
         ORDER BY created_at DESC, id DESC LIMIT 30'
    )->fetchAll();
    $queries = array_map(static function (array $row): array {
        return [
            'id' => (int)$row['id'],
            'generation_ref' => $row['generation_ref'],
            'current_context' => captive_memory_inspection_json($row['current_context']),
            'sender_known' => (bool)$row['sender_known'],
            'candidate_memory_ids' => captive_memory_inspection_json($row['candidate_memory_ids']),
            'retrieval_mechanisms' => captive_memory_inspection_json($row['retrieval_mechanisms']),
            'privacy_filter' => captive_memory_inspection_json($row['privacy_filter']),
            'offered_memory_ids' => captive_memory_inspection_json($row['offered_memory_ids']),
            'selected_memory_ids' => captive_memory_inspection_json($row['selected_memory_ids']),
            'inserted_memory_ids' => captive_memory_inspection_json($row['inserted_memory_ids']),
            'created_at' => $row['created_at'],
        ];
    }, $rows);
    $formation = $db->query(
        "SELECT
            SUM(status IN ('PENDING', 'PROCESSING', 'RETRYABLE')) AS queue_depth,
            MAX(CASE WHEN status IN ('PENDING', 'PROCESSING', 'RETRYABLE') THEN id ELSE 0 END) AS queue_max_seen,
            SUM(status = 'PROCESSED') AS processed,
            SUM(status = 'RETRYABLE') AS retryable
         FROM autobiographical_memory_formation_queue"
    )->fetch() ?: [];
    $formationAttempts = $db->query(
        "SELECT COUNT(*) AS attempts,
                SUM(result_category = 'NOTHING') AS nothing_count,
                SUM(result_category IN ('CREATE', 'UPDATE')) AS changed_count,
                ROUND(AVG(latency_ms)) AS average_latency_ms,
                MAX(latency_ms) AS max_latency_ms,
                MAX(GREATEST(queue_depth_before, queue_depth_after)) AS max_queue_depth,
                (SELECT error_text FROM autobiographical_memory_formation_attempts recent
                 WHERE recent.result_category IN ('ERROR', 'TIMEOUT', 'INVALID', 'PREEMPTED', 'CONFLICT')
                 ORDER BY recent.created_at DESC, recent.id DESC LIMIT 1) AS last_error
         FROM autobiographical_memory_formation_attempts"
    )->fetch() ?: [];
    $surfacing = $db->query(
        "SELECT COUNT(*) AS attempts,
                SUM(result_category IN ('PREPARED', 'NO_CANDIDATES')) AS prepared,
                SUM(consumed_at IS NOT NULL) AS consumed,
                ROUND(AVG(latency_ms)) AS average_latency_ms,
                MAX(latency_ms) AS max_latency_ms,
                (SELECT error_text FROM autobiographical_memory_surfacing_attempts recent
                 WHERE recent.result_category IN ('ERROR', 'TIMEOUT', 'INVALID', 'PREEMPTED')
                 ORDER BY recent.created_at DESC, recent.id DESC LIMIT 1) AS last_error
         FROM autobiographical_memory_surfacing_attempts"
    )->fetch() ?: [];
    $surfaceQueue = $db->query(
        "SELECT SUM(status IN ('PENDING', 'PROCESSING', 'RETRYABLE')) AS queue_depth
         FROM autobiographical_memory_surfacing_queue"
    )->fetch() ?: [];
    $recentFormation = $db->query(
        'SELECT source_type, source_id, result_category, provider, model, prompt_chars,
                latency_ms, queue_depth_before, queue_depth_after, error_text, created_at
         FROM autobiographical_memory_formation_attempts ORDER BY created_at DESC, id DESC LIMIT 20'
    )->fetchAll();
    $recentSurfacing = $db->query(
        'SELECT generation_ref, result_category, provider, model, prompt_chars, latency_ms,
                candidate_count, privacy_removed_count, selected_ids, consumed_by,
                consumed_at, error_text, created_at
         FROM autobiographical_memory_surfacing_attempts ORDER BY created_at DESC, id DESC LIMIT 20'
    )->fetchAll();
    foreach ($recentSurfacing as &$attempt) {
        $attempt['selected_ids'] = captive_memory_inspection_json($attempt['selected_ids']);
    }
    unset($attempt);
    captive_json_response([
        'ok' => true,
        'visibility' => 'OWNER_ONLY',
        'queries' => $queries,
        'runtime' => [
            'formation' => [
                'queue_depth' => (int)($formation['queue_depth'] ?? 0),
                'max_queue_depth' => max(
                    (int)($formation['queue_depth'] ?? 0),
                    (int)($formationAttempts['max_queue_depth'] ?? 0)
                ),
                'processed' => (int)($formation['processed'] ?? 0),
                'retryable' => (int)($formation['retryable'] ?? 0),
                'attempts' => (int)($formationAttempts['attempts'] ?? 0),
                'nothing' => (int)($formationAttempts['nothing_count'] ?? 0),
                'changed' => (int)($formationAttempts['changed_count'] ?? 0),
                'average_latency_ms' => (int)($formationAttempts['average_latency_ms'] ?? 0),
                'max_latency_ms' => (int)($formationAttempts['max_latency_ms'] ?? 0),
                'last_error' => $formationAttempts['last_error'] ?? null,
                'recent' => $recentFormation,
            ],
            'surfacing' => [
                'queue_depth' => (int)($surfaceQueue['queue_depth'] ?? 0),
                'attempts' => (int)($surfacing['attempts'] ?? 0),
                'prepared' => (int)($surfacing['prepared'] ?? 0),
                'consumed' => (int)($surfacing['consumed'] ?? 0),
                'average_latency_ms' => (int)($surfacing['average_latency_ms'] ?? 0),
                'max_latency_ms' => (int)($surfacing['max_latency_ms'] ?? 0),
                'last_error' => $surfacing['last_error'] ?? null,
                'recent' => $recentSurfacing,
            ],
        ],
    ]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
