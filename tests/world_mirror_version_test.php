<?php
declare(strict_types=1);

require __DIR__ . '/../lib/world_simulation.php';

$id1 = '00000000-0000-4000-8000-000000000001';
$id2 = '00000000-0000-4000-8000-000000000002';
$first = ['revision' => 1, 'transition_id' => $id1];
$second = ['revision' => 2, 'transition_id' => $id2];
$legacy = ['revision' => null, 'transition_id' => null];

function expect_world_mirror(bool $ok, string $message): void
{
    if (!$ok) throw new RuntimeException($message);
}

expect_world_mirror(captive_world_mirror_order(null, $first) === 'APPLY', 'new row');
expect_world_mirror(captive_world_mirror_order($first, $second) === 'APPLY', 'higher revision');
expect_world_mirror(captive_world_mirror_order($second, $first) === 'STALE', 'lower revision');
expect_world_mirror(captive_world_mirror_order($first, $first) === 'SAME', 'same transition');
expect_world_mirror(captive_world_mirror_order($legacy, $first) === 'APPLY', 'versioned baseline');
expect_world_mirror(captive_world_mirror_order($first, $legacy) === 'STALE', 'legacy replay');
expect_world_mirror(captive_world_mirror_order($legacy, $legacy) === 'APPLY', 'legacy compatibility');

$conflict = false;
try {
    captive_world_mirror_order($first, ['revision' => 1, 'transition_id' => $id2]);
} catch (WorldMirrorConflictException) {
    $conflict = true;
}
expect_world_mirror($conflict, 'equal revision conflict');

$invalid = false;
try {
    captive_world_mirror_version(['revision' => 0, 'transitionId' => $id1]);
} catch (InvalidArgumentException) {
    $invalid = true;
}
expect_world_mirror($invalid, 'invalid revision rejected');

echo "ALL PASS\n";
