<?php
declare(strict_types=1);

// admin.php - the owner's pause/resume control for the runner.
//
//   GET                       -> current { ok, paused }
//   POST { action:'pause' }   -> stop the LLM: sets the paused flag
//   POST { action:'resume' }  -> resume generation
//
// Purpose: let the owner stop the model to watch what DELL's CPU and memory
// actually do with it idle, so the host readouts can be reconciled. While paused
// the runner makes NO generation calls to ollama at all; every other timer
// (vitals, host stats, power sampling, event emission) keeps running, so the
// operator sees CPU fall and the meter's DRAW drop in real time. Resuming picks
// up cleanly mid-stream - the runner is never restarted and no context is lost.
//
// GATE: the same ?111 admin token as the RAW debugging view (deliberate light
// obscurity, agreed with the owner - NOT a login). Absent the flag this 404s so
// the endpoint is invisible to an ordinary visitor. The paused flag lives on the
// single `tempo` row; the runner reads it through its existing tempo poll.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/tempo.php';

header('Cache-Control: no-store');

// ?111 obscurity gate - same token as the raw view. Not a login by design.
if (!array_key_exists('111', $_GET)) {
    captive_error_response('not found', 404);
}

try {
    $db = captive_db();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $action = is_array($input) ? ($input['action'] ?? null) : null;
        if ($action !== 'pause' && $action !== 'resume') {
            captive_error_response("action must be 'pause' or 'resume'", 422);
        }
        captive_tempo_set_paused($db, $action === 'pause');
        captive_json_response(['ok' => true, 'paused' => captive_tempo_paused($db)]);
    }

    if ($method !== 'GET') {
        captive_error_response('method not allowed', 405);
    }

    captive_json_response(['ok' => true, 'paused' => captive_tempo_paused($db)]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
