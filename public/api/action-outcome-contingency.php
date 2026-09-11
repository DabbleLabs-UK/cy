<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';

header('Cache-Control: no-store');

function captive_contingency_posterior(array $value): array
{
    return [
        'alpha' => (int)($value['alpha'] ?? 1),
        'beta' => (int)($value['beta'] ?? 1),
        'mean' => (float)($value['mean'] ?? 0.5),
        'variance' => (float)($value['variance'] ?? (1 / 12)),
        'resolvedObservations' => (int)($value['resolvedObservations'] ?? 0),
    ];
}

try {
    $db = captive_db();
    if (!captive_is_admin($db)) {
        captive_error_response('not found', 404);
    }
    $stmt = $db->query('SELECT record FROM environment_events ORDER BY occurred_at ASC, event_id ASC');
    $model = null;
    $opportunities = [];
    $history = [];
    $pairs = [];
    while (($json = $stmt->fetchColumn()) !== false) {
        $record = json_decode((string)$json, true);
        $trace = is_array($record) ? ($record['action_outcome_contingency'] ?? null) : null;
        if (!is_array($trace)) {
            continue;
        }
        if ($model === null && isset($trace['modelId'])) {
            $model = [
                'modelId' => $trace['modelId'] ?? null,
                'modelVersion' => $trace['modelVersion'] ?? null,
                'provenance' => $trace['provenance'] ?? null,
                'prior' => ['alpha' => 1, 'beta' => 1],
            ];
        }
        $opportunity = $trace['opportunity'] ?? null;
        if (is_array($opportunity) && isset($opportunity['opportunityId'])) {
            $opportunities[(string)$opportunity['opportunityId']] = $opportunity;
        }
        foreach ($trace['updates'] ?? [] as $update) {
            if (!is_array($update)) {
                continue;
            }
            $history[] = $update;
            $key = implode('|', [
                (string)($update['contextId'] ?? ''),
                (string)($update['actionId'] ?? ''),
                (string)($update['outcomeClass'] ?? ''),
            ]);
            if ($key === '||') {
                continue;
            }
            if (!isset($pairs[$key])) {
                $pairs[$key] = [
                    'contextId' => $update['contextId'] ?? null,
                    'actionId' => $update['actionId'] ?? null,
                    'outcomeClass' => $update['outcomeClass'] ?? null,
                    'actionPosterior' => captive_contingency_posterior([]),
                    'noActionPosterior' => captive_contingency_posterior([]),
                ];
            }
            if (($update['condition'] ?? null) === 'action') {
                $pairs[$key]['actionPosterior'] = captive_contingency_posterior((array)($update['after'] ?? []));
            } elseif (($update['condition'] ?? null) === 'noAction') {
                $pairs[$key]['noActionPosterior'] = captive_contingency_posterior((array)($update['after'] ?? []));
            }
            $pairs[$key]['lastUpdatedAt'] = $update['timestamp'] ?? null;
        }
    }
    foreach ($pairs as &$pair) {
        $pair['contingencyDifference'] = $pair['noActionPosterior']['mean'] - $pair['actionPosterior']['mean'];
        $pair['contingencyVariance'] = $pair['noActionPosterior']['variance'] + $pair['actionPosterior']['variance'];
        $pair['causalInterpretation'] = 'NOT_ESTABLISHED';
        $pair['perceivedControl'] = 'NOT_MODELLED';
    }
    unset($pair);
    captive_json_response([
        'ok' => true,
        'inspection' => [
            'status' => 'IMPLEMENTED',
            'publicLabel' => 'LIVE',
            'model' => $model,
            'contingencies' => array_values($pairs),
            'opportunities' => array_values($opportunities),
            'history' => $history,
            'causalControlInference' => 'NOT_MODELLED',
            'perceivedControl' => 'NOT_MODELLED',
            'credibleInterval' => 'NOT_MODELLED',
            'note' => 'Exact post-installation structured opportunities and posterior updates reconstructed from stored runner traces. Missing actions and generated prose are not trials.',
        ],
    ]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
