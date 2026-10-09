<?php
declare(strict_types=1);

// DB-backed regression for tag persistence and the empty-tag wipe guard in
// captive_memory_replace_tags. Uses an in-memory SQLite PDO: the function only
// issues DELETE/INSERT against autobiographical_memory_tags, which is portable.
require __DIR__ . '/../lib/autobiographical_memory.php';

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec('CREATE TABLE autobiographical_memory_tags (
    memory_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (memory_id, tag))');

$id = '00000000-0000-4000-8000-00000000aaaa';
$tagsOf = static function (PDO $db, string $id): array {
    $stmt = $db->prepare('SELECT tag FROM autobiographical_memory_tags WHERE memory_id = ? ORDER BY tag');
    $stmt->execute([$id]);
    return array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'tag');
};

$checks = [];

// Initial population (CREATE / first tagging) persists tags.
captive_memory_replace_tags($db, $id, ['cell', 'confinement', 'machine']);
$checks['initial tags persist'] = $tagsOf($db, $id) === ['cell', 'confinement', 'machine'];

// A non-empty replacement is wholesale: old removed, new inserted (ordinary
// retag/refresh semantics are unchanged).
captive_memory_replace_tags($db, $id, ['routine', 'yard']);
$checks['non-empty replacement is wholesale'] = $tagsOf($db, $id) === ['routine', 'yard'];

// The regression: an UPDATE supplying an empty tag set must NOT wipe existing
// tags. Empty == "no change".
captive_memory_replace_tags($db, $id, []);
$checks['empty tag set preserves existing tags'] = $tagsOf($db, $id) === ['routine', 'yard'];

// Whitespace-only / blank entries normalise to empty and are likewise treated
// as "no change" rather than a wipe.
captive_memory_replace_tags($db, $id, ['', '   ']);
$checks['blank-only tag set preserves existing tags'] = $tagsOf($db, $id) === ['routine', 'yard'];

// A later non-empty set still replaces, so tags remain editable after a no-op.
captive_memory_replace_tags($db, $id, ['lighthouse']);
$checks['non-empty replacement still applies after an empty no-op'] = $tagsOf($db, $id) === ['lighthouse'];

// A fresh memory given an empty set simply has no tags (CREATE no-op is
// harmless: there is nothing to preserve or to wipe).
$fresh = '00000000-0000-4000-8000-00000000bbbb';
captive_memory_replace_tags($db, $fresh, []);
$checks['empty set on a fresh memory yields no tags'] = $tagsOf($db, $fresh) === [];

$failed = 0;
foreach ($checks as $label => $ok) {
    echo ($ok ? '  ok   ' : '  FAIL ') . $label . "\n";
    if (!$ok) {
        $failed++;
    }
}
echo $failed === 0 ? "ALL PASS\n" : $failed . " FAILED\n";
exit($failed === 0 ? 0 : 1);
