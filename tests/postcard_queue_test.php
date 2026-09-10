<?php
declare(strict_types=1);

require __DIR__ . '/../lib/postcard_queue.php';

$checks = [
    'empty tray accepts a reply item' => captive_postcard_disposition(0, 8) === 'reply_queue',
    'last free tray place accepts a reply item' => captive_postcard_disposition(7, 8) === 'reply_queue',
    'full tray sends overflow to fan mail' => captive_postcard_disposition(8, 8) === 'fan_mail',
    'overfull tray remains fan mail' => captive_postcard_disposition(20, 8) === 'fan_mail',
    'invalid capacity still leaves one reply place' => captive_postcard_disposition(0, 0) === 'reply_queue',
    'legacy runner does not collect fan mail' => captive_postcard_fan_mail_supported([]) === false,
    'disabled capability does not collect fan mail' => captive_postcard_fan_mail_supported(['fan_mail' => '0']) === false,
    'updated runner opts in to fan-mail collection' => captive_postcard_fan_mail_supported(['fan_mail' => '1']) === true,
    'abandoned runner claims expire after thirty minutes' => CY_REPLY_CLAIM_TTL_SECONDS === 30 * 60,
    'runner can claim when no reply is in flight' => captive_postcard_can_claim_next(0) === true,
    'runner cannot claim a second simultaneous reply' => captive_postcard_can_claim_next(1) === false,
    'runner remains blocked if several claims somehow exist' => captive_postcard_can_claim_next(3) === false,
    'database provenance marks promoted mail authoritatively' => captive_postcard_event_provenance(
        ['id' => 13, 'promoted' => false],
        ['posted_at' => '2026-09-09 23:53:52', 'promoted' => 1]
    ) === ['id' => 13, 'promoted' => true, 'posted_at' => '2026-09-09T23:53:52Z'],
    'missing provenance leaves an event unchanged' => captive_postcard_event_provenance(
        ['id' => 99],
        null
    ) === ['id' => 99],
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
