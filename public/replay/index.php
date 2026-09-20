<?php
declare(strict_types=1);

// public/replay/index.php - the Soma replay workbench, hosted at
// cy.dabblelabs.uk/replay/ (see docs/dev-admin-ui-hosting.md for the general
// convention). Admin-only, same gate as every other owner tool on this site
// (lib/admin.php) - not linked from the public page, reached by typing the
// URL, matching the existing "light obscurity, not a login" posture already
// documented in lib/admin.php.
//
// This file, viewer.js.php, timeline-model.js.php and viewer.css.php all
// serve the SAME underlying files in runner/replay-viewer/ - kept as literal
// .php files (not .js/.css) so every one of them is admin-gated individually
// and none of them can be served directly by the webserver's static-file
// handling the way public/assets/*.js already is (those are intentionally
// public; this tool is not).

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';
require __DIR__ . '/../../lib/replay_workbench.php';

$db = captive_db();
if (!captive_is_admin($db)) {
    captive_error_response('not found', 404);
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
echo captive_replay_asset_content('index.html', [
    // The source references bare filenames; the .js.php/.css.php siblings in
    // this directory serve identical (gated) content under those names.
    'href="viewer.css"' => 'href="viewer.css.php"',
    'src="viewer.js"' => 'src="viewer.js.php"',
]);
