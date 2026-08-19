<?php
declare(strict_types=1);

// tempo_test.php - deterministic checks for the tempo/presence rules that live in
// PHP: the 5%/30%/custom decision, the custom-value discard when the last viewer
// leaves, presence expiry, and speed clamping. Pure logic only - no database
// needed (the DB wrappers are thin passthroughs over these decisions).
//
//   php tests/tempo_test.php
//
// Exits non-zero if any assertion fails.

require __DIR__ . '/../lib/tempo.php';
require_once __DIR__ . '/../lib/presence.php'; // for captive_is_present + presence constants
// NB require_once: tempo.php now pulls in presence.php itself (the regime lease
// reconciles against presence), so a plain require here would redeclare it.

$pass = 0;
$fail = 0;
function check(string $label, bool $ok): void
{
    global $pass, $fail;
    echo ($ok ? '  ok   ' : '  FAIL ') . $label . "\n";
    $ok ? $pass++ : $fail++;
}

echo "==== TEMPO DECISION (5% / 30% / custom) ====\n";

// nobody watching -> 5%, not custom
$d = captive_tempo_decide(0, null);
check('nobody watching -> 5%', $d['speed'] === 5 && $d['custom'] === false && $d['viewers'] === 0);

// one viewer, no custom -> 30%
$d = captive_tempo_decide(1, null);
check('one viewer, no custom -> 30%', $d['speed'] === 30 && $d['custom'] === false && $d['viewers'] === 1);

// several viewers, no custom -> still 30%, count reported
$d = captive_tempo_decide(4, null);
check('four viewers, no custom -> 30% (count=4)', $d['speed'] === 30 && $d['viewers'] === 4);

// a viewer set a custom value -> that value wins while someone watches
$d = captive_tempo_decide(2, 70);
check('two viewers, custom 70 -> 70 (custom flag set)', $d['speed'] === 70 && $d['custom'] === true);

echo "\n==== CUSTOM VALUE DISCARD ON LAST-VIEWER-LEAVE ====\n";

// custom set, but the last viewer just left -> revert to 5% AND signal discard
$d = captive_tempo_decide(0, 70);
check('last viewer leaves with custom 70 -> reverts to 5%', $d['speed'] === 5 && $d['custom'] === false);
check('last viewer leaves with custom 70 -> discards the custom value', $d['discard'] === true);

// custom already null and nobody watching -> nothing to discard
$d = captive_tempo_decide(0, null);
check('nobody watching, no custom -> no discard needed', $d['discard'] === false);

// custom set with viewers present -> never discarded
$d = captive_tempo_decide(3, 12);
check('custom held while viewers present -> not discarded', $d['discard'] === false && $d['speed'] === 12);

echo "\n==== ARRIVE-AT-5% GOES TO 30%, NOT A STALE CUSTOM ====\n";
// Model the sequence: viewer sets 80 -> leaves (discard) -> returns.
$custom = 80;                         // a watcher set 80
$d = captive_tempo_decide(1, $custom);
check('watcher present at custom 80', $d['speed'] === 80);
$d = captive_tempo_decide(0, $custom); // they leave
if ($d['discard']) {
    $custom = null;                    // the store would be cleared here
}
check('after leaving, custom is discarded from the store', $custom === null);
$d = captive_tempo_decide(1, $custom); // a viewer arrives again
check('viewer arrives again -> 30% (NOT the old 80)', $d['speed'] === 30 && $d['custom'] === false);

echo "\n==== PRESENCE EXPIRY (15s window) ====\n";
$now = 1_000_000;
check('seen just now -> present', captive_is_present($now, $now));
check('seen 14s ago -> present', captive_is_present($now - 14, $now));
check('seen exactly 15s ago -> present (boundary inclusive)', captive_is_present($now - 15, $now));
check('seen 16s ago -> NOT present (expired)', !captive_is_present($now - 16, $now));
check('seen 60s ago -> NOT present', !captive_is_present($now - 60, $now));

echo "\n==== SPEED CLAMP / VALIDATION ====\n";
check('clamp 0 -> 1', captive_tempo_clamp_speed(0) === 1);
check('clamp -5 -> 1', captive_tempo_clamp_speed(-5) === 1);
check('clamp 250 -> 100', captive_tempo_clamp_speed(250) === 100);
check('clamp 42 -> 42', captive_tempo_clamp_speed(42) === 42);
check('clamp "37" (numeric string) -> 37', captive_tempo_clamp_speed('37') === 37);
check('clamp 33.7 rounds -> 34', captive_tempo_clamp_speed(33.7) === 34);
check('clamp "abc" -> null (rejected)', captive_tempo_clamp_speed('abc') === null);
check('clamp null -> null (rejected)', captive_tempo_clamp_speed(null) === null);

echo "\n==== RATE-LIMIT / PRESENCE CONSTANTS ====\n";
check('6 changes per minute per viewer', CY_TEMPO_RATE_MAX === 6 && CY_TEMPO_RATE_WINDOW === 60);
check('present-within-15s window', CY_PRESENCE_WINDOW === 15);
check('presence writes throttled to <=1 / 5s', CY_PRESENCE_THROTTLE === 5);

echo "\n==== REGIME WHITELIST + PUBLIC LEASE CONSTANTS ====\n";
// The public regime endpoint validates against this exact whitelist server-side.
check('regimes are exactly auto/day/night', CY_REGIMES === ['auto', 'day', 'night']);
check('public regime lease caps at 5 minutes', CY_REGIME_LEASE_SECONDS === 300);
check('public regime sets rate-limited to 8 / 60s per visitor', CY_REGIME_RATE_MAX === 8 && CY_REGIME_RATE_WINDOW === 60);

echo "\n" . ($fail === 0 ? "ALL PASS ($pass)\n" : "$fail FAILED, $pass passed\n");
exit($fail === 0 ? 0 : 1);
