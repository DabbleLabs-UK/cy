<?php
declare(strict_types=1);

// public/replay/api.php - JSON API for the Soma replay workbench, admin-gated
// identically to viewer.js.php/viewer.css.php/index.php in this directory.
//
// Shells out to runner/soma-replay-api-cli.mjs (see lib/replay_workbench.php)
// per request: the six golden fixtures are synthetic and already in the repo,
// so this needs no live model, no DELL/LENO, no persistent Node service and
// no extra open port - the same 'action=' contract as the local dev server
// (runner/soma-replay-server.js), so runner/replay-viewer/viewer.js is
// identical in both places. See docs/dev-admin-ui-hosting.md.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';
require __DIR__ . '/../../lib/replay_workbench.php';

header('Cache-Control: no-store');

$db = captive_db();
if (!captive_is_admin($db)) {
    captive_error_response('not found', 404);
}

$action = (string)($_GET['action'] ?? '');

try {
    if ($action === 'fixtures') {
        $json = captive_replay_node(['fixtures']);
    } elseif ($action === 'replay') {
        $fixture = (string)($_GET['fixture'] ?? '');
        $sampleMinutes = (string)($_GET['sampleMinutes'] ?? '15');
        $view = (string)($_GET['view'] ?? '');
        $json = captive_replay_node(['replay', $fixture, $sampleMinutes, $view]);
    } else {
        captive_error_response("unknown action: {$action}", 400);
    }
} catch (Throwable $e) {
    // An unknown-fixture message from the CLI is a client error (404); any
    // other failure (missing node, timeout, unexpected crash) is a server
    // error (500). Both are safe, specific messages - never a generic
    // "something went wrong".
    $isUnknownFixture = str_contains($e->getMessage(), 'unknown fixture');
    captive_error_response($e->getMessage(), $isUnknownFixture ? 404 : 500);
}

header('Content-Type: application/json; charset=utf-8');
echo $json;
