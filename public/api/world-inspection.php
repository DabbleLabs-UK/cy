<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        captive_error_response('method not allowed', 405);
    }
    $db = captive_db();
    if (!captive_is_admin($db)) {
        captive_error_response('not found', 404);
    }

    $contexts = $db->query(
        'SELECT id, consumer, generation_ref, generated_at, packet,
                final_rendering, metrics, created_at
         FROM context_broker_inspections
         ORDER BY id DESC LIMIT 60'
    )->fetchAll();
    foreach ($contexts as &$context) {
        $context['packet'] = json_decode((string)$context['packet'], true);
        $context['metrics'] = json_decode((string)$context['metrics'], true);
    }
    unset($context);

    $lastRun = $db->query(
        'SELECT run_id, ran_at, candidate_type, context_packet_summary,
                candidate_output, validation_status, rejection_reason,
                created_world_event_ids, thread_changes, model_latency_ms,
                validation_latency_ms, total_latency_ms, provider, model, created_at
         FROM ambient_world_runs ORDER BY created_at DESC LIMIT 1'
    )->fetch() ?: null;
    if ($lastRun !== null) {
        foreach (['context_packet_summary', 'candidate_output', 'created_world_event_ids', 'thread_changes'] as $field) {
            $lastRun[$field] = $lastRun[$field] === null ? null : json_decode((string)$lastRun[$field], true);
        }
    }

    $threads = $db->query(
        "SELECT thread_id, thread_type, state, summary, participants,
                source_event_ids, next_eligible_at, resolution, visibility,
                created_at, updated_at
         FROM world_threads WHERE state = 'OPEN' ORDER BY updated_at DESC LIMIT 20"
    )->fetchAll();
    foreach ($threads as &$thread) {
        foreach (['participants', 'source_event_ids', 'resolution', 'visibility'] as $field) {
            $thread[$field] = $thread[$field] === null ? null : json_decode((string)$thread[$field], true);
        }
    }
    unset($thread);

    $objects = $db->query(
        'SELECT object_id, object_type, owner_id, holder_id, location, status,
                visibility, source_event_id, created_at, updated_at
         FROM world_objects ORDER BY updated_at DESC LIMIT 30'
    )->fetchAll();
    foreach ($objects as &$object) {
        $object['visibility'] = json_decode((string)$object['visibility'], true);
    }
    unset($object);

    captive_json_response([
        'contexts' => $contexts,
        'last_awg_run' => $lastRun,
        'open_threads' => $threads,
        'objects' => $objects,
    ]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
