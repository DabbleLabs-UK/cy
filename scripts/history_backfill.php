<?php
declare(strict_types=1);

// history_backfill.php - CLI: build the HISTORY MODE day index from scratch.
//
// Wipes history_days/history_hours, resets the watermark to 0, and rebuilds the
// whole index from the existing `events` log. `events` is only READ - never
// written or deleted. Safe to run repeatedly. Run once after applying
// sql/004_history.sql, then rely on scripts/history_rollup.php (cron) to keep it
// current.
//
//   php scripts/history_backfill.php
//
// Reports what it found: days, events folded, and a sample day.

require __DIR__ . '/../lib/db.php';
require __DIR__ . '/../lib/history.php';

$db = captive_db();

$t0 = microtime(true);
$stats = history_backfill($db);
$elapsed = round(microtime(true) - $t0, 2);

$dayCount = (int)$db->query('SELECT COUNT(*) FROM history_days')->fetchColumn();
$hourCount = (int)$db->query('SELECT COUNT(*) FROM history_hours')->fetchColumn();

fwrite(STDERR, sprintf(
    "backfill complete in %ss: folded %d events (seq %d..%d) into %d day(s), %d hour-bucket(s)\n",
    $elapsed, $stats['processed'], $stats['from_seq'], $stats['to_seq'], $dayCount, $hourCount
));

// Sample day: the most recent one, with its full shaped index entry.
$days = history_day_index($db);
if ($days) {
    $sample = $days[count($days) - 1];
    fwrite(STDERR, "sample day:\n");
    fwrite(STDERR, json_encode($sample, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
} else {
    fwrite(STDERR, "no days in index (empty events table)\n");
}
