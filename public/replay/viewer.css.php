<?php
declare(strict_types=1);

// Admin-gated pass-through of runner/replay-viewer/viewer.css. See index.php
// for why this is a .php file rather than a plain static .css file.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';
require __DIR__ . '/../../lib/replay_workbench.php';

$db = captive_db();
if (!captive_is_admin($db)) {
    captive_error_response('not found', 404);
}

header('Content-Type: text/css; charset=utf-8');
header('Cache-Control: no-store');
echo captive_replay_asset_content('viewer.css');
