<?php
declare(strict_types=1);

require __DIR__ . '/../lib/postcard_archive.php';

$row = [
    'id' => 42,
    'visitor_id' => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'from_name' => 'Jody',
    'body' => 'Are you all right?',
    'image_path' => 'uploads/2026/09/0123456789abcdef0123456789abcdef.webp',
    'image_attrib' => null,
    'posted_at' => '2026-09-10 18:42:31',
    'mail_class' => 'reply',
    'promoted_at' => null,
    'replied_at' => null,
    'blocked' => 0,
];

$checks = [
    'empty filter becomes all' => captive_postcard_archive_filter('') === 'all',
    'fan mail filter is accepted' => captive_postcard_archive_filter('fan_mail') === 'fan_mail',
    'default page is bounded' => captive_postcard_archive_limit(null) === 20,
    'large page is capped' => captive_postcard_archive_limit(999) === 40,
    'valid cursor is parsed' => captive_postcard_archive_cursor('27') === 27,
    'reply row is waiting' => captive_postcard_archive_status($row) === 'waiting',
    'reply timestamp is authoritative' => captive_postcard_archive_status(array_replace($row, ['replied_at' => '2026-09-10 18:44:00'])) === 'replied',
    'ordinary fan row is fan mail' => captive_postcard_archive_status(array_replace($row, ['mail_class' => 'fan'])) === 'fan_mail',
    'terminal fan row is fan mail' => captive_postcard_archive_status(array_replace($row, ['mail_class' => 'fan_final'])) === 'fan_mail',
    'blocked state wins over queue fields' => captive_postcard_archive_status(array_replace($row, ['blocked' => 1, 'replied_at' => '2026-09-10 18:44:00'])) === 'not_delivered',
    'signed visitor id marks ownership' => captive_postcard_archive_is_yours($row, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    'different visitor is not owner' => !captive_postcard_archive_is_yours($row, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    'stored postcard image path is accepted' => captive_postcard_archive_image($row['image_path']) === $row['image_path'],
    'arbitrary image path is not exposed' => captive_postcard_archive_image('../config/config.php') === null,
];

$item = captive_postcard_archive_item(
    array_replace($row, ['replied_at' => '2026-09-10 18:44:00', 'promoted_at' => '2026-09-10 18:43:00']),
    ['body' => 'Aye. Still here.', 'ts' => '2026-09-10 18:44:00'],
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
$checks['reply is directly associated'] = $item['reply']['body'] === 'Aye. Still here.';
$checks['promoted history is retained'] = $item['was_fan_mail'] === true;
$checks['private visitor id is omitted'] = !array_key_exists('visitor_id', $item);

$invalidFilter = false;
try {
    captive_postcard_archive_filter('blocked');
} catch (InvalidArgumentException) {
    $invalidFilter = true;
}
$checks['unsupported public filter is rejected'] = $invalidFilter;

$invalidCursor = false;
try {
    captive_postcard_archive_cursor('-1');
} catch (InvalidArgumentException) {
    $invalidCursor = true;
}
$checks['invalid cursor is rejected'] = $invalidCursor;

$migration = file_get_contents(__DIR__ . '/../sql/014_postcard_archive.sql');
$ingest = file_get_contents(__DIR__ . '/../public/api/ingest.php');
$checks['migration backfills screened public arrivals'] =
    is_string($migration)
    && str_contains($migration, "kind IN ('postcard_in', 'fan_mail_in')")
    && str_contains($migration, 'SET p.public_at = admitted.public_at');
$checks['ingest marks future screened arrivals transactionally'] =
    is_string($ingest)
    && str_contains($ingest, "\$kind === 'postcard_in' || \$kind === 'fan_mail_in'")
    && str_contains($ingest, 'SET public_at = COALESCE(public_at, :public_at)');

$failed = 0;
foreach ($checks as $label => $ok) {
    echo ($ok ? '  ok   ' : '  FAIL ') . $label . "\n";
    if (!$ok) {
        $failed++;
    }
}
echo $failed === 0 ? "ALL PASS\n" : $failed . " FAILED\n";
exit($failed === 0 ? 0 : 1);
