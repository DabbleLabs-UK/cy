<?php
declare(strict_types=1);

require_once __DIR__ . '/implementation_registry.php';

// Convert the newest persisted vitals row into the public Soma state response.
// The state is not recomputed in PHP: the runner's exact snapshot is returned,
// or an explicit unavailable result if no valid snapshot has reached the log.
function captive_soma_api_payload(?array $row, ?array $implementationRegistry = null): array
{
    $registry = $implementationRegistry ?? captive_implementation_registry();
    if ($row === null) {
        return [
            'ok' => false,
            'status' => 'unavailable',
            'reason' => 'no vitals snapshot has been received',
            'seq' => null,
            'ts' => null,
            'soma' => null,
            'implementation_registry' => $registry,
        ];
    }

    $payload = json_decode((string)($row['payload'] ?? ''), true);
    $soma = is_array($payload) && isset($payload['soma']) && is_array($payload['soma'])
        ? $payload['soma']
        : null;
    $available = $soma !== null
        && isset($soma['circuits'])
        && is_array($soma['circuits'])
        && isset($soma['experienced']['metrics'])
        && is_array($soma['experienced']['metrics']);

    if (!$available) {
        return [
            'ok' => false,
            'status' => 'unavailable',
            'reason' => is_array($soma) && isset($soma['reason'])
                ? (string)$soma['reason']
                : 'latest vitals snapshot contains no structurally valid Soma state',
            'seq' => isset($row['seq']) ? (int)$row['seq'] : null,
            'ts' => $row['ts'] ?? null,
            'soma' => $soma,
            'implementation_registry' => $registry,
        ];
    }

    // The runner historically called this snapshot "implemented". That is not
    // authoritative: public implementation status comes only from the registry.
    $publicStatus = captive_implementation_overall_status($registry);
    $soma['status'] = $publicStatus;
    unset($soma['physiologicalSatietyInspection']);

    return [
        'ok' => true,
        'status' => $publicStatus,
        'reason' => null,
        'seq' => isset($row['seq']) ? (int)$row['seq'] : null,
        'ts' => $row['ts'] ?? null,
        'soma' => $soma,
        'implementation_registry' => $registry,
    ];
}
