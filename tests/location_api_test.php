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
            'schema' => 'cy.location-regime',
            'version' => 1,
            'current' => [
                'id' => 'EXERCISE_YARD',
                'entered_at' => '2026-09-13T13:15:00.000Z',
                'reason' => 'scheduled movement',
                'regime_activity' => 'DAILY_EXERCISE',
                'transition_provenance' => 'routine',
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

foreach (['CELL', 'EXERCISE_YARD', 'WING_OR_LANDING', 'SHOWER', 'ASSOCIATION', 'PHONE'] as $locationId) {
    $fixture = $row;
    $payload = json_decode($fixture['payload'], true, 512, JSON_THROW_ON_ERROR);
    $payload['location_regime']['current']['id'] = $locationId;
    $fixture['payload'] = json_encode($payload, JSON_THROW_ON_ERROR);
    $result = captive_location_api_payload($fixture);
    check($result['ok'] === true && $result['status'] === 'live' && $result['reason'] === null,
        $locationId . ' must be a supported live location');
    check($result['seq'] === 42 && $result['ts'] === $row['ts'],
        $locationId . ' must retain the response envelope');
    check($result['location_regime']['schema'] === 'cy.location-regime'
        && $result['location_regime']['version'] === 1,
        $locationId . ' must retain public schema fields');
    check($result['location_regime']['current'] === [
        'id' => $locationId,
        'entered_at' => '2026-09-13T13:15:00.000Z',
        'reason' => 'scheduled movement',
        'regime_activity' => 'DAILY_EXERCISE',
        'transition_provenance' => 'routine',
    ], $locationId . ' must retain only public current-location fields');
    check(!isset($result['location_regime']['searchEpisode']),
        $locationId . ' must strip private internal fields');
}

$bad = $row;
$bad['payload'] = json_encode(['location_regime' => ['current' => ['id' => 'MOON']]], JSON_THROW_ON_ERROR);
check(captive_location_api_payload($bad)['ok'] === false, 'unknown location must be unavailable');

echo "location api tests passed\n";
