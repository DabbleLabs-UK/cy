<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';
require __DIR__ . '/../../lib/implementation_registry.php';
require __DIR__ . '/../../lib/environment_event.php';

try {
    $db = captive_db();
    if (!captive_is_admin($db)) {
        captive_error_response('not found', 404);
    }
    $id = isset($_GET['id']) ? trim((string)$_GET['id']) : '';
    if ($id === '' || strlen($id) > 96) {
        captive_error_response('environment event id required', 422);
    }

    $stmt = $db->prepare('SELECT record FROM environment_events WHERE event_id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $json = $stmt->fetchColumn();
    if (!is_string($json) || $json === '') {
        captive_error_response('not found', 404);
    }
    $record = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($record)) {
        throw new RuntimeException('invalid stored environment event');
    }
    captive_json_response([
        'ok' => true,
        'inspection' => captive_environment_record_inspection(
            $record,
            captive_implementation_registry()
        ),
    ]);
} catch (InvalidArgumentException $e) {
    captive_error_response($e->getMessage(), 422);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
