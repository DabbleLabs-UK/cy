<?php
declare(strict_types=1);

// tempo.php - the viewer-driven duty-cycle tempo endpoint.
//
//   GET  -> current { speed, viewers, custom }. A browser GET also refreshes the
//           caller's presence; the runner (X-Cy-Key) is NOT counted as a viewer.
//   POST { speed } -> a watching viewer sets a custom speed 1..100. Validated,
//           clamped, and rate-limited to 6 changes/minute per viewer.
//
// The effective speed is always derived from live presence (lib/tempo.php): with
// nobody watching it is 5% and any custom value is discarded here on the spot.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/presence.php';
require __DIR__ . '/../../lib/tempo.php';

header('Cache-Control: no-store');

try {
    $db = captive_db();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    // The runner authenticates with the ingest key; it polls this endpoint but is
    // not a viewer, so it must never bump presence or it would count as watching.
    $isRunner = hash_equals(captive_ingest_key(), $_SERVER['HTTP_X_CY_KEY'] ?? '');

    if ($method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!is_array($input) || !array_key_exists('speed', $input)) {
            captive_error_response('speed required', 422);
        }
        $speed = captive_tempo_clamp_speed($input['speed']);
        if ($speed === null) {
            captive_error_response('speed must be a number 1-100', 422);
        }

        // whoever is setting the tempo is, by definition, watching
        captive_touch_presence($db);

        $token = captive_viewer_token();
        if (!captive_tempo_rate_ok($db, $token)) {
            captive_error_response('too many tempo changes, slow down', 429);
        }

        captive_tempo_set_custom($db, $speed);
        $state = captive_tempo_state($db);
        captive_json_response(['ok' => true] + $state);
    }

    if ($method !== 'GET') {
        captive_error_response('method not allowed', 405);
    }

    if (!$isRunner) {
        captive_touch_presence($db);
    }
    $state = captive_tempo_state($db);
    captive_json_response(['ok' => true] + $state);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
