<?php
declare(strict_types=1);

// Return the freshest compact runner snapshot. New deployments keep the live
// value in a singleton row; the events fallback keeps rolling deployments and
// pre-migration installations readable.
function captive_latest_vitals_row(PDO $db): ?array
{
    try {
        $row = $db->query(
            'SELECT NULL AS seq, updated_at AS ts, payload
             FROM live_vitals_latest WHERE id = 1 LIMIT 1'
        )->fetch();
        if (is_array($row)) {
            return $row;
        }
    } catch (PDOException) {
        // Migration 019 may not yet exist during the first half of a rolling
        // deployment. Fall through to the append-only historical sample.
    }

    $row = $db->query(
        "SELECT seq, ts, payload FROM events WHERE kind = 'vitals' ORDER BY seq DESC LIMIT 1"
    )->fetch();
    return is_array($row) ? $row : null;
}

function captive_should_archive_vitals(
    ?int $lastArchiveAtMs,
    int $candidateAtMs,
    int $intervalMs = 60000
): bool {
    if ($intervalMs < 1) {
        throw new InvalidArgumentException('vitals history interval must be positive');
    }
    return $lastArchiveAtMs === null || $candidateAtMs - $lastArchiveAtMs >= $intervalMs;
}
