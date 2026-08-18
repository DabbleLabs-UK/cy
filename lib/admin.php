<?php
declare(strict_types=1);

// admin.php - who counts as the owner (admin), and how we decide it.
//
// Admin unlocks the operator controls: the pause/resume control and the RAW
// debugging view. There are TWO ways to be admin, and EITHER grants it:
//
//   1. AUTOMATIC same-network detection (the normal case). DELL - the machine
//      the runner lives on - POSTs to /api/ingest.php constantly, authenticated
//      with X-Cy-Key, so the server records DELL's public IP for free. When a
//      browser's resolved public IP matches the IP DELL last ingested from, that
//      browser is behind the same NAT as DELL - i.e. on the same home network -
//      so it is treated as the owner. No ?111 to type.
//
//   2. The ?111 query flag as a FALLBACK, so the owner can still get in from a
//      phone on mobile data, or from anywhere off the home network. Deliberate
//      light obscurity, agreed with the owner - NOT a login.
//
// HONEST CAVEAT: anyone else behind the same home NAT (a housemate, a guest on
// the wifi) is also treated as admin, because they share DELL's public IP. That
// is ACCEPTED and INTENDED for this deployment - the admin controls are benign
// (pause the model, view the raw feed) and the home network is trusted. This is
// a deliberate trade, not an oversight.
//
// Traffic reaches us through Cloudflare (proxied), so REMOTE_ADDR is a Cloudflare
// edge, not the visitor. CF-Connecting-IP carries the true client address - but
// it is only trustworthy when the request genuinely came FROM Cloudflare, else a
// direct caller could forge the header and grant themselves admin. So we trust
// CF-Connecting-IP only when REMOTE_ADDR is inside Cloudflare's published ranges,
// and fall back to REMOTE_ADDR otherwise. See captive_admin_client_ip().

// Cloudflare's published edge ranges. Source of truth: https://www.cloudflare.com/ips
// These change rarely; refresh this list occasionally against that page. We do
// NOT fetch them at request time (no network call on every hit, and no failure
// mode where a fetch outage breaks admin detection) - a static embedded list is
// deliberate.
const CY_CLOUDFLARE_RANGES = [
    // IPv4
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
    // IPv6
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32',
];

// How long DELL's last-seen ingest IP stays trusted. If DELL has not ingested
// within this window we do NOT auto-grant admin on a stale value (the runner may
// be off, or the home IP may have changed under it).
const CY_ADMIN_INGEST_FRESH_SECONDS = 900; // 15 minutes

// Write DELL's origin IP at most this often. DELL ingests constantly; there is no
// point rewriting the single origin row on every request.
const CY_ADMIN_INGEST_WRITE_SECONDS = 60;  // 1 minute

// ---- pure IP helpers (no I/O - unit-tested in tests/admin_test.php) ---------

// True if $ip falls inside the CIDR $cidr. Works for both IPv4 and IPv6; a
// family mismatch (v4 ip vs v6 cidr or vice versa) is simply false. Compares the
// first N bits of the packed addresses.
function captive_ip_in_cidr(string $ip, string $cidr): bool
{
    if (strpos($cidr, '/') === false) {
        return false;
    }
    [$subnet, $bitsStr] = explode('/', $cidr, 2);
    if (!is_numeric($bitsStr)) {
        return false;
    }
    $bits = (int)$bitsStr;
    $ipBin = @inet_pton($ip);
    $subnetBin = @inet_pton($subnet);
    if ($ipBin === false || $subnetBin === false) {
        return false;
    }
    if (strlen($ipBin) !== strlen($subnetBin)) {
        return false; // different address families
    }
    $maxBits = strlen($ipBin) * 8;
    if ($bits < 0 || $bits > $maxBits) {
        return false;
    }
    $wholeBytes = intdiv($bits, 8);
    $remBits = $bits % 8;
    if ($wholeBytes > 0 && substr($ipBin, 0, $wholeBytes) !== substr($subnetBin, 0, $wholeBytes)) {
        return false;
    }
    if ($remBits !== 0) {
        $mask = 0xff << (8 - $remBits) & 0xff;
        if ((ord($ipBin[$wholeBytes]) & $mask) !== (ord($subnetBin[$wholeBytes]) & $mask)) {
            return false;
        }
    }
    return true;
}

// True if $ip is one of Cloudflare's published edge addresses.
function captive_ip_is_cloudflare(string $ip): bool
{
    foreach (CY_CLOUDFLARE_RANGES as $cidr) {
        if (captive_ip_in_cidr($ip, $cidr)) {
            return true;
        }
    }
    return false;
}

// Do two public IPs indicate the SAME network?
//   IPv4 -> exact match (a home NAT presents one shared public v4 address).
//   IPv6 -> same /64 prefix. Devices on one LAN commonly share the /64 delegated
//           to the site and differ only in the host portion, so an exact match
//           would wrongly reject the owner's other device on the same network.
// A family mismatch (one v4, one v6) is never the same network.
function captive_ip_same_network(string $a, string $b): bool
{
    $aBin = @inet_pton($a);
    $bBin = @inet_pton($b);
    if ($aBin === false || $bBin === false) {
        return false;
    }
    if (strlen($aBin) !== strlen($bBin)) {
        return false; // different families
    }
    if (strlen($aBin) === 4) {
        return $aBin === $bBin; // IPv4: exact
    }
    return substr($aBin, 0, 8) === substr($bBin, 0, 8); // IPv6: /64 prefix
}

// Resolve the REAL client IP, trusting CF-Connecting-IP only when the request
// actually arrived from a Cloudflare edge (REMOTE_ADDR in CF's ranges). Otherwise
// a direct caller could forge CF-Connecting-IP, so we fall back to REMOTE_ADDR.
function captive_admin_client_ip(): string
{
    $remote = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $cf = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '';
    if ($cf !== '' && captive_ip_is_cloudflare($remote) && filter_var($cf, FILTER_VALIDATE_IP) !== false) {
        return $cf;
    }
    return $remote;
}

// ---- DB-backed state (the single-row `ingest_origin` table) -----------------

// Record DELL's origin IP from an authenticated ingest. Called from ingest.php,
// which is already X-Cy-Key authenticated, so the IP is trustworthy. Skips the
// write when the row already holds this IP and was touched within the last minute
// (DELL ingests constantly - no point rewriting the row every time). Best-effort
// and defensive: on a database that has not run the 003_ingest_origin migration
// the table is missing, and rather than break ingestion this simply does nothing.
function captive_admin_record_ingest_ip(PDO $db, string $ip): void
{
    try {
        $win = (int)CY_ADMIN_INGEST_WRITE_SECONDS;
        $sel = $db->prepare(
            "SELECT 1 FROM ingest_origin
             WHERE id = 1 AND ip = :ip AND seen_at > (NOW() - INTERVAL $win SECOND)"
        );
        $sel->bindValue(':ip', $ip, PDO::PARAM_STR);
        $sel->execute();
        if ($sel->fetchColumn() !== false) {
            return; // fresh enough and unchanged
        }
        $up = $db->prepare(
            'INSERT INTO ingest_origin (id, ip, seen_at) VALUES (1, :ip, NOW())
             ON DUPLICATE KEY UPDATE ip = VALUES(ip), seen_at = NOW()'
        );
        $up->bindValue(':ip', $ip, PDO::PARAM_STR);
        $up->execute();
    } catch (Throwable $e) {
        // un-migrated deploy (no ingest_origin table) - degrade to no auto-admin.
    }
}

// DELL's last-seen ingest IP, or null if none or stale (older than the fresh
// window). The staleness check is done in SQL so it uses the DB clock, avoiding
// any PHP/DB timezone skew. Defensive: a missing table yields null (no auto
// admin; ?111 still works).
function captive_admin_dell_ip(PDO $db): ?string
{
    try {
        $win = (int)CY_ADMIN_INGEST_FRESH_SECONDS;
        $stmt = $db->query(
            "SELECT ip FROM ingest_origin
             WHERE id = 1 AND seen_at > (NOW() - INTERVAL $win SECOND)"
        );
        $ip = $stmt->fetchColumn();
    } catch (Throwable $e) {
        return null;
    }
    return ($ip === false || $ip === null || $ip === '') ? null : (string)$ip;
}

// True when this request's resolved client IP is on the same network as DELL's
// last (recent) ingest. This is the automatic admin path.
function captive_admin_same_network(PDO $db): bool
{
    $dell = captive_admin_dell_ip($db);
    if ($dell === null) {
        return false;
    }
    return captive_ip_same_network(captive_admin_client_ip(), $dell);
}

// The single admin decision, enforced everywhere admin is gated (the page render
// AND every admin endpoint - never trust the UI alone). Admin when EITHER the
// ?111 fallback flag is present OR this browser is on DELL's network.
function captive_is_admin(PDO $db): bool
{
    if (array_key_exists('111', $_GET)) {
        return true; // fallback: owner off-network (mobile data, elsewhere)
    }
    return captive_admin_same_network($db);
}
