<?php
declare(strict_types=1);

require dirname(__DIR__) . '/lib/live_vitals.php';

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

expect(captive_should_archive_vitals(null, 1000), 'the first compact sample must be retained');
expect(!captive_should_archive_vitals(1000, 60999), 'a sample inside the minute must not append');
expect(captive_should_archive_vitals(1000, 61000), 'the minute boundary must append');
expect(!captive_should_archive_vitals(61000, 1000), 'an older out-of-order sample must not append');

$threw = false;
try {
    captive_should_archive_vitals(null, 1000, 0);
} catch (InvalidArgumentException) {
    $threw = true;
}
expect($threw, 'an invalid cadence must fail closed');

echo "live_vitals_test.php: all checks passed\n";
