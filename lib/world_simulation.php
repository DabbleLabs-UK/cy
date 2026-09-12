<?php
declare(strict_types=1);

// Private side-channel validation for context/AWG inspection records. These
// helpers validate storage shape only. Authoritative candidate validation occurs
// deterministically in runner/ambient-world-generator.js before these payloads
// can arrive here.

function captive_json_array(mixed $value, string $field): array
{
    if (!is_array($value)) {
        throw new InvalidArgumentException("$field must be an object or array");
    }
    return $value;
}

function captive_required_text(array $value, string $field, int $max): string
{
    $text = trim((string)($value[$field] ?? ''));
    if ($text === '' || mb_strlen($text) > $max) {
        throw new InvalidArgumentException("invalid $field");
    }
    return $text;
}

function captive_optional_text(array $value, string $field, int $max): ?string
{
    if (!array_key_exists($field, $value) || $value[$field] === null || $value[$field] === '') {
        return null;
    }
    $text = trim((string)$value[$field]);
    if (mb_strlen($text) > $max) {
        throw new InvalidArgumentException("invalid $field");
    }
    return $text;
}

function captive_world_datetime(?string $value): ?string
{
    if ($value === null || trim($value) === '') {
        return null;
    }
    $timestamp = strtotime($value);
    if ($timestamp === false) {
        throw new InvalidArgumentException('invalid world timestamp');
    }
    $milliseconds = '000';
    if (preg_match('/\.(\d{1,3})/', $value, $match)) {
        $milliseconds = str_pad($match[1], 3, '0');
    }
    return gmdate('Y-m-d H:i:s', $timestamp) . '.' . $milliseconds;
}

function captive_context_inspection_validate(array $payload): array
{
    $packet = captive_json_array($payload['packet'] ?? null, 'packet');
    if (($packet['schema'] ?? null) !== 'cy.shared-context-packet') {
        throw new InvalidArgumentException('invalid context packet schema');
    }
    $consumer = captive_required_text($packet, 'consumer', 32);
    $allowed = ['CY_PROSE', 'AWG', 'MEMORY_FORMATION', 'MEMORY_SURFACING', 'EXPRESSIVE_CHOICE'];
    if (!in_array($consumer, $allowed, true)) {
        throw new InvalidArgumentException('invalid context consumer');
    }
    $rendering = (string)($payload['rendering'] ?? '');
    if ($rendering === '' || mb_strlen($rendering) > 100000) {
        throw new InvalidArgumentException('invalid context rendering');
    }
    return [
        'generation_ref' => captive_optional_text($payload, 'generation_ref', 160),
        'consumer' => $consumer,
        'generated_at' => captive_required_text($packet, 'generatedAt', 40),
        'packet' => $packet,
        'rendering' => $rendering,
        'metrics' => captive_json_array($packet['metrics'] ?? null, 'metrics'),
    ];
}

function captive_awg_run_validate(array $payload): array
{
    $status = captive_required_text($payload, 'validationStatus', 24);
    if (!in_array($status, ['ACCEPTED', 'ACCEPTED_NO_EVENT', 'REJECTED', 'FAILED'], true)) {
        throw new InvalidArgumentException('invalid AWG validation status');
    }
    return [
        'run_id' => captive_required_text($payload, 'runId', 160),
        'ran_at' => captive_required_text($payload, 'ranAt', 40),
        'candidate_type' => captive_required_text($payload, 'candidateType', 24),
        'context_summary' => captive_json_array($payload['contextPacketSummary'] ?? [], 'contextPacketSummary'),
        'candidate_output' => isset($payload['candidateOutput']) && is_array($payload['candidateOutput'])
            ? $payload['candidateOutput'] : null,
        'validation_status' => $status,
        'rejection_reason' => captive_optional_text($payload, 'rejectionReason', 600),
        'created_event_ids' => captive_json_array($payload['createdWorldEventIds'] ?? [], 'createdWorldEventIds'),
        'thread_changes' => captive_json_array($payload['threadChanges'] ?? [], 'threadChanges'),
        'model_latency_ms' => max(0, (int)($payload['modelLatencyMs'] ?? 0)),
        'validation_latency_ms' => max(0, (int)($payload['validationLatencyMs'] ?? 0)),
        'total_latency_ms' => max(0, (int)($payload['totalLatencyMs'] ?? 0)),
        'provider' => captive_optional_text($payload, 'provider', 32),
        'model' => captive_optional_text($payload, 'model', 160),
    ];
}

function captive_world_thread_validate(array $payload): array
{
    $state = captive_required_text($payload, 'state', 16);
    if (!in_array($state, ['OPEN', 'RESOLVED'], true)) {
        throw new InvalidArgumentException('invalid world thread state');
    }
    return [
        'id' => captive_required_text($payload, 'id', 160),
        'type' => captive_required_text($payload, 'type', 80),
        'state' => $state,
        'summary' => captive_required_text($payload, 'summary', 800),
        'participants' => captive_json_array($payload['participants'] ?? [], 'participants'),
        'source_event_ids' => captive_json_array($payload['sourceEventIds'] ?? [], 'sourceEventIds'),
        'next_eligible_at' => captive_optional_text($payload, 'nextEligibleAt', 40),
        'resolution' => isset($payload['resolution']) && is_array($payload['resolution']) ? $payload['resolution'] : null,
        'visibility' => captive_json_array($payload['visibility'] ?? [], 'visibility'),
        'created_at' => captive_required_text($payload, 'createdAt', 40),
        'updated_at' => captive_required_text($payload, 'updatedAt', 40),
    ];
}

function captive_world_object_validate(array $payload): array
{
    return [
        'id' => captive_required_text($payload, 'id', 160),
        'type' => captive_required_text($payload, 'type', 80),
        'owner_id' => captive_optional_text($payload, 'ownerId', 80),
        'holder_id' => captive_optional_text($payload, 'holderId', 80),
        'location' => captive_required_text($payload, 'location', 80),
        'status' => captive_required_text($payload, 'status', 24),
        'visibility' => captive_json_array($payload['visibility'] ?? [], 'visibility'),
        'source_event_id' => captive_required_text($payload, 'sourceEventId', 160),
        'updated_at' => captive_required_text($payload, 'updatedAt', 40),
    ];
}
