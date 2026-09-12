<?php
declare(strict_types=1);

$source = file_get_contents(__DIR__ . '/../public/api/range.php');
if ($source === false) {
    fwrite(STDERR, "FAIL: unable to read range.php\n");
    exit(1);
}

$headQuery = strpos($source, "SELECT COALESCE(MAX(seq), 0) FROM events");
$pageQuery = strpos($source, 'SELECT seq, ts, kind, payload FROM events');

if ($headQuery === false || $pageQuery === false || $headQuery >= $pageQuery) {
    fwrite(STDERR, "FAIL: range head must be captured before page rows are selected\n");
    exit(1);
}

if (strpos($source, "\$conds[] = 'seq <= :head';") === false) {
    fwrite(STDERR, "FAIL: range pages must be bounded by the captured head\n");
    exit(1);
}

if (strpos($source, 'WHERE ts >= :ts AND seq <= :head') === false) {
    fwrite(STDERR, "FAIL: timestamp anchors must be bounded by the captured head\n");
    exit(1);
}

if (substr_count($source, 'SELECT COALESCE(MAX(seq), 0) FROM events') !== 1) {
    fwrite(STDERR, "FAIL: range head must be captured exactly once\n");
    exit(1);
}

if (strpos($source, 'const RANGE_MAX_LIMIT = 100;') === false) {
    fwrite(STDERR, "FAIL: range pages must be capped at the safe 100-row limit\n");
    exit(1);
}

echo "range_pagination_test.php: all checks passed\n";
