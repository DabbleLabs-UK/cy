<?php
declare(strict_types=1);

require __DIR__ . '/../lib/location.php';

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$missing = captive_location_api_payload(null);
check($missing['ok'] === false, 'missing row must be unavailable');

$row = [
    'seq' => 42,
    'ts' => '2026-09-13 14:20:00.000',
    'payload' => json_encode([
        'location_regime' => [
            'current' => [
                'id' => 'EXERCISE_YARD',
                'entered_at' => '2026-09-13T13:15:00.000Z',
                'regime_activity' => 'DAILY_EXERCISE',
                'source_event_id' => 'private-event-id',
            ],
            'searchEpisode' => ['object_id' => 'private-object-id'],
            'next_transition' => ['activity' => 'CELL_TIME', 'atMinutes' => 915],
        ],
    ], JSON_THROW_ON_ERROR),
];
$live = captive_location_api_payload($row);
check($live['ok'] === true, 'valid location must be live');
check($live['location_regime']['current']['id'] === 'EXERCISE_YARD', 'exact location must be returned');
check(!isset($live['location_regime']['current']['source_event_id']), 'source event id must remain private');
check(!isset($live['location_regime']['searchEpisode']), 'internal search object must remain private');

$bad = $row;
$bad['payload'] = json_encode(['location_regime' => ['current' => ['id' => 'MOON']]], JSON_THROW_ON_ERROR);
check(captive_location_api_payload($bad)['ok'] === false, 'unknown location must be unavailable');

echo "location api tests passed\n";
