<?php
declare(strict_types=1);

// visitor.php - remembering people who write to Cy.
//
// On the first postcard a visitor is issued a random visitor_id inside a signed,
// httpOnly cookie. On every later postcard the cookie is verified and the same
// visitor is recognised. We store nothing identifying beyond a chosen handle and
// a compact rolling summary (`notes`) of what they have said; standing toward
// them (warmth/suspicion/grudge) uses the same relations triple as the inmate
// cast. IPs are never written to the visitors table - only to postcards for
// rate limiting.

const CY_VISITOR_COOKIE = 'cy_v';
const CY_VISIT_GAP_SECONDS = 1800; // >30 min since last postcard counts as a new visit

// Sign a visitor_id: "<id>.<hex hmac>". Constant-time verified on read.
function captive_sign_visitor(string $id): string
{
    $mac = hash_hmac('sha256', $id, captive_cookie_secret());
    return $id . '.' . $mac;
}

// Verify a signed cookie value, returning the visitor_id or null if tampered.
function captive_verify_visitor(string $signed): ?string
{
    $dot = strrpos($signed, '.');
    if ($dot === false) {
        return null;
    }
    $id = substr($signed, 0, $dot);
    $mac = substr($signed, $dot + 1);
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
        return null;
    }
    $expected = hash_hmac('sha256', $id, captive_cookie_secret());
    return hash_equals($expected, $mac) ? $id : null;
}

// Read a valid visitor_id from the request cookie, or null if absent/invalid.
function captive_current_visitor_id(): ?string
{
    $raw = $_COOKIE[CY_VISITOR_COOKIE] ?? '';
    if ($raw === '') {
        return null;
    }
    return captive_verify_visitor($raw);
}

// Ensure the response carries a signed visitor cookie for $id (1 year, httpOnly,
// SameSite=Lax, Secure when served over https).
function captive_set_visitor_cookie(string $id): void
{
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    setcookie(CY_VISITOR_COOKIE, captive_sign_visitor($id), [
        'expires' => time() + 365 * 24 * 3600,
        'path' => '/',
        'httponly' => true,
        'secure' => $secure,
        'samesite' => 'Lax',
    ]);
}

// Resolve the current visitor for an incoming postcard: verify the cookie (or
// mint a new id + set the cookie), upsert the visitors row (bumping counts and
// visit/last_seen), and return the row as an assoc array. `handle` is updated to
// the latest non-empty name the person chose.
function captive_touch_visitor(PDO $db, string $handle): array
{
    $id = captive_current_visitor_id();
    $fresh = false;
    if ($id === null) {
        $id = bin2hex(random_bytes(16));
        $fresh = true;
    }
    captive_set_visitor_cookie($id);

    $existing = null;
    if (!$fresh) {
        $sel = $db->prepare('SELECT * FROM visitors WHERE visitor_id = :id');
        $sel->bindValue(':id', $id, PDO::PARAM_STR);
        $sel->execute();
        $existing = $sel->fetch() ?: null;
    }

    if ($existing === null) {
        $ins = $db->prepare(
            'INSERT INTO visitors (visitor_id, handle, first_seen, last_seen, visit_count, postcard_count)
             VALUES (:id, :handle, NOW(), NOW(), 1, 1)'
        );
        $ins->bindValue(':id', $id, PDO::PARAM_STR);
        $ins->bindValue(':handle', $handle !== '' ? $handle : null);
        $ins->execute();
        $sel = $db->prepare('SELECT * FROM visitors WHERE visitor_id = :id');
        $sel->bindValue(':id', $id, PDO::PARAM_STR);
        $sel->execute();
        return $sel->fetch();
    }

    // A gap since the last postcard counts as a fresh visit.
    $gapSql = 'TIMESTAMPDIFF(SECOND, last_seen, NOW()) >= ' . (int)CY_VISIT_GAP_SECONDS;
    $upd = $db->prepare(
        "UPDATE visitors
         SET postcard_count = postcard_count + 1,
             visit_count = visit_count + IF($gapSql, 1, 0),
             handle = COALESCE(NULLIF(:handle, ''), handle),
             last_seen = NOW()
         WHERE visitor_id = :id"
    );
    $upd->bindValue(':handle', $handle);
    $upd->bindValue(':id', $id, PDO::PARAM_STR);
    $upd->execute();

    $sel = $db->prepare('SELECT * FROM visitors WHERE visitor_id = :id');
    $sel->bindValue(':id', $id, PDO::PARAM_STR);
    $sel->execute();
    return $sel->fetch();
}
