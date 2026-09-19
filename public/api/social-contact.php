<?php
declare(strict_types=1);

// Public factual social history plus owner-only exact provenance. This endpoint
// does not calculate Loneliness, affiliation, a social set-point or brain state.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';
require __DIR__ . '/../../lib/live_vitals.php';

header('Cache-Control: no-store');

function captive_social_public_episode(array $episode): array
{
    unset($episode['episodeId'], $episode['linkedEnvironmentEventIds']);
    if (isset($episode['opportunity']) && is_array($episode['opportunity'])) {
        unset($episode['opportunity']['opportunityId']);
    }
    if (isset($episode['participants']) && is_array($episode['participants'])) {
        unset($episode['participants']['actorId'], $episode['participants']['targetId'], $episode['participants']['relationshipRef']);
        if (($episode['channel'] ?? null) === 'POSTCARD') {
            unset($episode['participants']['actorLabel'], $episode['participants']['targetLabel']);
        }
    }
    return $episode;
}

function captive_social_public_snapshot(?array $snapshot): ?array
{
    if ($snapshot === null) {
        return null;
    }
    foreach (['latestEpisode', 'recentRejection', 'confirmedIsolation'] as $key) {
        if (isset($snapshot[$key]) && is_array($snapshot[$key])) {
            $snapshot[$key] = captive_social_public_episode($snapshot[$key]);
        }
    }
    foreach (['unresolvedOpportunities', 'recentEpisodes'] as $key) {
        if (isset($snapshot[$key]) && is_array($snapshot[$key])) {
            $snapshot[$key] = array_map('captive_social_public_episode', $snapshot[$key]);
        }
    }
    if (isset($snapshot['observationGaps']) && is_array($snapshot['observationGaps'])) {
        foreach ($snapshot['observationGaps'] as &$gap) {
            if (is_array($gap)) {
                unset($gap['episodeId']);
            }
        }
        unset($gap);
    }
    if (isset($snapshot['currentContext']) && is_array($snapshot['currentContext'])) {
        unset($snapshot['currentContext']['currentlyWith']);
    }
    return $snapshot;
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
    $toMs = (int)round(microtime(true) * 1000);
    $windowMs = ['1h' => 3600000, '24h' => 86400000, '7d' => 604800000];
    $fromMs = isset($windowMs[$range]) ? $toMs - $windowMs[$range] : null;
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
    $vitalsRow = captive_latest_vitals_row($db);
    if ($vitalsRow !== null) {
        $payload = json_decode((string)$vitalsRow['payload'], true);
        $candidate = is_array($payload) ? ($payload['soma']['social'] ?? null) : null;
        if (is_array($candidate)) {
            $current = captive_social_public_snapshot($candidate);
        }
    }

    $publicEpisodes = array_values(array_map('captive_social_public_episode', array_values($episodes)));
    $response = [
        'ok' => true,
        'range' => $range,
        'fromMs' => $fromMs,
        'toMs' => $toMs,
        'current' => $current,
        'episodes' => $publicEpisodes,
        'socialSetPoint' => 'NOT_MODELLED',
        'socialHomeostaticError' => 'NOT_MODELLED',
        'subjectiveLoneliness' => 'NOT_MODELLED',
        'legacyDisplayedLoneliness' => 'DIAGNOSTICS_ONLY',
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
