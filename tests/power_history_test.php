<?php
declare(strict_types=1);

require __DIR__ . '/../lib/power-history.php';

$tz = new DateTimeZone('Europe/London');
$now = new DateTimeImmutable('2026-09-14 00:07:00.000', $tz);
$cutoff = captive_power_history_cutoff($now);

if ($cutoff !== '2026-09-13 23:37:00.000000') {
    throw new RuntimeException('rolling power cutoff must cross midnight: ' . $cutoff);
}
if (CAPTIVE_POWER_HISTORY_MINUTES !== 30) {
    throw new RuntimeException('public power history must remain a 30-minute window');
}
if (CAPTIVE_POWER_HISTORY_MAX_ROWS < 600) {
    throw new RuntimeException('row cap must hold at least 30 minutes of three-second samples');
}

$endpoint = file_get_contents(__DIR__ . '/../public/api/power-history.php');
if ($endpoint === false || !str_contains($endpoint, "kind = 'power' AND ts >= :cutoff")) {
    throw new RuntimeException('endpoint must query power by rolling timestamp cutoff');
}
if (str_contains($endpoint, 'CURRENT_DATE') || str_contains($endpoint, '00:00:00')) {
    throw new RuntimeException('endpoint must not clip history to a calendar day');
}

echo "power_history_test.php: all checks passed\n";

