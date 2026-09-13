<?php
declare(strict_types=1);

function captive_location_api_payload(?array $row): array
{
    if ($row === null) {
        return [
            'ok' => false,
            'status' => 'unavailable',
            'reason' => 'no location snapshot has been received',
            'seq' => null,
            'ts' => null,
            'location_regime' => null,
        ];
    }
    $payload = json_decode((string)($row['payload'] ?? ''), true);
    $state = is_array($payload) && isset($payload['location_regime'])
        && is_array($payload['location_regime']) ? $payload['location_regime'] : null;
    $current = is_array($state) && isset($state['current']) && is_array($state['current'])
        ? $state['current'] : null;
    $valid = $current !== null
        && in_array($current['id'] ?? null, ['CELL', 'EXERCISE_YARD', 'WING_OR_LANDING'], true)
        && is_string($current['entered_at'] ?? null)
        && is_string($current['regime_activity'] ?? null);
    $publicState = null;
    if ($valid) {
        $publicState = [
            'schema' => is_string($state['schema'] ?? null) ? $state['schema'] : null,
            'version' => is_int($state['version'] ?? null) ? $state['version'] : null,
            'current' => [
                'id' => $current['id'],
                'entered_at' => $current['entered_at'],
                'reason' => is_string($current['reason'] ?? null) ? $current['reason'] : null,
                'regime_activity' => $current['regime_activity'],
                'transition_provenance' => is_string($current['transition_provenance'] ?? null)
                    ? $current['transition_provenance'] : null,
            ],
            'location_context_id' => is_string($state['location_context_id'] ?? null)
                ? $state['location_context_id'] : null,
            'next_transition' => is_array($state['next_transition'] ?? null)
                ? $state['next_transition'] : null,
            'configuration' => is_string($state['configuration'] ?? null)
                ? $state['configuration'] : null,
            'exercise' => is_array($state['exercise'] ?? null) ? $state['exercise'] : null,
            'cell_search' => is_array($state['cell_search'] ?? null) ? $state['cell_search'] : null,
        ];
    }
    return [
        'ok' => $valid,
        'status' => $valid ? 'live' : 'unavailable',
        'reason' => $valid ? null : 'latest vitals snapshot contains no valid location state',
        'seq' => isset($row['seq']) ? (int)$row['seq'] : null,
        'ts' => $row['ts'] ?? null,
        'location_regime' => $publicState,
    ];
}
