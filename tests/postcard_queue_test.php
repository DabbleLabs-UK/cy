<?php
declare(strict_types=1);

require __DIR__ . '/../lib/postcard_queue.php';

$checks = [
    'empty tray accepts a reply item' => captive_postcard_disposition(0, 8) === 'reply_queue',
    'last free tray place accepts a reply item' => captive_postcard_disposition(7, 8) === 'reply_queue',
    'full tray sends overflow to fan mail' => captive_postcard_disposition(8, 8) === 'fan_mail',
    'overfull tray remains fan mail' => captive_postcard_disposition(20, 8) === 'fan_mail',
    'invalid capacity still leaves one reply place' => captive_postcard_disposition(0, 0) === 'reply_queue',
];

$failed = 0;
foreach ($checks as $label => $ok) {
    echo ($ok ? '  ok   ' : '  FAIL ') . $label . "\n";
    if (!$ok) {
        $failed++;
    }
}
echo $failed === 0 ? "ALL PASS\n" : $failed . " FAILED\n";
exit($failed === 0 ? 0 : 1);
