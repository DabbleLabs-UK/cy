<?php
declare(strict_types=1);

require __DIR__ . '/../lib/history.php';

$row = [
    'dominant_mood' => 'anxiety',
    'mood_score' => 0.95,
    'acc' => json_encode([
        'nv' => 2,
        'sum' => ['anxiety' => 1.9, 'stress' => 1.2, 'anger' => 0.4],
        'peak' => ['anxiety' => 1.0, 'stress' => 0.7, 'anger' => 0.3],
    ], JSON_THROW_ON_ERROR),
];

$mood = history_effective_public_mood($row);
if ($mood['dominant'] !== 'stress' || $mood['score'] !== 0.6) {
    fwrite(STDERR, "FAIL: legacy Anxiety still controls the public history tint\n");
    exit(1);
}

$legacyOnly = history_effective_public_mood([
    'dominant_mood' => 'anxiety',
    'mood_score' => 0.95,
    'acc' => null,
]);
if ($legacyOnly['dominant'] !== null || $legacyOnly['score'] !== null) {
    fwrite(STDERR, "FAIL: an old Anxiety-only rollup leaked into public history\n");
    exit(1);
}

if (array_key_exists('anxiety', HISTORY_MOOD_TINTS)) {
    fwrite(STDERR, "FAIL: the public history legend still advertises legacy Anxiety\n");
    exit(1);
}

echo "ALL PASS\n";
