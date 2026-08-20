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

echo "\n==== CUSTOM VALUE GRACE ON LAST-VIEWER-LEAVE ====\n";

// custom set, last viewer just left -> effective 5%, but the custom value SURVIVES: a
// momentary zero (backgrounded tab, dropped poll, blip) must not destroy it, so there
// is no discard yet. zeroForSeconds defaults to 0 (just hit zero).
$d = captive_tempo_decide(0, 70);
check('last viewer leaves with custom 70 -> effective 5%', $d['speed'] === 5 && $d['custom'] === false);
check('last viewer leaves with custom 70 -> value PRESERVED (no discard within grace)', $d['discard'] === false);

// still zero, but only just under the grace window -> still preserved.
$d = captive_tempo_decide(0, 70, CY_TEMPO_GRACE_SECONDS - 1);
check('zero for just under grace -> still preserved', $d['discard'] === false && $d['speed'] === 5);

// zero continuously for the full grace period -> NOW discard.
$d = captive_tempo_decide(0, 70, CY_TEMPO_GRACE_SECONDS);
check('zero for the full grace period -> discard the custom value', $d['discard'] === true && $d['speed'] === 5);

// zero well past grace -> discard.
$d = captive_tempo_decide(0, 70, CY_TEMPO_GRACE_SECONDS + 120);
check('zero well past grace -> discard', $d['discard'] === true);

// custom already null and nobody watching -> nothing to discard, ever.
$d = captive_tempo_decide(0, null, CY_TEMPO_GRACE_SECONDS + 120);
check('nobody watching, no custom -> no discard needed', $d['discard'] === false);

// custom set with viewers present -> never discarded, grace irrelevant.
$d = captive_tempo_decide(3, 12);
check('custom held while viewers present -> not discarded', $d['discard'] === false && $d['speed'] === 12);

echo "\n==== GRACE PRESERVES A CUSTOM VALUE ACROSS A BLIP ====\n";
// Model the reported bug: viewer sets 100 -> a dropped poll reads zero briefly ->
// viewer returns before grace lapses. The stored value must be intact throughout.
$custom = 100;                              // a watcher set 100
$d = captive_tempo_decide(1, $custom);
check('watcher present at custom 100', $d['speed'] === 100 && $d['custom'] === true);
$d = captive_tempo_decide(0, $custom, 10);  // brief zero (a blip), well inside grace
if ($d['discard']) {
    $custom = null;
}
check('brief zero does NOT discard the custom value', $custom === 100);
$d = captive_tempo_decide(1, $custom);      // viewer comes back
check('viewer returns -> the 100 is RESTORED (not 30, not 5)', $d['speed'] === 100 && $d['custom'] === true);

echo "\n==== AFTER GRACE LAPSES, A RETURNING VIEWER GETS 30%, NOT A STALE CUSTOM ====\n";
// Same sequence but the empty stretch outlasts the grace window: the value is genuinely
// discarded, so a later viewer starts from the 30% "someone watching" default.
$custom = 80;                                          // a watcher set 80
$d = captive_tempo_decide(1, $custom);
check('watcher present at custom 80', $d['speed'] === 80);
$d = captive_tempo_decide(0, $custom, CY_TEMPO_GRACE_SECONDS + 5); // empty past grace
if ($d['discard']) {
    $custom = null;                                    // the store would be cleared here
}
check('after grace lapses, custom is discarded from the store', $custom === null);
$d = captive_tempo_decide(1, $custom);                 // a viewer arrives again
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
check('custom value grace period is 90s', CY_TEMPO_GRACE_SECONDS === 90);
check('present-within-15s window', CY_PRESENCE_WINDOW === 15);
check('presence writes throttled to <=1 / 5s', CY_PRESENCE_THROTTLE === 5);

echo "\n==== REGIME WHITELIST + PUBLIC LEASE CONSTANTS ====\n";
// The public regime endpoint validates against this exact whitelist server-side.
check('regimes are exactly auto/day/night', CY_REGIMES === ['auto', 'day', 'night']);
check('public regime lease caps at 5 minutes', CY_REGIME_LEASE_SECONDS === 300);
check('public regime sets rate-limited to 8 / 60s per visitor', CY_REGIME_RATE_MAX === 8 && CY_REGIME_RATE_WINDOW === 60);

echo "\n" . ($fail === 0 ? "ALL PASS ($pass)\n" : "$fail FAILED, $pass passed\n");
exit($fail === 0 ? 0 : 1);
