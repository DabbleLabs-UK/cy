<?php
declare(strict_types=1);

// replay_workbench_test.php - checks the DB-free parts of lib/replay_workbench.php:
// the asset content-transform (captive_replay_asset_content) and the REAL
// subprocess bridge to runner/soma-replay-api-cli.mjs (captive_replay_node) -
// actually invoked, not mocked, exactly as public/replay/api.php invokes it,
// because the bridge itself (PHP -> node) is the new integration surface this
// change adds. captive_is_admin()'s DB-backed decision is already covered by
// admin_test.php and is not re-tested here - these helpers are called only
// AFTER that gate passes, matching every other admin-gated endpoint.
//
//   php tests/replay_workbench_test.php
//
// Exits non-zero if any assertion fails, or if `node` is not on PATH (the one
// environment dependency this bridge has - see config/config.sample.php's
// replay_node_bin comment for the real-deploy equivalent).

// captive_config()/captive_db() are not needed here (only the DB-free
// functions are exercised), so lib/db.php is deliberately not required.
require __DIR__ . '/../lib/replay_workbench.php';

$pass = 0;
$fail = 0;
function check(string $label, bool $ok): void
{
    global $pass, $fail;
    echo ($ok ? '  ok   ' : '  FAIL ') . $label . "\n";
    $ok ? $pass++ : $fail++;
}

echo "==== ASSET CONTENT TRANSFORM (pure, no admin/DB involved) ====\n";

$viewerJs = captive_replay_asset_content('viewer.js');
check('viewer.js is served unmodified when no replacements are requested', str_contains($viewerJs, "from './timeline-model.js'"));

$viewerJsGated = captive_replay_asset_content('viewer.js', ["from './timeline-model.js'" => "from './timeline-model.js.php'"]);
check('the .php-suffixed import replacement is applied', str_contains($viewerJsGated, "from './timeline-model.js.php'"));
check('the original (unsuffixed) import string no longer appears after replacement', !str_contains($viewerJsGated, "from './timeline-model.js'"));

$indexHtml = captive_replay_asset_content('index.html', [
    'href="viewer.css"' => 'href="viewer.css.php"',
    'src="viewer.js"' => 'src="viewer.js.php"',
]);
check('index.html gets the .php-suffixed stylesheet link', str_contains($indexHtml, 'href="viewer.css.php"'));
check('index.html gets the .php-suffixed script src', str_contains($indexHtml, 'src="viewer.js.php"'));
check('index.html still contains its real page title (readfile actually worked)', str_contains($indexHtml, 'Soma Replay Workbench'));

$threw = false;
try {
    captive_replay_asset_content('does-not-exist.js');
} catch (RuntimeException $e) {
    $threw = true;
    check('a missing asset names the missing path in its error', str_contains($e->getMessage(), 'does-not-exist.js'));
}
check('a missing asset throws rather than silently returning empty content', $threw);

echo "\n==== NODE SUBPROCESS BRIDGE (real invocation of soma-replay-api-cli.mjs) ====\n";

$fixturesJson = captive_replay_node(['fixtures']);
$fixtures = json_decode($fixturesJson, true);
check('the fixtures action returns valid JSON', is_array($fixtures));
check('all six golden fixtures are returned through the PHP bridge', isset($fixtures['fixtures']) && count($fixtures['fixtures']) === 6);

$replayJson = captive_replay_node(['replay', 'hostile-search-confiscation', '15', '']);
$replay = json_decode($replayJson, true);
check('EVENT WINDOW replay returns valid JSON through the PHP bridge', is_array($replay));
check('EVENT WINDOW replay applies both fixture events', is_array($replay) && count($replay['report']['orderedEventIds'] ?? []) === 2);

$fullDayJson = captive_replay_node(['replay', 'hostile-search-confiscation', '15', 'full-day']);
$fullDay = json_decode($fullDayJson, true);
$span = is_array($fullDay) ? ($fullDay['report']['interval']['endMs'] - $fullDay['report']['interval']['startMs']) / 3600000 : null;
check('FULL DAY replay spans exactly 24h through the PHP bridge', $span !== null && abs($span - 24) < 0.001);

$threwUnknown = false;
try {
    captive_replay_node(['replay', 'does-not-exist', '15', '']);
} catch (RuntimeException $e) {
    $threwUnknown = true;
    check('an unknown fixture surfaces the CLI\'s own error message, not a generic failure',
        str_contains($e->getMessage(), 'unknown fixture'));
}
check('an unknown fixture throws (non-zero CLI exit is converted to a PHP exception)', $threwUnknown);

echo "\n" . ($fail === 0 ? "ALL PASS ($pass)\n" : "$fail FAILED, $pass passed\n");
exit($fail === 0 ? 0 : 1);
