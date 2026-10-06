<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';
require __DIR__ . '/../../lib/memory_formation_inference.php';

header('Cache-Control: no-store');
try {
    $db = captive_db();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $range = (string)($_GET['range'] ?? '24H');
    // Paid controls never accept the legacy ?111 diagnostic shortcut.
    $admin = captive_admin_same_network($db);
    if ($method === 'GET') captive_json_response(captive_memory_inference_view($db,$range,$admin));
    if ($method !== 'POST') captive_error_response('method not allowed',405);
    $body = file_get_contents('php://input',false,null,0,16385);
    if (strlen($body)>16384) captive_error_response('request too large',413);
    $input = json_decode($body,true);
    if (!is_array($input)) captive_error_response('JSON object required',422);
    $action = $input['action'] ?? '';
    if ($action === 'settings') {
        if (!$admin || !captive_memory_inference_same_origin($_SERVER)) captive_error_response('unauthorized',403);
        if (!is_array($input['settings'] ?? null)) throw new InvalidArgumentException('settings required');
        $db->beginTransaction();
        $previous = captive_memory_inference_lock($db);
        $settings = captive_memory_inference_settings(array_replace($previous,$input['settings']));
        $db->prepare('UPDATE memory_formation_inference_settings SET settings=?,updated_at=UTC_TIMESTAMP(3) WHERE id=1')->execute([json_encode($settings,JSON_THROW_ON_ERROR)]);
        $db->prepare('INSERT INTO memory_formation_inference_settings_audit (previous_settings,settings,changed_at) VALUES (?,?,UTC_TIMESTAMP(3))')->execute([json_encode($previous,JSON_THROW_ON_ERROR),json_encode($settings,JSON_THROW_ON_ERROR)]);
        $db->commit();
        captive_json_response(captive_memory_inference_view($db,$range,$admin));
    }
    captive_require_ingest_key();
    $db->beginTransaction();
    $result = match ($action) {
        'reserve' => captive_memory_inference_reserve($db,$input),
        'settle' => captive_memory_inference_settle($db,$input),
        default => throw new InvalidArgumentException('unknown action'),
    };
    $db->commit();
    captive_json_response($result);
} catch (InvalidArgumentException $error) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    captive_error_response($error->getMessage(),422);
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    error_log('memory formation inference operation failed: ' . get_class($error));
    captive_error_response('memory formation inference unavailable',503);
}
