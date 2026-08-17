<?php
declare(strict_types=1);

// tempo.php - the viewer-driven duty-cycle tempo.
//
// Tempo is a DUTY CYCLE, not a token rate: 100% means the runner generates
// continuously; lower values insert proportional idle between bursts. The
// effective tempo is DERIVED from live presence and one optional custom value:
//
//   nobody watching                 -> 5%   (and any custom value is discarded)
//   someone watching, no custom      -> 30%
//   someone watching, a custom value -> that value (1..100)
//
// So the custom value only ever applies while at least one viewer is present; the
// moment the last viewer leaves it is thrown away and a returning viewer starts
// from 30% again. captive_tempo_decide() is the pure heart of that rule and is
// unit-tested without a database.

const CY_TEMPO_IDLE = 5;            // % - nobody watching
const CY_TEMPO_WATCHING = 30;       // % - someone watching, no custom value
const CY_TEMPO_RATE_MAX = 6;        // custom changes allowed...
const CY_TEMPO_RATE_WINDOW = 60;    // ...per this many seconds, per viewer

// Pure: given the count of present viewers and the stored custom value (null if
// none), decide the effective tempo and whether the stored custom should now be
// discarded. No I/O so it can be tested directly.
//   returns ['speed'=>int, 'viewers'=>int, 'custom'=>bool, 'discard'=>bool]
function captive_tempo_decide(int $count, ?int $custom): array
{
    if ($count <= 0) {
        // last viewer gone: revert to 5% and throw any custom value away
        return ['speed' => CY_TEMPO_IDLE, 'viewers' => 0, 'custom' => false, 'discard' => $custom !== null];
    }
    if ($custom !== null) {
        return ['speed' => $custom, 'viewers' => $count, 'custom' => true, 'discard' => false];
    }
    return ['speed' => CY_TEMPO_WATCHING, 'viewers' => $count, 'custom' => false, 'discard' => false];
}

// Validate + clamp a requested speed to an integer 1..100, or null if not numeric.
function captive_tempo_clamp_speed($v): ?int
{
    if (!is_numeric($v)) {
        return null;
    }
    $n = (int)round((float)$v);
    if ($n < 1) {
        $n = 1;
    }
    if ($n > 100) {
        $n = 100;
    }
    return $n;
}

// ---- DB-backed state (thin wrappers over the single-row `tempo` table) ------

function captive_tempo_custom(PDO $db): ?int
{
    $v = $db->query('SELECT custom_speed FROM tempo WHERE id = 1')->fetchColumn();
    return ($v === false || $v === null) ? null : (int)$v;
}

function captive_tempo_set_custom(PDO $db, int $speed): void
{
    $stmt = $db->prepare(
        'INSERT INTO tempo (id, custom_speed, updated_at) VALUES (1, :s, NOW())
         ON DUPLICATE KEY UPDATE custom_speed = :s, updated_at = NOW()'
    );
    $stmt->bindValue(':s', $speed, PDO::PARAM_INT);
    $stmt->execute();
}

function captive_tempo_discard_custom(PDO $db): void
{
    $db->prepare('UPDATE tempo SET custom_speed = NULL, updated_at = NOW() WHERE id = 1')->execute();
}

// Resolve the current effective tempo, reconciling the store: if nobody is
// watching, any lingering custom value is discarded here. Returns the public
// shape ['speed', 'viewers', 'custom'].
function captive_tempo_state(PDO $db): array
{
    $count = captive_viewer_count($db);
    $custom = captive_tempo_custom($db);
    $d = captive_tempo_decide($count, $custom);
    if ($d['discard']) {
        captive_tempo_discard_custom($db);
    }
    unset($d['discard']);
    return $d;
}

// Rate-limit custom tempo changes to CY_TEMPO_RATE_MAX per CY_TEMPO_RATE_WINDOW
// seconds PER VIEWER. Reuses the generic rate_limits table with action='tempo',
// keyed by a 16-byte md5 of the viewer token (fits the VARBINARY(16) column).
// Returns true and logs the change if allowed; false if the viewer is over quota.
function captive_tempo_rate_ok(PDO $db, string $token): bool
{
    $key = md5($token, true); // 16 raw bytes
    $win = (int)CY_TEMPO_RATE_WINDOW;
    $sel = $db->prepare(
        "SELECT COUNT(*) FROM rate_limits WHERE ip = :k AND action = 'tempo' AND created_at > (NOW() - INTERVAL $win SECOND)"
    );
    $sel->bindValue(':k', $key, PDO::PARAM_LOB);
    $sel->execute();
    if ((int)$sel->fetchColumn() >= CY_TEMPO_RATE_MAX) {
        return false;
    }
    $ins = $db->prepare("INSERT INTO rate_limits (ip, action, created_at) VALUES (:k, 'tempo', NOW())");
    $ins->bindValue(':k', $key, PDO::PARAM_LOB);
    $ins->execute();
    return true;
}
