<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/schedule.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        captive_error_response('method not allowed', 405);
    }

    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        $input = $_POST;
    }

    $from = trim((string)($input['from'] ?? ''));
    $body = trim((string)($input['body'] ?? ''));

    if (mb_strlen($from) < 1 || mb_strlen($from) > 40) {
        captive_error_response('from must be 1-40 characters', 422);
    }
    if (mb_strlen($body) < 1 || mb_strlen($body) > 900) {
        captive_error_response('body must be 1-900 characters', 422);
    }

    $db = captive_db();
    $ipBin = @inet_pton(captive_client_ip());
    if ($ipBin === false) {
        $ipBin = null;
    }

    $rateStmt = $db->prepare('SELECT COUNT(*) FROM letters WHERE ip = :ip AND posted_at > (NOW() - INTERVAL 10 MINUTE)');
    $rateStmt->bindValue(':ip', $ipBin, PDO::PARAM_LOB);
    $rateStmt->execute();
    if ((int)$rateStmt->fetchColumn() >= 3) {
        captive_error_response('rate limit exceeded, try again later', 429);
    }

    $deliverAt = captive_next_deliver_at();

    $insert = $db->prepare('INSERT INTO letters (from_name, body, ip, posted_at, deliver_at) VALUES (:from_name, :body, :ip, NOW(), :deliver_at)');
    $insert->bindValue(':from_name', $from, PDO::PARAM_STR);
    $insert->bindValue(':body', $body, PDO::PARAM_STR);
    $insert->bindValue(':ip', $ipBin, PDO::PARAM_LOB);
    $insert->bindValue(':deliver_at', $deliverAt, PDO::PARAM_STR);
    $insert->execute();

    captive_json_response(['ok' => true, 'deliver_at' => $deliverAt]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
