<?php
declare(strict_types=1);

// Public, read-only current Soma snapshot. This returns the exact state carried
// by the newest persisted vitals event; it does not derive or fill any values.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/soma.php';

header('Cache-Control: no-store');

try {
    $db = captive_db();
    $stmt = $db->query("SELECT seq, ts, payload FROM events WHERE kind = 'vitals' ORDER BY seq DESC LIMIT 1");
    $row = $stmt->fetch();
    captive_json_response(captive_soma_api_payload($row === false ? null : $row));
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
