<?php
declare(strict_types=1);

// history.php - PUBLIC, read-only day index for the HISTORY MODE spine.
//
// Returns one entry per day, each with its hourly profile, mood tint and event
// markers - aggregate only, never raw events. Small and cheap enough to fetch on
// page load: it reads the pre-built index tables (history_days/history_hours),
// it does NOT scan `events` and it does NOT roll anything up on request (that is
// a separate cron job - see scripts/history_rollup.php). If the index has not
// been built yet (migration not applied, backfill not run) it returns an empty
// list rather than erroring, so the live site is never coupled to it.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/history.php';

// Public, aggregate, slow-moving data: allow a short shared cache.
header('Cache-Control: public, max-age=30');

try {
    $db = captive_db();

    try {
        $days = history_day_index($db);
        $builtThrough = history_cursor($db);
    } catch (PDOException $e) {
        // Index tables absent (un-migrated) - degrade to an empty, honest answer.
        captive_json_response(['ok' => true, 'built_through' => 0, 'days' => []]);
    }

    captive_json_response([
        'ok' => true,
        'built_through' => $builtThrough,
        'moods' => HISTORY_MOOD_TINTS, // legend: axis -> tint, so the client need not hardcode it
        'days' => $days,
    ]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
