<?php
declare(strict_types=1);

// admin.php - the owner's pause/resume and model-provider control for the runner.
//
//   GET                                  -> current { ok, paused, provider, deepseek_available }
//   POST { action:'pause' }              -> stop the LLM: sets the paused flag
//   POST { action:'resume' }             -> resume generation
//   POST { action:'provider', provider } -> switch the active model provider
//                                           ('ollama' | 'deepseek')
//
// The provider is persisted on the same single `tempo` row as the pause flag and
// read by the runner through its existing tempo poll, so a switch takes effect
// mid-loop with no restart. DeepSeek's API key lives on the RUNNER, not here: the
// runner reports whether it has a key (deepseek_available), and a request to switch
// to DeepSeek is REFUSED with a clear reason (409) when the runner has none, rather
// than silently selecting a provider that cannot run.
//
// Purpose: let the owner stop the model to watch what DELL's CPU and memory
// actually do with it idle, so the host readouts can be reconciled. While paused
// the runner makes NO generation calls to ollama at all; every other timer
// (vitals, host stats, power sampling, event emission) keeps running, so the
// operator sees CPU fall and the meter's DRAW drop in real time. Resuming picks
// up cleanly mid-stream - the runner is never restarted and no context is lost.
//
// GATE: admin, decided server-side by lib/admin.php - EITHER this browser is on
// the same network as DELL (automatic), OR the ?111 fallback flag is present.
// Enforced HERE, not just hidden in the UI: a pause/resume POST from a non-admin
// client is rejected (404, so the endpoint stays invisible to an ordinary
// visitor). The paused flag lives on the single `tempo` row; the runner reads it
// through its existing tempo poll.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';
require __DIR__ . '/../../lib/tempo.php';

header('Cache-Control: no-store');

// The full admin state returned by GET and by every POST, so the control always
// gets back the reconciled truth (pause flag, active provider, and whether the
// runner has a DeepSeek key to switch to).
function admin_state(PDO $db): array
{
    return [
        'ok' => true,
        'paused' => captive_tempo_paused($db),
        'provider' => captive_tempo_provider($db),
        'deepseek_available' => captive_tempo_deepseek_available($db),
    ];
}

try {
    $db = captive_db();

    // Server-side admin gate. Absent admin this 404s so the endpoint is invisible
    // to an ordinary visitor - the UI hiding the control is not the enforcement.
    if (!captive_is_admin($db)) {
        captive_error_response('not found', 404);
    }

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $action = is_array($input) ? ($input['action'] ?? null) : null;

        if ($action === 'provider') {
            $provider = is_array($input) ? ($input['provider'] ?? null) : null;
            if ($provider !== 'ollama' && $provider !== 'deepseek') {
                captive_error_response("provider must be 'ollama' or 'deepseek'", 422);
            }
            // DeepSeek needs a key, which lives on the runner. Refuse with a clear
            // reason when the runner has reported no key, rather than selecting a
            // provider that cannot generate.
            if ($provider === 'deepseek' && !captive_tempo_deepseek_available($db)) {
                captive_error_response('DeepSeek is unavailable: no API key present on the runner', 409);
            }
            captive_tempo_set_provider($db, $provider);
            captive_json_response(admin_state($db));
        }

        if ($action !== 'pause' && $action !== 'resume') {
            captive_error_response("action must be 'pause', 'resume' or 'provider'", 422);
        }
        captive_tempo_set_paused($db, $action === 'pause');
        captive_json_response(admin_state($db));
    }

    if ($method !== 'GET') {
        captive_error_response('method not allowed', 405);
    }

    captive_json_response(admin_state($db));
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
