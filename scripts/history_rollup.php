<?php
declare(strict_types=1);

// history_rollup.php - CLI: incrementally advance the HISTORY MODE day index.
//
// Folds any events not yet in the index (seq above the watermark) into
// history_days/history_hours, then advances the watermark. Cheap and idempotent:
// a no-op when nothing new has arrived. `events` is only READ.
//
// Intended for a cron (e.g. every minute):
//   * * * * * php /home/dabblela/cy/scripts/history_rollup.php >/dev/null 2>&1
//
// For a full rebuild use scripts/history_backfill.php instead.

require __DIR__ . '/../lib/db.php';
require __DIR__ . '/../lib/history.php';

$db = captive_db();
$stats = history_rollup($db);

fwrite(STDERR, sprintf(
    "rollup: %s (seq %d..%d, folded %d)\n",
    $stats['already_current'] ? 'already current' : 'advanced',
    $stats['from_seq'], $stats['to_seq'], $stats['processed']
));
