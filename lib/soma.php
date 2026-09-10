<?php
declare(strict_types=1);

// Convert the newest persisted vitals row into the public Soma state response.
// The state is not recomputed in PHP: the runner's exact snapshot is returned,
// or an explicit unavailable result if no valid snapshot has reached the log.
function captive_soma_api_payload(?array $row): array
{
    if ($row === null) {
        return [
            'ok' => false,
            'status' => 'unavailable',
            'reason' => 'no vitals snapshot has been received',
            'seq' => null,
            'ts' => null,
            'soma' => null,
        ];
    }

    $payload = json_decode((string)($row['payload'] ?? ''), true);
    $soma = is_array($payload) && isset($payload['soma']) && is_array($payload['soma'])
        ? $payload['soma']
        : null;
    $implemented = $soma !== null
        && ($soma['status'] ?? null) === 'implemented'
        && isset($soma['circuits'])
        && is_array($soma['circuits']);

    if (!$implemented) {
        return [
            'ok' => false,
            'status' => 'unavailable',
            'reason' => is_array($soma) && isset($soma['reason'])
                ? (string)$soma['reason']
                : 'latest vitals snapshot contains no implemented Soma state',
            'seq' => isset($row['seq']) ? (int)$row['seq'] : null,
            'ts' => $row['ts'] ?? null,
            'soma' => $soma,
        ];
    }

    return [
        'ok' => true,
        'status' => 'implemented',
        'reason' => null,
        'seq' => isset($row['seq']) ? (int)$row['seq'] : null,
        'ts' => $row['ts'] ?? null,
        'soma' => $soma,
    ];
}
