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

// The regime accessors below reconcile a PUBLIC regime lease against live presence
// (captive_presence_has_token), so this module depends on presence.php. It is also
// a latent dependency already - captive_tempo_state() calls captive_viewer_count() -
// so require it explicitly rather than relying on the caller's load order.
require_once __DIR__ . '/presence.php';

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

// ---- regime override: an owner set (sticky) OR a public lease (self-releasing) --
//
// Forces Cy's day/night + sleep state, overriding the clock-based lights-out window
// (22:30-06:30) the runner computes itself:
//   'auto'  - the default: follow the clock (no override)
//   'day'   - force awake (leave dream mode, resume the normal waking cadence)
//   'night' - force asleep (dream mode) regardless of the hour
// The runner reads it via its existing tempo poll and switches mid-loop, no restart.
//
// TWO kinds of set share the same regime_override column, distinguished by
// regime_source:
//   'admin'  - the OWNER's set (via /api/admin.php). STICKY: it never lapses on its
//              own; only the owner changes it. This is exactly the 006 behaviour.
//   'public' - a VISITOR's set (via /api/regime.php). A short LEASE: it holds for at
//              most CY_REGIME_LEASE_SECONDS, and releases EARLY the instant the
//              visitor who set it (regime_holder) is no longer present. Expiry is on
//              READ, never on a timer: captive_tempo_regime() returns 'auto' and
//              clears the lease the first time it reads one that has expired or whose
//              holder has left. A public set can never override an admin set that is
//              forcing a non-'auto' regime.
//
// All accessors are defensive: on a database that has not run the 006/008 migrations
// the columns are missing, so rather than 500 the tempo endpoint they fall back to
// the safe default ('auto', treated as an admin set with no lease).
const CY_REGIMES = ['auto', 'day', 'night'];
const CY_REGIME_LEASE_SECONDS = 300;   // 5 min: hard ceiling on a public regime lease
const CY_REGIME_RATE_MAX = 8;          // public regime sets allowed...
const CY_REGIME_RATE_WINDOW = 60;      // ...per this many seconds, per visitor

// The effective regime, reconciling a public lease against live presence. A public
// lease that has expired OR whose holder is no longer watching is treated as lapsed:
// this returns 'auto' and opportunistically clears the row (no cron, expiry on read).
function captive_tempo_regime(PDO $db): string
{
    try {
        $row = $db->query(
            'SELECT regime_override AS regime, regime_source AS source, regime_holder AS holder,
                    (regime_expires_at IS NOT NULL AND regime_expires_at > NOW()) AS unexpired
             FROM tempo WHERE id = 1'
        )->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        // Pre-008 (no lease columns): fall back to the plain override; pre-006 -> auto.
        try {
            $v = $db->query('SELECT regime_override FROM tempo WHERE id = 1')->fetchColumn();
            return (is_string($v) && in_array($v, CY_REGIMES, true)) ? $v : 'auto';
        } catch (Throwable $e2) {
            return 'auto';
        }
    }
    if (!$row) {
        return 'auto';
    }
    $regime = (is_string($row['regime']) && in_array($row['regime'], CY_REGIMES, true)) ? $row['regime'] : 'auto';
    if ($regime === 'auto') {
        return 'auto'; // nothing to lease/expire
    }
    // An owner set is sticky - it holds until the owner changes it.
    if (($row['source'] ?? 'admin') !== 'public') {
        return $regime;
    }
    // A public lease holds only while UNEXPIRED and its holder is still present.
    $unexpired = (int)($row['unexpired'] ?? 0) === 1;
    $holderPresent = is_string($row['holder']) && $row['holder'] !== ''
        && captive_presence_has_token($db, 'v:' . $row['holder']);
    if ($unexpired && $holderPresent) {
        return $regime;
    }
    // Lapsed: revert to 'auto' and clear the lease on the spot (expiry on read).
    captive_tempo_clear_regime_lease($db);
    return 'auto';
}

// Revert the regime to the default and drop any public lease. Also used by an
// owner 'auto' set. Defensive: a pre-008 deploy has no lease columns to clear.
function captive_tempo_clear_regime_lease(PDO $db): void
{
    try {
        $db->exec(
            "UPDATE tempo
                SET regime_override = 'auto', regime_source = 'admin',
                    regime_holder = NULL, regime_expires_at = NULL, updated_at = NOW()
              WHERE id = 1"
        );
    } catch (Throwable $e) {
        // pre-008 deploy (no lease columns) - fall back to the plain override reset.
        try {
            $db->exec("UPDATE tempo SET regime_override = 'auto', updated_at = NOW() WHERE id = 1");
        } catch (Throwable $e2) {
            /* pre-006 too - nothing to clear */
        }
    }
}

// The OWNER's sticky regime set (via /api/admin.php). Marks the source 'admin' and
// clears any public lease, so an owner set always wins and never lapses. Falls back
// to the plain override on a pre-008 deploy so the owner control still works.
function captive_tempo_set_regime(PDO $db, string $regime): void
{
    if (!in_array($regime, CY_REGIMES, true)) {
        $regime = 'auto';
    }
    try {
        $stmt = $db->prepare(
            "INSERT INTO tempo (id, regime_override, regime_source, regime_holder, regime_expires_at, updated_at)
             VALUES (1, :r1, 'admin', NULL, NULL, NOW())
             ON DUPLICATE KEY UPDATE regime_override = :r2, regime_source = 'admin',
                regime_holder = NULL, regime_expires_at = NULL, updated_at = NOW()"
        );
        $stmt->bindValue(':r1', $regime, PDO::PARAM_STR);
        $stmt->bindValue(':r2', $regime, PDO::PARAM_STR);
        $stmt->execute();
    } catch (Throwable $e) {
        // pre-008 deploy (no lease columns): set the plain override alone.
        // NB distinct placeholder names (:p1/:p2): PDO requires each named
        // placeholder to appear exactly once in the statement.
        $stmt = $db->prepare(
            'INSERT INTO tempo (id, regime_override, updated_at) VALUES (1, :p1, NOW())
             ON DUPLICATE KEY UPDATE regime_override = :p2, updated_at = NOW()'
        );
        $stmt->bindValue(':p1', $regime, PDO::PARAM_STR);
        $stmt->bindValue(':p2', $regime, PDO::PARAM_STR);
        $stmt->execute();
    }
}

// A PUBLIC visitor's regime lease (via /api/regime.php). $holder is the caller's
// server-verified signed visitor id (NEVER anything client-supplied) and $regime is
// already whitelisted by the caller. Returns one of:
//   'ok'           - lease set (or, for 'auto', the visitor's own lease released)
//   'admin_locked' - the owner is forcing a non-'auto' regime; a public set is refused
//   'held'         - another present visitor holds a live lease; it cannot be stolen
// The guards read the CURRENT row (after lapsing any dead lease first) so a public
// set can neither override an owner force nor take over a live lease it does not own.
function captive_tempo_public_set_regime(PDO $db, string $regime, string $holder): string
{
    if (!in_array($regime, CY_REGIMES, true)) {
        $regime = 'auto';
    }
    // Lapse any dead lease first so the guards below see a live truth.
    captive_tempo_regime($db);

    $row = $db->query(
        'SELECT regime_override AS regime, regime_source AS source, regime_holder AS holder,
                (regime_expires_at IS NOT NULL AND regime_expires_at > NOW()) AS unexpired
         FROM tempo WHERE id = 1'
    )->fetch(PDO::FETCH_ASSOC);
    $curRegime = ($row && is_string($row['regime']) && in_array($row['regime'], CY_REGIMES, true)) ? $row['regime'] : 'auto';
    $curSource = ($row && ($row['source'] ?? 'admin') === 'public') ? 'public' : 'admin';

    // An owner force outranks any public set.
    if ($curSource === 'admin' && $curRegime !== 'auto') {
        return 'admin_locked';
    }
    // A live lease held by a DIFFERENT present visitor must not be stolen.
    if ($curSource === 'public' && $curRegime !== 'auto' && (int)($row['unexpired'] ?? 0) === 1) {
        $curHolder = is_string($row['holder']) ? $row['holder'] : '';
        if ($curHolder !== '' && $curHolder !== $holder && captive_presence_has_token($db, 'v:' . $curHolder)) {
            return 'held';
        }
    }

    // 'auto' from the holder releases their own lease; otherwise set/renew the lease.
    if ($regime === 'auto') {
        captive_tempo_clear_regime_lease($db);
        return 'ok';
    }
    $lease = (int)CY_REGIME_LEASE_SECONDS;
    $stmt = $db->prepare(
        "UPDATE tempo
            SET regime_override = :r, regime_source = 'public', regime_holder = :h,
                regime_expires_at = (NOW() + INTERVAL $lease SECOND), updated_at = NOW()
          WHERE id = 1"
    );
    $stmt->bindValue(':r', $regime, PDO::PARAM_STR);
    $stmt->bindValue(':h', $holder, PDO::PARAM_STR);
    $stmt->execute();
    return 'ok';
}

// The regime plus the lease facts the endpoints/UI need: the effective regime (dead
// leases already lapsed by captive_tempo_regime), who set it, the seconds left on a
// public lease, and whether an owner force locks the public control.
//   returns ['regime'=>string, 'source'=>'admin'|'public', 'lease_remaining'=>int, 'locked'=>bool]
function captive_tempo_regime_state(PDO $db): array
{
    $regime = captive_tempo_regime($db); // lapses a dead lease first
    $out = ['regime' => $regime, 'source' => 'admin', 'lease_remaining' => 0, 'locked' => false];
    try {
        $row = $db->query(
            'SELECT regime_source AS source,
                    GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), regime_expires_at)) AS remaining
             FROM tempo WHERE id = 1'
        )->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return $out; // pre-008: no lease, owner source
    }
    if (!$row) {
        return $out;
    }
    $out['source'] = (($row['source'] ?? 'admin') === 'public') ? 'public' : 'admin';
    if ($out['source'] === 'public' && $regime !== 'auto') {
        $out['lease_remaining'] = (int)$row['remaining'];
    }
    $out['locked'] = ($out['source'] === 'admin' && $regime !== 'auto');
    return $out;
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
    // the owner regime override rides the same row too; the runner reads it here
    // off its existing poll and forces day/night without a restart.
    $d['regime'] = captive_tempo_regime($db);
    return $d;
}

// ---- incarceration day (public, derived from the same tempo row) -----------
//
// The header "DAY N" pill: day 1 is the intake day itself, incrementing at LOCAL
// (Europe/London) midnight - never on a rolling 24h boundary. `intake_at` is the
// authoritative earliest timestamp for the current stretch, persisted ONCE on the
// single-row `tempo` table (same pattern as `paused`/`provider`/`regime_override`)
// so the count stays stable even once old `events` rows are pruned. Both accessors
// are defensive: on a database that has not run the 007_intake migration the
// column is missing, so rather than 500 the caller falls back to day 1.
function captive_tempo_intake_at(PDO $db): ?string
{
    try {
        $v = $db->query('SELECT intake_at FROM tempo WHERE id = 1')->fetchColumn();
        return ($v === false || $v === null) ? null : (string)$v;
    } catch (Throwable $e) {
        return null;
    }
}

// Persist the intake timestamp once. Never overwrites an existing value (WHERE
// intake_at IS NULL), so a slow request racing a faster one cannot clobber the
// real earliest moment with a later one.
function captive_tempo_set_intake_at(PDO $db, string $ts): void
{
    try {
        $stmt = $db->prepare('UPDATE tempo SET intake_at = :ts WHERE id = 1 AND intake_at IS NULL');
        $stmt->bindValue(':ts', $ts, PDO::PARAM_STR);
        $stmt->execute();
    } catch (Throwable $e) {
        /* un-migrated deploy (no intake_at column) - degrade to no-op */
    }
}

// Resolve the authoritative intake timestamp: the persisted value if already set,
// else the first event ever logged (so an already-running deploy backfills a
// sensible date instead of resetting to "today"), else - a genuinely fresh
// install with no history at all - right now. Whichever it resolves to is
// persisted immediately so it never moves again, even once early events age out.
function captive_tempo_resolve_intake_at(PDO $db): string
{
    $intake = captive_tempo_intake_at($db);
    if ($intake !== null) {
        return $intake;
    }
    $earliest = null;
    try {
        $v = $db->query('SELECT MIN(ts) FROM events')->fetchColumn();
        $earliest = ($v === false || $v === null) ? null : (string)$v;
    } catch (Throwable $e) {
        $earliest = null;
    }
    $seed = $earliest ?? date('Y-m-d H:i:s');
    captive_tempo_set_intake_at($db, $seed);
    // Read back rather than trust $seed directly: a concurrent request may have
    // already won the race and persisted a different (earlier or equal) value.
    return captive_tempo_intake_at($db) ?? $seed;
}

// Days into the current stretch. Day 1 = the intake day itself; the count steps up
// exactly once per LOCAL (Europe/London) midnight crossed since then, matching the
// runner's own day-rollover rule (date change, not a rolling 24h window).
function captive_incarceration_day(PDO $db): int
{
    $intakeAt = captive_tempo_resolve_intake_at($db);
    $tz = new DateTimeZone('Europe/London');
    // Event timestamps are stored as already-local wall-clock strings (see
    // lib/history.php) - read the date portion directly rather than reinterpreting
    // it as UTC.
    $intake = DateTime::createFromFormat('!Y-m-d', substr($intakeAt, 0, 10), $tz);
    if ($intake === false) {
        return 1;
    }
    $today = new DateTime('today', $tz);
    $days = (int)$intake->diff($today)->days;
    return $days + 1;
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

// Rate-limit public regime sets to CY_REGIME_RATE_MAX per CY_REGIME_RATE_WINDOW
// seconds PER VISITOR. Same shape as captive_tempo_rate_ok (the regime endpoint is
// the other public write), keyed by a 16-byte md5 of the viewer token with a
// distinct action='regime'. Returns true and logs the set if allowed; false if over.
function captive_regime_rate_ok(PDO $db, string $token): bool
{
    $key = md5($token, true); // 16 raw bytes
    $win = (int)CY_REGIME_RATE_WINDOW;
    $sel = $db->prepare(
        "SELECT COUNT(*) FROM rate_limits WHERE ip = :k AND action = 'regime' AND created_at > (NOW() - INTERVAL $win SECOND)"
    );
    $sel->bindValue(':k', $key, PDO::PARAM_LOB);
    $sel->execute();
    if ((int)$sel->fetchColumn() >= CY_REGIME_RATE_MAX) {
        return false;
    }
    $ins = $db->prepare("INSERT INTO rate_limits (ip, action, created_at) VALUES (:k, 'regime', NOW())");
    $ins->bindValue(':k', $key, PDO::PARAM_LOB);
    $ins->execute();
    return true;
}
