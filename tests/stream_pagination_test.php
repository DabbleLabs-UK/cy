<?php
declare(strict_types=1);

$source = file_get_contents(__DIR__ . '/../public/api/stream.php');
if ($source === false) {
    fwrite(STDERR, "FAIL: unable to read stream.php\n");
    exit(1);
}

$headQuery = strpos($source, "SELECT COALESCE(MAX(seq), 0) FROM events");
$pageQuery = strpos($source, 'SELECT seq, ts, kind, payload FROM events');

if ($headQuery === false || $pageQuery === false || $headQuery >= $pageQuery) {
    fwrite(STDERR, "FAIL: stream head must be captured before page rows are selected\n");
    exit(1);
}

if (strpos($source, 'const STREAM_MAX_LIMIT = 100;') === false) {
    fwrite(STDERR, "FAIL: stream pages must retain the memory-safe cap\n");
    exit(1);
}

if (substr_count($source, 'seq <= :head') !== 2) {
    fwrite(STDERR, "FAIL: forward and tail stream pages must both use the captured head\n");
    exit(1);
}

if (substr_count($source, 'SELECT COALESCE(MAX(seq), 0) FROM events') !== 1) {
    fwrite(STDERR, "FAIL: stream head must be captured exactly once\n");
    exit(1);
}

echo "stream_pagination_test.php: all checks passed\n";
