<?php
declare(strict_types=1);

// presence.php - cheap live-viewer presence for the tempo control.
//
// A viewer is anyone polling the public feed (stream.php). Each is keyed by a
// short-lived token: the signed visitor cookie if they already have one (people
// who have written a postcard), else a random per-session id in a lightweight
// cookie. last_seen is recorded in the `viewers` table, and a viewer counts as
// present if seen within CY_PRESENCE_WINDOW seconds.
//
// stream.php is hit ~once a second per viewer, so presence writes are THROTTLED
// to at most once every CY_PRESENCE_THROTTLE seconds per viewer using a tiny
// ping cookie holding the epoch of the last write - most polls touch no DB at
// all. The runner is NOT a viewer: it authenticates with X-Cy-Key and callers
// must not touch presence for it.

require_once __DIR__ . '/visitor.php';

const CY_VIEWER_COOKIE = 'cy_view';      // random per-session viewer id (no visitor cookie)
const CY_PING_COOKIE = 'cy_vp';          // epoch of this viewer's last presence write
const CY_PRESENCE_WINDOW = 15;           // seconds: seen within this = present
const CY_PRESENCE_THROTTLE = 5;          // seconds: min gap between presence writes per viewer

// Secure flag mirrors the visitor cookie logic (https behind a proxy counts).
function captive_presence_secure(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

// Resolve the current viewer's token, minting + setting a session cookie if they
// have neither a visitor cookie nor a viewer cookie yet. Prefixed so a visitor
// id and a random session id can never collide.
function captive_viewer_token(): string
{
    $vid = captive_current_visitor_id();
    if ($vid !== null) {
        return 'v:' . $vid;
    }
    $raw = $_COOKIE[CY_VIEWER_COOKIE] ?? '';
    if (preg_match('/^[a-f0-9]{32}$/', $raw)) {
        return 's:' . $raw;
    }
    $id = bin2hex(random_bytes(16));
    setcookie(CY_VIEWER_COOKIE, $id, [
        'path' => '/',
        'httponly' => true,
        'secure' => captive_presence_secure(),
        'samesite' => 'Lax',
    ]); // session cookie (no expiry): a "per-session id" as the spec asks
    return 's:' . $id;
}

// Record that the current viewer is present, throttled to once every
// CY_PRESENCE_THROTTLE seconds via the ping cookie so a 1Hz poll is cheap.
// Best-effort: callers wrap this so a presence hiccup never breaks the feed.
function captive_touch_presence(PDO $db): void
{
    $now = time();
    $last = isset($_COOKIE[CY_PING_COOKIE]) ? (int)$_COOKIE[CY_PING_COOKIE] : 0;
    if ($now - $last >= 0 && $now - $last < CY_PRESENCE_THROTTLE) {
        return; // seen very recently - skip the DB entirely
    }

    $token = captive_viewer_token();
    $up = $db->prepare(
        'INSERT INTO viewers (token, last_seen) VALUES (:t, NOW())
         ON DUPLICATE KEY UPDATE last_seen = NOW()'
    );
    $up->bindValue(':t', $token, PDO::PARAM_STR);
    $up->execute();

    // sweep stale rows occasionally (presence writes are already rare)
    if (random_int(1, 20) === 1) {
        $db->exec('DELETE FROM viewers WHERE last_seen < (NOW() - INTERVAL 300 SECOND)');
    }

    setcookie(CY_PING_COOKIE, (string)$now, [
        'path' => '/',
        'httponly' => true,
        'secure' => captive_presence_secure(),
        'samesite' => 'Lax',
    ]);
}

// Pure predicate for "present": seen no more than $window seconds ago (and not in
// the future). This is the single definition of presence; captive_viewer_count()
// below is its set-based SQL equivalent (last_seen >= NOW() - INTERVAL window).
function captive_is_present(int $lastSeenEpoch, int $now, int $window = CY_PRESENCE_WINDOW): bool
{
    $age = $now - $lastSeenEpoch;
    return $age >= 0 && $age <= $window;
}

// How many distinct viewers were seen within the presence window.
function captive_viewer_count(PDO $db): int
{
    $w = (int)CY_PRESENCE_WINDOW;
    $c = $db->query("SELECT COUNT(*) FROM viewers WHERE last_seen >= (NOW() - INTERVAL $w SECOND)")->fetchColumn();
    return (int)$c;
}
