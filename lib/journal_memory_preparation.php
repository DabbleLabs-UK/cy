<?php
declare(strict_types=1);

const CY_JOURNAL_PREPARATION_VERSION = 'cy.journal-preparation.v1';
const CY_JOURNAL_CUE_VERSION = 'cy.journal-cue.v1';

function captive_journal_preparation_json(mixed $value): string
{
    return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE
        | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS);
}

function captive_journal_preparation_equal(mixed $left, mixed $right): bool
{
    if (!is_array($left) || !is_array($right)) return $left === $right;
    if (count($left) !== count($right) || array_is_list($left) !== array_is_list($right)) return false;
    foreach ($left as $key => $value) {
        if (!array_key_exists($key, $right) || !captive_journal_preparation_equal($value, $right[$key])) return false;
    }
    return true;
}

function captive_journal_memory_cue(array $record): ?array
{
    $event = $record['world_event'] ?? null;
    if (!is_array($event) || !is_string($event['id'] ?? null) || $event['id'] === ''
        || !in_array('soma-input-staging-v1', $record['consumed_by'] ?? [], true)
        || in_array($event['event_type'] ?? '', ['postcard', 'postcard_with_image', 'postcard_reply'], true)) return null;
    $text = $event['context']['description'] ?? null;
    if ($text === null || $text === '') $text = $record['observation']['summary'] ?? null;
    if ($text === null || $text === '') $text = $event['event_type'] ?? '';
    if (!is_string($text)) return null;
    $tags = [];
    foreach ([$event['event_family'] ?? null, $event['event_type'] ?? null, $event['context']['location'] ?? null] as $tag) {
        if (is_string($tag) && trim($tag) !== '') $tags[] = mb_strtolower(trim($tag));
    }
    $tags = array_values(array_unique($tags));
    sort($tags, SORT_STRING);
    $cue = [
        'version' => CY_JOURNAL_CUE_VERSION, 'sourceEventId' => $event['id'],
        'occurredAt' => $event['timestamp'] ?? null, 'eventType' => $event['event_type'] ?? null,
        'eventFamily' => $event['event_family'] ?? null, 'text' => mb_substr(trim($text), 0, 600),
        'tags' => $tags, 'location' => $event['world']['context']['location'] ?? null,
        'scope' => 'NO_SENDER_JOURNAL',
    ];
    if ($cue['text'] === '' || !is_string($cue['occurredAt']) || !is_string($cue['eventType'])
        || !is_string($cue['eventFamily']) || ($cue['location'] !== null && !is_string($cue['location']))) return null;
    $cue['digest'] = hash('sha256', captive_journal_preparation_json(array_values($cue)));
    return $cue;
}

function captive_journal_preparation_binding(array $context, string $fingerprint, ?string $subject): ?array
{
    if (!array_key_exists('journalPreparation', $context)) return null;
    $binding = $context['journalPreparation'];
    $anchor = is_array($binding) ? ($binding['slotAnchorMs'] ?? null) : null;
    if (!is_array($binding) || ($binding['version'] ?? '') !== CY_JOURNAL_PREPARATION_VERSION
        || count($binding) !== 4 || !is_int($anchor) || $anchor < 1 || $anchor > 9007199254740991 || $subject !== null
        || ($context['generationRef'] ?? '') !== 'journal:' . $anchor
        || ($binding['slotKey'] ?? '') !== hash('sha256', CY_JOURNAL_PREPARATION_VERSION . ':' . $anchor)
        || $fingerprint !== $binding['slotKey'] || !is_array($binding['cue'] ?? null)) {
        throw new InvalidArgumentException('invalid journal preparation binding');
    }
    return $binding;
}

function captive_journal_preparation_validate(PDO $db, array $context, string $fingerprint, ?string $subject): ?array
{
    $binding = captive_journal_preparation_binding($context, $fingerprint, $subject);
    if ($binding === null) return null;
    $source = $binding['cue']['sourceEventId'] ?? null;
    if (!is_string($source) || $source === '' || strlen($source) > 96) {
        throw new InvalidArgumentException('invalid journal cue source');
    }
    $stmt = $db->prepare('SELECT record FROM environment_events WHERE event_id = ?');
    $stmt->execute([$source]);
    $stored = $stmt->fetchColumn();
    $cue = $stored === false ? null : captive_journal_memory_cue(json_decode((string)$stored, true, 64, JSON_THROW_ON_ERROR));
    if ($cue === null || !captive_journal_preparation_equal($cue, $binding['cue'])) {
        throw new InvalidArgumentException('journal cue is not the acknowledged canonical observation');
    }
    return $binding;
}

function captive_journal_preparation_enqueue(PDO $db, array $context, string $fingerprint, ?string $subject, int $priority): array
{
    $binding = captive_journal_preparation_validate($db, $context, $fingerprint, $subject);
    if ($binding === null) throw new InvalidArgumentException('journal preparation required');
    $stmt = $db->prepare("INSERT INTO autobiographical_memory_surfacing_queue
        (context_fingerprint,context_payload,subject_visitor_id,sender_scope_key,priority,status,attempts,available_at,queued_at,updated_at)
        VALUES (?, ?, NULL, '', ?, 'PENDING', 0, NOW(3), NOW(3), NOW(3))
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)");
    $stmt->execute([$fingerprint, captive_journal_preparation_json($context), $priority]);
    $queued = $stmt->rowCount() === 1;
    $read = $db->prepare("SELECT context_payload FROM autobiographical_memory_surfacing_queue
        WHERE context_fingerprint = ? AND sender_scope_key = ''");
    $read->execute([$fingerprint]);
    $saved = json_decode((string)$read->fetchColumn(), true, 64, JSON_THROW_ON_ERROR);
    if (!captive_journal_preparation_equal($saved['journalPreparation'] ?? null, $binding)) throw new RuntimeException('journal preparation slot conflict');
    return ['ok' => true, 'queued' => $queued];
}

function captive_journal_preparation_for_set(PDO $db, array $set): ?array
{
    $stmt = $db->prepare('SELECT q.context_payload FROM autobiographical_memory_surfacing_attempts a
        JOIN autobiographical_memory_surfacing_queue q ON q.id = a.queue_id
        WHERE a.prepared_set_id = ? LIMIT 1');
    $stmt->execute([$set['id']]);
    $payload = $stmt->fetchColumn();
    if ($payload === false) return null;
    $context = json_decode((string)$payload, true, 64, JSON_THROW_ON_ERROR);
    return captive_journal_preparation_validate($db, $context, (string)$set['context_fingerprint'], $set['subject_visitor_id']);
}

function captive_journal_selection_row_hash(array $row): string
{
    // Private hashes bind the sanitized runner projection to the canonical
    // version it selected. Do not reimplement character sanitation in PHP.
    $fields = ['id', 'memory_type', 'status', 'privacy_scope', 'subject_visitor_id',
        'content', 'public_summary', 'classification', 'consistency_status',
        'version', 'origin_kind', 'tags', 'source_kinds', 'source_count'];
    $values = [];
    foreach ($fields as $field) $values[] = $row[$field] ?? null;
    return hash('sha256', captive_journal_preparation_json($values));
}

function captive_journal_selection_snapshot(array $selected, array $rows, array $candidateIds, ?array $candidateVersions = null): ?array
{
    $canonical = array_column($rows, null, 'id');
    $hashes = [];
    foreach ($selected as $memory) {
        if (!is_array($memory) || !is_string($memory['id'] ?? null)) return null;
        $id = $memory['id'];
        $row = $canonical[$id] ?? null;
        if (isset($hashes[$id]) || !in_array($id, $candidateIds, true) || !$row
            || ($candidateVersions !== null && (!is_int($candidateVersions[$id] ?? null)
                || $candidateVersions[$id] !== (int)$row['version']))
            || !captive_memory_visible_to_prompt($row, null)
            || ($memory['status'] ?? null) !== 'ACTIVE'
            || ($memory['privacyScope'] ?? null) !== $row['privacy_scope']
            || ($memory['subjectVisitorId'] ?? null) !== ($row['subject_visitor_id'] ?? null)
            || ($memory['type'] ?? null) !== $row['memory_type']
            || ($memory['originKind'] ?? null) !== ($row['origin_kind'] ?: null)
            || ($memory['epistemicStatus'] ?? null) !== 'SUBJECTIVE_AUTOBIOGRAPHICAL_MEMORY'
            || ($memory['consistencyStatus'] ?? null) !== $row['consistency_status']) return null;
        $hashes[$id] = captive_journal_selection_row_hash($row);
    }
    return ['selectedProjectionDigest' => hash('sha256', captive_journal_preparation_json($selected)),
        'canonicalHashes' => $hashes];
}

function captive_journal_selection_current(PDO $db, array $set): bool
{
    $stmt = $db->prepare('SELECT q.context_payload FROM autobiographical_memory_surfacing_attempts a
        JOIN autobiographical_memory_surfacing_queue q ON q.id = a.queue_id
        WHERE a.prepared_set_id = ? LIMIT 1');
    $stmt->execute([$set['id']]);
    $context = json_decode((string)$stmt->fetchColumn(), true, 64, JSON_THROW_ON_ERROR);
    $snapshot = $context['journalSelectionSnapshot'] ?? null;
    $selected = $set['selected_memories'];
    if (!is_array($snapshot) || !is_array($selected)) return false;
    $ids = array_column($selected, 'id');
    $current = captive_journal_selection_snapshot($selected, captive_memory_rows_by_ids($db, $ids), $ids);
    return $current !== null && $snapshot === $current;
}
