<?php
declare(strict_types=1);

// Owner-only exact inspection of structured somatic events and injury traces.
// This endpoint reports facts already persisted by the runner. It computes no
// subjective Pain, healing, sensitisation, action or brain activation.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/admin.php';

header('Cache-Control: no-store');

try {
    $db = captive_db();
    if (!captive_is_admin($db)) {
        captive_error_response('not found', 404);
    }

    $traces = [];
    $stmt = $db->query('SELECT record FROM environment_events ORDER BY occurred_at ASC, event_id ASC');
    while (($json = $stmt->fetchColumn()) !== false) {
        $environmentRecord = json_decode((string)$json, true);
        $trace = is_array($environmentRecord) ? ($environmentRecord['somatic_nociceptive'] ?? null) : null;
        if (is_array($trace) && ($trace['updated'] ?? false) === true) {
            $traces[] = $trace;
        }
    }

    $latest = null;
    $vitals = $db->query("SELECT payload FROM events WHERE kind = 'vitals' ORDER BY seq DESC LIMIT 1")->fetchColumn();
    if ($vitals !== false) {
        $payload = json_decode((string)$vitals, true);
        $candidate = is_array($payload) ? ($payload['soma']['somaticNociceptive'] ?? null) : null;
        if (is_array($candidate)) {
            $latest = $candidate;
        }
    }

    captive_json_response([
        'ok' => true,
        'inspection' => [
            'heading' => 'SOMATIC / NOXIOUS INPUT TRACE',
            'status' => 'IMPLEMENTED',
            'publicLabel' => 'LIVE',
            'model' => [
                'modelId' => $latest['modelId'] ?? 'structured-somatic-harm-ledger',
                'modelVersion' => $latest['modelVersion'] ?? 'somatic-nociceptive-substrate-v1',
                'provenance' => $latest['provenance'] ?? 'config/model-specs/somatic-nociceptive-substrate.json',
            ],
            'current' => $latest,
            'eventTraces' => $traces,
            'subjectivePain' => 'NOT_MODELLED',
            'generalDiscomfortIntegration' => 'NOT_MODELLED',
            'predictivePainInference' => 'NOT_MODELLED',
            'injuryHealingDynamics' => 'NOT_MODELLED',
            'peripheralSensitisation' => 'NOT_MODELLED',
            'centralSensitisation' => 'NOT_MODELLED',
            'nocifensiveActionModel' => 'NOT_MODELLED',
            'brainActivationMapping' => 'NOT_MODELLED',
            'note' => 'This is a factual computational analogue of incoming nociceptive information. Cy has no biological nociceptors, and this is not subjective Pain.',
        ],
    ]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
