<?php
declare(strict_types=1);

// DB-backed regression for bounded retention of generic formation candidates
// (captive_memory_expire_stale_generic_sources). Uses an in-memory SQLite PDO;
// the function's statement is written portably (derived-table batch, bound
// now/cutoff) so it exercises the real code path.
require __DIR__ . '/../lib/autobiographical_memory.php';

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec('CREATE TABLE autobiographical_memory_formation_queue (
    id INTEGER PRIMARY KEY,
    source_type TEXT NOT NULL,
    subject_visitor_id TEXT,
    status TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    claim_token TEXT,
    last_result_category TEXT,
    last_error TEXT,
    updated_at TEXT
)');

$now = '2026-11-01 00:00:00.000';
$cutoff = '2026-10-02 00:00:00.000'; // now - 30 days
$old = '2026-09-10 00:00:00.000';    // older than cutoff
$recent = '2026-10-20 00:00:00.000'; // newer than cutoff

$insert = $db->prepare('INSERT INTO autobiographical_memory_formation_queue
    (id, source_type, subject_visitor_id, status, queued_at, claim_token) VALUES (?,?,?,?,?,?)');
// id, source_type, visitor, status, queued_at, claim_token
$rows = [
    [1, 'ENVIRONMENT_EVENT', null, 'PENDING',    $old,    'tok1'], // expire
    [2, 'DREAM_EXPRESSION',  null, 'RETRYABLE',   $old,    null],   // expire
    [3, 'CY_EXPRESSION',     null, 'PENDING',     $old,    null],   // expire
    [4, 'ENVIRONMENT_EVENT', null, 'PENDING',     $recent, null],   // keep (recent)
    [5, 'ENVIRONMENT_EVENT', null, 'PROCESSED',   $old,    null],   // keep (terminal)
    [6, 'ENVIRONMENT_EVENT', null, 'PROCESSING',  $old,    'tokP'], // keep (in flight)
    [7, 'POSTCARD',          'ffffffffffffffffffffffffffffffff', 'PENDING', $old, null], // keep (sender)
    [8, 'CY_REPLY',          'ffffffffffffffffffffffffffffffff', 'RETRYABLE', $old, null], // keep (sender)
    [9, 'ENVIRONMENT_EVENT', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'PENDING', $old, null], // keep (scoped generic)
];
foreach ($rows as $r) { $insert->execute($r); }

$statusOf = static function (PDO $db, int $id): array {
    $s = $db->prepare('SELECT status, claim_token, last_result_category FROM autobiographical_memory_formation_queue WHERE id = ?');
    $s->execute([$id]);
    return $s->fetch(PDO::FETCH_ASSOC);
};

$checks = [];

// Batch cap: only 2 of the 3 eligible rows expire on the first bounded sweep.
$n1 = captive_memory_expire_stale_generic_sources($db, $now, $cutoff, 2);
$checks['batch cap limits a single sweep'] = $n1 === 2;
$expiredNow = (int)$db->query("SELECT COUNT(*) FROM autobiographical_memory_formation_queue WHERE status='EXPIRED'")->fetchColumn();
$checks['exactly the batch size is expired so far'] = $expiredNow === 2;

// A second sweep catches the remaining eligible row; then no more remain.
$n2 = captive_memory_expire_stale_generic_sources($db, $now, $cutoff, 100);
$checks['second sweep expires the last eligible row'] = $n2 === 1;
$n3 = captive_memory_expire_stale_generic_sources($db, $now, $cutoff, 100);
$checks['idempotent once drained (nothing left to expire)'] = $n3 === 0;

// All three old null-scoped generic PENDING/RETRYABLE rows are now EXPIRED,
// terminal-labelled, and have their claim token cleared.
$allExpired = true;
foreach ([1, 2, 3] as $id) {
    $row = $statusOf($db, $id);
    if ($row['status'] !== 'EXPIRED' || $row['last_result_category'] !== 'EXPIRED_UNREACHED' || $row['claim_token'] !== null) {
        $allExpired = false;
    }
}
$checks['old generic candidates become terminal EXPIRED with cleared token'] = $allExpired;

// Everything that must be preserved is untouched.
$checks['recent generic candidate is preserved'] = $statusOf($db, 4)['status'] === 'PENDING';
$checks['terminal PROCESSED is untouched'] = $statusOf($db, 5)['status'] === 'PROCESSED';
$checks['in-flight PROCESSING is untouched'] = $statusOf($db, 6)['status'] === 'PROCESSING';
$checks['sender POSTCARD is never expired'] = $statusOf($db, 7)['status'] === 'PENDING';
$checks['sender CY_REPLY is never expired'] = $statusOf($db, 8)['status'] === 'RETRYABLE';
$checks['sender-scoped generic row is never expired'] = $statusOf($db, 9)['status'] === 'PENDING';

$failed = 0;
foreach ($checks as $label => $ok) {
    echo ($ok ? '  ok   ' : '  FAIL ') . $label . "\n";
    if (!$ok) { $failed++; }
}
echo $failed === 0 ? "ALL PASS\n" : $failed . " FAILED\n";
exit($failed === 0 ? 0 : 1);
