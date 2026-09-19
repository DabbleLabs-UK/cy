<?php
declare(strict_types=1);

// Public, read-only current Soma snapshot. This returns the exact state carried
// by the newest persisted vitals event; it does not derive or fill any values.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/soma.php';
require __DIR__ . '/../../lib/live_vitals.php';

header('Cache-Control: no-store');

try {
    $db = captive_db();
    captive_json_response(captive_soma_api_payload(captive_latest_vitals_row($db)));
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
