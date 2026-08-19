<?php
declare(strict_types=1);

// regime.php - the PUBLIC regime control (a short, self-releasing lease).
//
//   GET                          -> current { ok, regime, source, lease_remaining,
//                                    locked }
//   POST { regime:'auto'|'day'|'night' }
//                                -> claim/renew a public regime LEASE (or, with
//                                   'auto', release the caller's own lease)
//
// This is the visitor-facing counterpart of the owner's /api/admin.php regime set.
// The two share the single `tempo` row's regime_override column but differ in kind
// (lib/tempo.php): an owner set is STICKY, a public set is a LEASE that holds for at
// most 5 minutes and releases the instant the visitor who set it stops watching.
//
// SECURITY - this is a PUBLIC WRITE endpoint, so it is treated as hostile ground:
//   - the requested regime is validated against the CY_REGIMES whitelist server-side
//     (a forged/garbage value is 422'd, never written);
//   - sets are rate-limited per visitor (captive_regime_rate_ok);
//   - IDENTITY is taken ONLY from the signed, HMAC-verified visitor cookie
//     (lib/visitor.php) or freshly minted server-side - NEVER from the request body.
//     A forged or absent cookie therefore cannot impersonate another visitor, and
//     captive_tempo_public_set_regime() refuses to let a public set steal a live
//     lease held by a different present visitor, or override an owner force.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/visitor.php';
require __DIR__ . '/../../lib/presence.php';
require __DIR__ . '/../../lib/tempo.php';

header('Cache-Control: no-store');

try {
    $db = captive_db();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $regime = is_array($input) ? ($input['regime'] ?? null) : null;

        // Whitelist server-side: only the three known regimes are ever written.
        if (!in_array($regime, CY_REGIMES, true)) {
            captive_error_response("regime must be 'auto', 'day' or 'night'", 422);
        }

        // Identity: the signed visitor cookie, or a fresh server-minted id + cookie.
        // Nothing in the request body is trusted for identity (see header note).
        $holder = captive_current_visitor_id();
        if ($holder === null) {
            $holder = bin2hex(random_bytes(16));
            captive_set_visitor_cookie($holder);
        }
        $token = 'v:' . $holder;

        // Per-visitor rate limit on this public write.
        if (!captive_regime_rate_ok($db, $token)) {
            captive_error_response('too many regime changes, slow down', 429);
        }

        // Setting a lease means the caller is, by definition, watching. Register the
        // holder's presence now so the lease is not read as already-lapsed before
        // their next stream poll writes the same row.
        captive_presence_touch_token($db, $token);

        $status = captive_tempo_public_set_regime($db, $regime, $holder);
        if ($status === 'admin_locked') {
            // The owner is forcing the regime; refuse but return the current state so
            // the UI can show the control as LOCKED rather than failing silently.
            captive_json_response(
                ['ok' => false, 'error' => 'the regime is set by the owner right now'] + captive_tempo_regime_state($db),
                403
            );
        }
        if ($status === 'held') {
            captive_json_response(
                ['ok' => false, 'error' => 'another viewer is steering the regime right now'] + captive_tempo_regime_state($db),
                409
            );
        }
        captive_json_response(['ok' => true] + captive_tempo_regime_state($db));
    }

    if ($method !== 'GET') {
        captive_error_response('method not allowed', 405);
    }

    // A browser GET seeds the control and counts as watching (parity with tempo.php).
    captive_touch_presence($db);
    captive_json_response(['ok' => true] + captive_tempo_regime_state($db));
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
