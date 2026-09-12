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
    captive_json_response([
        'ok' => true,
        'visibility' => 'OWNER_ONLY',
        'queries' => $queries,
    ]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
