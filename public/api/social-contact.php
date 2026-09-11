<?php
declare(strict_types=1);

// Public factual social history plus owner-only exact provenance. This endpoint
// does not calculate Loneliness, affiliation, a social set-point or brain state.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';

header('Cache-Control: no-store');

function captive_social_public_episode(array $episode): array
{
    unset($episode['linkedEnvironmentEventIds']);
    if (isset($episode['participants']) && is_array($episode['participants'])) {
        unset($episode['participants']['actorId'], $episode['participants']['targetId'], $episode['participants']['relationshipRef']);
    }
    return $episode;
}

try {
    $db = captive_db();
    $isAdmin = captive_is_admin($db);
    $range = strtolower(trim((string)($_GET['range'] ?? '24h')));
    $intervals = ['1h' => '1 HOUR', '24h' => '24 HOUR', '7d' => '7 DAY'];
    if (!isset($intervals[$range]) && !($range === 'all' && $isAdmin)) {
        captive_error_response('invalid social history range', 422);
    }
    $traces = [];
    $episodes = [];
    $sql = $range === 'all'
        ? 'SELECT record FROM environment_events ORDER BY occurred_at ASC, event_id ASC'
        : "SELECT record FROM environment_events WHERE occurred_at >= DATE_SUB(NOW(), INTERVAL {$intervals[$range]}) ORDER BY occurred_at ASC, event_id ASC";
    $stmt = $db->query($sql);
    while (($json = $stmt->fetchColumn()) !== false) {
        $environmentRecord = json_decode((string)$json, true);
        $trace = is_array($environmentRecord) ? ($environmentRecord['social_contact'] ?? null) : null;
        $episode = is_array($trace) ? ($trace['episode'] ?? null) : null;
        if (!is_array($episode) || ($episode['schema'] ?? null) !== 'cy.social-episode') {
            continue;
        }
        $episodes[(string)$episode['episodeId']] = $episode;
        if ($isAdmin) {
            $traces[] = [
                'sourceEnvironmentEventId' => $environmentRecord['world_event']['id'] ?? null,
                'trace' => $trace,
                'socialHomeostaticInterpretation' => 'NOT_MODELLED',
                'subjectiveLoneliness' => 'NOT_MODELLED',
            ];
        }
    }

    $current = null;
    $vitals = $db->query("SELECT payload FROM events WHERE kind = 'vitals' ORDER BY seq DESC LIMIT 1")->fetchColumn();
    if ($vitals !== false) {
        $payload = json_decode((string)$vitals, true);
        $candidate = is_array($payload) ? ($payload['soma']['social'] ?? null) : null;
        if (is_array($candidate)) {
            $current = $candidate;
        }
    }

    $publicEpisodes = array_values(array_map('captive_social_public_episode', array_values($episodes)));
    $response = [
        'ok' => true,
        'range' => $range,
        'current' => $current,
        'episodes' => $publicEpisodes,
        'socialSetPoint' => 'NOT_MODELLED',
        'socialHomeostaticError' => 'NOT_MODELLED',
        'subjectiveLoneliness' => 'NOT_MODELLED',
        'legacyDisplayedLoneliness' => 'PROVISIONAL',
    ];
    if ($isAdmin) {
        $response['inspection'] = [
            'heading' => 'SOCIAL CONTACT / OPPORTUNITY LEDGER',
            'status' => 'IMPLEMENTED',
            'publicLabel' => 'LIVE',
            'current' => $current,
            'episodes' => array_values($episodes),
            'eventTraces' => $traces,
        ];
    }
    captive_json_response($response);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
