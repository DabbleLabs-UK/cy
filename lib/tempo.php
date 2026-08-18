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
        'INSERT INTO tempo (id, custom_speed, updated_at) VALUES (1, :s1, NOW())
         ON DUPLICATE KEY UPDATE custom_speed = :s2, updated_at = NOW()'
    );
    $stmt->bindValue(':s1', $speed, PDO::PARAM_INT);
    $stmt->bindValue(":s2", $speed, PDO::PARAM_INT);
    $stmt->execute();
}

function captive_tempo_discard_custom(PDO $db): void
{
    $db->prepare('UPDATE tempo SET custom_speed = NULL, updated_at = NOW() WHERE id = 1')->execute();
}

// ---- operator pause flag (owner-only, persisted on the same tempo row) ------
//
// The pause is separate from the duty-cycle rule: it is the owner stopping the
// LLM entirely so the machine's idle CPU/memory/draw can be read. The runner
// reads it via the tempo poll (it is folded into captive_tempo_state below) and,
// while paused, makes NO generation calls at all. Set via POST /api/admin.php.
//
// The getter is deliberately defensive: on a database that has not run the
// 002_paused migration yet, the column is missing - rather than 500 the tempo
// endpoint (which would break the whole page) it reports "not paused". So an
// un-migrated deploy simply cannot be paused; nothing else breaks.
function captive_tempo_paused(PDO $db): bool
{
    try {
        $v = $db->query('SELECT paused FROM tempo WHERE id = 1')->fetchColumn();
        return $v !== false && $v !== null && (int)$v !== 0;
    } catch (Throwable $e) {
        return false;
    }
}

function captive_tempo_set_paused(PDO $db, bool $paused): void
{
    $stmt = $db->prepare(
        'INSERT INTO tempo (id, paused, updated_at) VALUES (1, :p1, NOW())
         ON DUPLICATE KEY UPDATE paused = :p2, updated_at = NOW()'
    );
    $stmt->bindValue(':p1', $paused ? 1 : 0, PDO::PARAM_INT);
    $stmt->bindValue(":p2", $paused ? 1 : 0, PDO::PARAM_INT);
    $stmt->execute();
}

// ---- active model provider (owner-only, persisted on the same tempo row) -----
//
// Which model the runner generates with: 'ollama' (local, abliterated, free in API
// terms) or 'deepseek' (paid, metered). Owner-set via POST /api/admin.php; the
// runner reads it via its existing tempo poll and switches mid-loop, no restart.
// The DeepSeek key lives on the RUNNER, not here - so the runner reports whether it
// has a key (deepseek_available, updated from a side-channel capability event in
// ingest.php), and the admin switch refuses a DeepSeek selection with a clear
// reason when the runner has none. Both getters are defensive: on a database that
// has not run the 005_provider migration the columns are missing, so rather than
// 500 the tempo endpoint they report the safe defaults ('ollama' / unavailable).
const CY_PROVIDERS = ['ollama', 'deepseek'];

function captive_tempo_provider(PDO $db): string
{
    try {
        $v = $db->query('SELECT provider FROM tempo WHERE id = 1')->fetchColumn();
    } catch (Throwable $e) {
        return 'ollama';
    }
    return (is_string($v) && in_array($v, CY_PROVIDERS, true)) ? $v : 'ollama';
}

function captive_tempo_set_provider(PDO $db, string $provider): void
{
    if (!in_array($provider, CY_PROVIDERS, true)) {
        $provider = 'ollama';
    }
    $stmt = $db->prepare(
        'INSERT INTO tempo (id, provider, updated_at) VALUES (1, :p1, NOW())
         ON DUPLICATE KEY UPDATE provider = :p2, updated_at = NOW()'
    );
    $stmt->bindValue(':p1', $provider, PDO::PARAM_STR);
    $stmt->bindValue(':p2', $provider, PDO::PARAM_STR);
    $stmt->execute();
}

// Whether the runner currently has a DeepSeek key (reported by the runner via a
// capability event). Defensive: a missing column reads as "not available", so an
// un-migrated deploy simply cannot select DeepSeek.
function captive_tempo_deepseek_available(PDO $db): bool
{
    try {
        $v = $db->query('SELECT deepseek_available FROM tempo WHERE id = 1')->fetchColumn();
        return $v !== false && $v !== null && (int)$v !== 0;
    } catch (Throwable $e) {
        return false;
    }
}

// Record the runner-reported DeepSeek key availability. Best-effort and defensive:
// on an un-migrated deploy (no column) it does nothing, so ingestion never breaks.
function captive_tempo_set_deepseek_available(PDO $db, bool $available): void
{
    try {
        $stmt = $db->prepare(
            'INSERT INTO tempo (id, deepseek_available, updated_at) VALUES (1, :a1, NOW())
             ON DUPLICATE KEY UPDATE deepseek_available = :a2, updated_at = NOW()'
        );
        $stmt->bindValue(':a1', $available ? 1 : 0, PDO::PARAM_INT);
        $stmt->bindValue(':a2', $available ? 1 : 0, PDO::PARAM_INT);
        $stmt->execute();
    } catch (Throwable $e) {
        /* un-migrated deploy (no deepseek_available column) - degrade to no-op */
    }
}

// Resolve the current effective tempo, reconciling the store: if nobody is
// watching, any lingering custom value is discarded here. Returns the public
// shape ['speed', 'viewers', 'custom', 'paused']. The runner reads 'paused' from
// its existing tempo poll.
function captive_tempo_state(PDO $db): array
{
    $count = captive_viewer_count($db);
    $custom = captive_tempo_custom($db);
    $d = captive_tempo_decide($count, $custom);
    if ($d['discard']) {
        captive_tempo_discard_custom($db);
    }
    unset($d['discard']);
    $d['paused'] = captive_tempo_paused($db);
    // the active model provider rides the same row; the runner reads it here.
    $d['provider'] = captive_tempo_provider($db);
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
