<?php
declare(strict_types=1);

// Private, bounded startup replay source. Return only ingestion facts already
// persisted with Cy-observed world events; scheduled expectations are not intake.
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';

header('Cache-Control: no-store');

try {
    captive_require_ingest_key();
    $db = captive_db();
    $types = [];
    // Event names use the display label "supper snack"; meal_id uses the
    // machine key "supper_snack". The latter is validated during replay.
    foreach (['breakfast', 'lunch', 'tea', 'supper snack'] as $meal) {
        foreach (['expected', 'eaten', 'partial', 'missed', 'refused'] as $outcome) {
            $types[] = $meal . '_' . $outcome;
        }
    }
    $placeholders = implode(', ', array_fill(0, count($types), '?'));
    $stmt = $db->prepare(
        "SELECT record FROM environment_events
         WHERE event_type IN ($placeholders)
           AND occurred_at >= DATE_SUB(NOW(), INTERVAL 8 DAY)
         ORDER BY occurred_at DESC, event_id DESC LIMIT 801"
    );
    $stmt->execute($types);
    $rows = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $complete = count($rows) <= 800;
    $records = [];
    foreach ($rows as $json) {
        $event = json_decode((string)$json, true);
        $record = is_array($event) ? ($event['feeding']['ledger']['record'] ?? null) : null;
        if (is_array($record) && ($record['schema'] ?? null) === 'cy.ingestion-record') {
            $records[] = $record;
        } elseif (is_array($event)
            && ($event['world_event']['archetype_id'] ?? null) === 'meal'
            && ($event['observation']['modality'] ?? null) === 'direct') {
            // Older records may predate the embedded feeding trace. The
            // structured world food fact still permits the runner to derive
            // the same canonical ingestion record without guessing intake.
            $records[] = $event;
        }
    }
    captive_json_response(['ok' => true, 'complete' => $complete, 'records' => array_reverse($records)]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
