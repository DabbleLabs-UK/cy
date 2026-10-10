<?php
declare(strict_types=1);

// Unit regression for captive_memory_resolve_origin_kind: the rule that gives a
// memory a CURRENT origin kind which historical contamination can never widen,
// and which an OWNER_CORRECTION can never erase. Pure function, no DB needed.
require __DIR__ . '/../lib/autobiographical_memory.php';

$resolve = 'captive_memory_resolve_origin_kind';
$src = static fn(string $t): array => ['source' => ['sourceType' => $t, 'sourceId' => $t . ':1']];

$checks = [];

// CREATE records the creating evidence kind verbatim.
$checks['CREATE from ENVIRONMENT_EVENT -> ENVIRONMENT_EVENT'] =
    $resolve('CREATE', $src('ENVIRONMENT_EVENT'), null) === 'ENVIRONMENT_EVENT';
$checks['CREATE from CY_EXPRESSION -> CY_EXPRESSION'] =
    $resolve('CREATE', $src('CY_EXPRESSION'), null) === 'CY_EXPRESSION';
$checks['CREATE from DREAM_EXPRESSION -> DREAM_EXPRESSION'] =
    $resolve('CREATE', $src('DREAM_EXPRESSION'), null) === 'DREAM_EXPRESSION';

// A genuine evidence UPDATE sets the current origin kind.
$checks['UPDATE evidence source sets current origin'] =
    $resolve('UPDATE', $src('CY_EXPRESSION'), ['origin_kind' => 'CY_EXPRESSION']) === 'CY_EXPRESSION';

// THE INVARIANT: an OWNER_CORRECTION must NOT become the origin kind - it must
// preserve what kind of evidence the content represents (e4a153ca: a dream-
// clobbered waking memory restored by an owner correction stays CY_EXPRESSION).
$checks['OWNER_CORRECTION preserves existing origin kind (e4a153ca restore)'] =
    $resolve('UPDATE', $src('OWNER_CORRECTION'), ['origin_kind' => 'CY_EXPRESSION']) === 'CY_EXPRESSION';
$checks['OWNER_CORRECTION never becomes the origin kind'] =
    $resolve('UPDATE', $src('OWNER_CORRECTION'), ['origin_kind' => 'ENVIRONMENT_EVENT']) === 'ENVIRONMENT_EVENT';

// An explicit originKind declaration wins (an owner correction restoring content
// of a stated evidence kind, even if current is missing/different).
$checks['explicit originKind overrides on correction'] =
    $resolve('UPDATE', ['originKind' => 'CY_EXPRESSION'] + $src('OWNER_CORRECTION'), ['origin_kind' => null]) === 'CY_EXPRESSION';
$checks['explicit originKind overrides even an evidence source'] =
    $resolve('UPDATE', ['originKind' => 'ENVIRONMENT_EVENT'] + $src('DREAM_EXPRESSION'), ['origin_kind' => 'ENVIRONMENT_EVENT']) === 'ENVIRONMENT_EVENT';

// A correction on a row with no recorded origin kind yet leaves it null (nothing
// to preserve, nothing fabricated) rather than becoming OWNER_CORRECTION.
$checks['OWNER_CORRECTION with no prior origin stays null (not OWNER_CORRECTION)'] =
    $resolve('UPDATE', $src('OWNER_CORRECTION'), ['origin_kind' => null]) === null;

// Validation rejects an explicit origin kind that is a non-evidence marker.
$rejected = false;
try {
    captive_memory_validate_operation([
        'decision' => 'UPDATE', 'memoryId' => '00000000-0000-4000-8000-00000000abcd',
        'originKind' => 'OWNER_CORRECTION',
        'source' => ['sourceType' => 'OWNER_CORRECTION', 'sourceId' => 'x'],
    ]);
} catch (InvalidArgumentException $e) {
    $rejected = $e->getMessage() === 'invalid origin kind';
}
$checks['validate rejects originKind=OWNER_CORRECTION'] = $rejected;

// Validation accepts a normal evidence originKind.
$accepted = true;
try {
    captive_memory_validate_operation([
        'decision' => 'UPDATE', 'memoryId' => '00000000-0000-4000-8000-00000000abcd',
        'originKind' => 'CY_EXPRESSION',
        'source' => ['sourceType' => 'OWNER_CORRECTION', 'sourceId' => 'x'],
    ]);
} catch (InvalidArgumentException $e) {
    $accepted = false;
}
$checks['validate accepts originKind=CY_EXPRESSION'] = $accepted;

$failed = 0;
foreach ($checks as $label => $ok) {
    echo ($ok ? '  ok   ' : '  FAIL ') . $label . "\n";
    if (!$ok) {
        $failed++;
    }
}
echo $failed === 0 ? "ALL PASS\n" : $failed . " FAILED\n";
exit($failed === 0 ? 0 : 1);
