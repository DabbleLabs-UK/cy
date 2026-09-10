<?php
declare(strict_types=1);

// Public, focused correspondence history. Queue mechanics remain authoritative
// in postcards; replies are associated from their postcard_out event id.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/visitor.php';
require __DIR__ . '/../../lib/postcard_archive.php';

header('Cache-Control: private, no-store');

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        captive_error_response('method not allowed', 405);
    }

    $filter = captive_postcard_archive_filter($_GET['status'] ?? 'all');
    $cursor = captive_postcard_archive_cursor($_GET['cursor'] ?? null);
    $limit = captive_postcard_archive_limit($_GET['limit'] ?? CY_POSTCARD_ARCHIVE_DEFAULT_LIMIT);
    $visitorId = captive_current_visitor_id();
    $page = captive_postcard_archive_fetch(captive_db(), $filter, $cursor, $limit, $visitorId);

    captive_json_response([
        'ok' => true,
        'filter' => $filter,
        'items' => $page['items'],
        'page' => [
            'limit' => $limit,
            'has_more' => $page['has_more'],
            'next_cursor' => $page['next_cursor'],
        ],
    ]);
} catch (InvalidArgumentException $e) {
    captive_error_response($e->getMessage(), 400);
} catch (Throwable) {
    captive_error_response('internal error', 500);
}
