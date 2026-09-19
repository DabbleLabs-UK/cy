<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/location.php';
require __DIR__ . '/../../lib/live_vitals.php';

header('Cache-Control: no-store');

try {
    $db = captive_db();
    captive_json_response(captive_location_api_payload(captive_latest_vitals_row($db)));
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
