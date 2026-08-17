<?php
declare(strict_types=1);

// openverse-search.php - a thin public proxy over the Openverse image search
// API (https://api.openverse.org/v1/images/ - no API key required). The browser
// grid calls this instead of Openverse directly, which avoids CORS surprises and
// keeps anonymous rate-limiting on our IP rather than each visitor's. We return
// only the fields the composer needs: a thumbnail to show, the full URL to send
// back on submit, and a compact attribution string.

require __DIR__ . '/../../lib/http.php';

try {
    $q = trim((string)($_GET['q'] ?? ''));
    if ($q === '') {
        captive_json_response(['results' => []]);
    }
    if (mb_strlen($q) > 100) {
        $q = mb_substr($q, 0, 100);
    }

    $params = http_build_query([
        'q' => $q,
        'page_size' => 24,
        'license_type' => 'all-cc', // Creative Commons results only
        'mature' => 'false',
    ]);
    $url = 'https://api.openverse.org/v1/images/?' . $params;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT => 'CY/1.0 (+https://cy.dabblelabs.uk)',
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($raw === false || $status < 200 || $status >= 300) {
        captive_error_response('image search unavailable', 502);
    }

    $data = json_decode($raw, true);
    $out = [];
    foreach ($data['results'] ?? [] as $r) {
        $full = $r['url'] ?? '';
        $thumb = $r['thumbnail'] ?? $full;
        if (!is_string($full) || !preg_match('#^https://#', $full)) {
            continue;
        }
        $creator = trim((string)($r['creator'] ?? ''));
        $title = trim((string)($r['title'] ?? ''));
        $license = strtoupper(trim((string)($r['license'] ?? '')));
        $lv = trim((string)($r['license_version'] ?? ''));
        $bits = [];
        if ($title !== '') {
            $bits[] = '"' . $title . '"';
        }
        if ($creator !== '') {
            $bits[] = 'by ' . $creator;
        }
        if ($license !== '') {
            $bits[] = '(' . trim('CC ' . $license . ' ' . $lv) . ')';
        }
        $attrib = trim(implode(' ', $bits));
        if (mb_strlen($attrib) > 300) {
            $attrib = mb_substr($attrib, 0, 300);
        }
        $out[] = [
            'thumb' => $thumb,
            'url' => $full,
            'title' => $title !== '' ? $title : 'untitled',
            'attrib' => $attrib,
        ];
    }

    captive_json_response(['results' => $out]);
} catch (Throwable $e) {
    captive_error_response('image search error', 500);
}
