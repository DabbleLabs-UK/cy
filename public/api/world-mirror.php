<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') captive_error_response('method not allowed', 405);
    captive_require_ingest_key();
    $db = captive_db();
    // This is the complete private mirror, not the bounded admin inspection UI.
    $objects = $db->query(
        'SELECT object_id, object_type, owner_id, holder_id, location, status,
                revision, transition_id, message_state, visibility, source_event_id, updated_at
         FROM world_objects ORDER BY object_id'
    )->fetchAll(PDO::FETCH_ASSOC);
    $threads = $db->query(
        'SELECT thread_id, thread_type, state, revision, transition_id, summary,
                participants, source_event_ids, next_eligible_at, resolution, visibility,
                created_at, updated_at
         FROM world_threads ORDER BY thread_id'
    )->fetchAll(PDO::FETCH_ASSOC);
    $outObjects = [];
    foreach ($objects as $row) {
        $outObjects[] = [
            'id' => $row['object_id'], 'type' => $row['object_type'],
            'ownerId' => $row['owner_id'], 'holderId' => $row['holder_id'],
            'location' => $row['location'], 'status' => $row['status'],
            'revision' => $row['revision'] === null ? null : (int)$row['revision'],
            'transitionId' => $row['transition_id'],
            'message' => $row['message_state'] === null ? null : json_decode($row['message_state'], true, 512, JSON_THROW_ON_ERROR),
            'visibility' => json_decode($row['visibility'], true, 512, JSON_THROW_ON_ERROR),
            'sourceEventId' => $row['source_event_id'],
            'updatedAt' => str_replace(' ', 'T', $row['updated_at']) . 'Z',
        ];
    }
    $outThreads = [];
    foreach ($threads as $row) {
        $outThreads[] = [
            'id' => $row['thread_id'], 'type' => $row['thread_type'], 'state' => $row['state'],
            'revision' => $row['revision'] === null ? null : (int)$row['revision'],
            'transitionId' => $row['transition_id'], 'summary' => $row['summary'],
            'participants' => json_decode($row['participants'], true, 512, JSON_THROW_ON_ERROR),
            'sourceEventIds' => json_decode($row['source_event_ids'], true, 512, JSON_THROW_ON_ERROR),
            'nextEligibleAt' => $row['next_eligible_at'],
            'resolution' => $row['resolution'] === null ? null : json_decode($row['resolution'], true, 512, JSON_THROW_ON_ERROR),
            'visibility' => json_decode($row['visibility'], true, 512, JSON_THROW_ON_ERROR),
            'createdAt' => str_replace(' ', 'T', $row['created_at']) . 'Z',
            'updatedAt' => str_replace(' ', 'T', $row['updated_at']) . 'Z',
        ];
    }
    captive_json_response(['objects' => $outObjects, 'threads' => $outThreads]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
