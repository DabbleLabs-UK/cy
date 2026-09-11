<?php
declare(strict_types=1);

// Owner-only exact inspection of the grounded feeding input ledger. This
// reconstructs canonical ingestion records from private structured world-event
// traces and combines them with the latest feeding and physiological-satiety
// snapshots. Subjective hunger remains unmodelled.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';

header('Cache-Control: no-store');

try {
    $db = captive_db();
    if (!captive_is_admin($db)) {
        captive_error_response('not found', 404);
    }

    $records = [];
    $stmt = $db->query('SELECT record FROM environment_events ORDER BY occurred_at ASC, event_id ASC');
    while (($json = $stmt->fetchColumn()) !== false) {
        $environmentRecord = json_decode((string)$json, true);
        $trace = is_array($environmentRecord) ? ($environmentRecord['feeding'] ?? null) : null;
        $record = is_array($trace) ? ($trace['record'] ?? null) : null;
        if (is_array($record) && ($record['schema'] ?? null) === 'cy.ingestion-record') {
            $records[] = $record;
        }
    }

    $latest = null;
    $satiety = null;
    $vitals = $db->query("SELECT payload FROM events WHERE kind = 'vitals' ORDER BY seq DESC LIMIT 1")->fetchColumn();
    if ($vitals !== false) {
        $payload = json_decode((string)$vitals, true);
        $candidate = is_array($payload) ? ($payload['soma']['feeding'] ?? null) : null;
        if (is_array($candidate)) {
            $latest = $candidate;
        }
        $satietyCandidate = is_array($payload) ? ($payload['soma']['physiologicalSatiety'] ?? null) : null;
        if (is_array($satietyCandidate)) {
            $satiety = $satietyCandidate;
        }
    }

    $latestScheduled = $latest['latestScheduledMeal'] ?? null;
    $latestResolved = $latest['latestResolvedMeal'] ?? null;
    captive_json_response([
        'ok' => true,
        'inspection' => [
            'heading' => 'PHYSIOLOGICAL SATIETY',
            'status' => 'IMPLEMENTED',
            'publicLabel' => 'LIVE',
            'model' => [
                'modelId' => $latest['modelId'] ?? 'feeding-homeostasis-uninstantiated-framework',
                'modelVersion' => $latest['modelVersion'] ?? 'feeding-intake-ledger-v1',
                'provenance' => $latest['provenance'] ?? 'config/model-specs/feeding-homeostasis.json',
            ],
            'latestScheduledMeal' => $latestScheduled,
            'foodOffered' => is_array($latestResolved) ? ($latestResolved['offeredStatus'] ?? 'UNKNOWN') : 'UNKNOWN',
            'foodAvailable' => is_array($latestResolved) ? ($latestResolved['availabilityStatus'] ?? 'UNKNOWN') : 'UNKNOWN',
            'foodReceived' => is_array($latestResolved) ? ($latestResolved['receivedStatus'] ?? 'UNKNOWN') : 'UNKNOWN',
            'consumption' => is_array($latestResolved) ? ($latestResolved['consumptionStatus'] ?? 'UNKNOWN') : 'UNKNOWN',
            'portion' => is_array($latestResolved) ? [
                'category' => $latestResolved['portionCategory'] ?? 'UNKNOWN',
                'fraction' => $latestResolved['portionFraction'] ?? null,
                'basis' => $latestResolved['portionBasis'] ?? 'UNKNOWN',
            ] : ['category' => 'UNKNOWN', 'fraction' => null, 'basis' => 'UNKNOWN'],
            'lastKnownIngestion' => $latest['lastKnownIntakeAt'] ?? null,
            'elapsedSinceKnownIngestionMs' => $latest['elapsedSinceKnownIntakeMs'] ?? null,
            'missedScheduledMeals' => $latest['missedScheduledMeals'] ?? 0,
            'intakeRecordContinuity' => [
                'knowledgeStatus' => $latest['intakeKnowledgeStatus'] ?? 'NO_FEEDING_RECORD',
                'unknownIntervals' => $latest['unknownIntervals'] ?? [],
            ],
            'sourceEnvironmentEventIds' => array_values(array_map(
                static fn(array $record): string => (string)($record['eventId'] ?? ''),
                $records
            )),
            'records' => $records,
            'physiologicalSatiety' => $satiety,
            'homeostaticPhysiologicalState' => 'NOT_MODELLED',
            'subjectiveHunger' => 'NOT_MODELLED',
            'note' => 'All intake facts come from structured food events. The satiety range is a Martinez, Dibbs et al. 2025 model estimate; schedule alone is not ingestion, and unknown intervals remain unknown.',
        ],
    ]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
