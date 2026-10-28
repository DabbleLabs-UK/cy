<?php
declare(strict_types=1);
require __DIR__ . '/../lib/autobiographical_memory.php';
$checks = [];
$record = ['world_event' => ['id' => 'env-synthetic', 'timestamp' => '2026-10-28T10:00:00.000Z',
    'event_type' => 'observed_search', 'event_family' => 'institutional',
    'world' => ['context' => ['location' => 'CELL']]],
    'observation' => ['summary' => 'A synthetic search happened.'], 'consumed_by' => ['soma-input-staging-v1']];
$cue = captive_journal_memory_cue($record);
$checks['acknowledged source yields exact cue'] = $cue['sourceEventId'] === 'env-synthetic' && $cue['location'] === 'CELL';
$checks['cue tags keep original source projection'] = $cue['tags'] === ['institutional', 'observed_search'];
$unacknowledged = $record; $unacknowledged['consumed_by'] = [];
$checks['unacknowledged source fails closed'] = captive_journal_memory_cue($unacknowledged) === null;
foreach (['postcard', 'postcard_with_image', 'postcard_reply'] as $type) {
    $private = $record; $private['world_event']['event_type'] = $type;
    $checks['no correspondence cue ' . $type] = captive_journal_memory_cue($private) === null;
}
$long = $record; $long['observation']['summary'] = str_repeat("\u{1F600}", 601);
$checks['unicode codepoint bound'] = mb_strlen(captive_journal_memory_cue($long)['text']) === 600;
$withoutDigest = $cue; unset($withoutDigest['digest']);
$checks['digest binds ordered observed fields'] = $cue['digest'] === hash('sha256', captive_journal_preparation_json(array_values($withoutDigest)));
$anchor = 1793181600000;
$key = hash('sha256', CY_JOURNAL_PREPARATION_VERSION . ':' . $anchor);
$binding = ['version' => CY_JOURNAL_PREPARATION_VERSION, 'slotAnchorMs' => $anchor, 'slotKey' => $key, 'cue' => $cue];
$context = ['generationRef' => 'journal:' . $anchor, 'journalPreparation' => $binding];
$checks['exact slot binding'] = captive_journal_preparation_binding($context, $key, null) === $binding;
foreach (['fingerprint', 'sender', 'anchor', 'namespace'] as $wrong) {
    $bad = $context; $fingerprint = $key; $sender = null;
    if ($wrong === 'fingerprint') $fingerprint = str_repeat('a', 64);
    if ($wrong === 'sender') $sender = str_repeat('a', 32);
    if ($wrong === 'anchor') $bad['journalPreparation']['slotAnchorMs']++;
    if ($wrong === 'namespace') $bad['generationRef'] = 'postcard:1';
    try { captive_journal_preparation_binding($bad, $fingerprint, $sender); $checks['reject ' . $wrong] = false; }
    catch (InvalidArgumentException) { $checks['reject ' . $wrong] = true; }
}
$row = ['id' => 'memory-synthetic', 'status' => 'ACTIVE', 'memory_type' => 'EPISODIC',
    'privacy_scope' => 'INTERNAL_ONLY', 'subject_visitor_id' => null, 'origin_kind' => 'ENVIRONMENT_EVENT',
    'consistency_status' => 'CONSISTENT', 'content' => 'Synthetic canonical remembered event.'];
$selected = ['id' => $row['id'], 'status' => 'ACTIVE', 'type' => 'EPISODIC', 'privacyScope' => 'INTERNAL_ONLY',
    'subjectVisitorId' => null, 'originKind' => 'ENVIRONMENT_EVENT', 'consistencyStatus' => 'CONSISTENT',
    'epistemicStatus' => 'SUBJECTIVE_AUTOBIOGRAPHICAL_MEMORY', 'content' => 'Synthetic sanitized remembered event.'];
$snapshot = captive_journal_selection_snapshot([$selected], [$row], [$row['id']]);
$checks['selected projection is not rewritten'] = $snapshot !== null && !str_contains(json_encode($snapshot), 'remembered');
$checks['empty selection remains empty'] = captive_journal_selection_snapshot([], [], []) !== null;
foreach (['ARCHIVED', 'DELETED', '', 'UNKNOWN'] as $status) {
    $bad = $row; $bad['status'] = $status;
    $checks['nonACTIVE canonical blocked ' . $status] = captive_journal_selection_snapshot([$selected], [$bad], [$row['id']]) === null;
}
$private = $row; $private['privacy_scope'] = 'SENDER_RECALLABLE'; $private['subject_visitor_id'] = str_repeat('b', 32);
$checks['sender-only excluded'] = captive_journal_selection_snapshot([$selected], [$private], [$row['id']]) === null;
$bad = $selected; unset($bad['status']);
$checks['missing selected status fails closed'] = captive_journal_selection_snapshot([$bad], [$row], [$row['id']]) === null;
$bad = $selected; $bad['originKind'] = 'CY_EXPRESSION';
$checks['changed provenance fails closed'] = captive_journal_selection_snapshot([$bad], [$row], [$row['id']]) === null;
$checks['unoffered ID fails closed'] = captive_journal_selection_snapshot([$selected], [$row], []) === null;
$checks['duplicate selected ID fails closed'] = captive_journal_selection_snapshot([$selected, $selected], [$row], [$row['id']]) === null;
$changed = $row; $changed['content'] .= ' changed';
$checks['canonical content mutation changes hash'] = captive_journal_selection_row_hash($changed) !== captive_journal_selection_row_hash($row);
$versioned = $row + ['version' => 2];
$checks['query-time version must match'] = captive_journal_selection_snapshot([$selected], [$versioned], [$row['id']], [$row['id'] => 2]) !== null;
$checks['older query-time version fails closed'] = captive_journal_selection_snapshot([$selected], [$versioned], [$row['id']], [$row['id'] => 1]) === null;
$checks['missing query-time version fails closed'] = captive_journal_selection_snapshot([$selected], [$versioned], [$row['id']], []) === null;
$checks['string query-time version fails closed'] = captive_journal_selection_snapshot([$selected], [$versioned], [$row['id']], [$row['id'] => '2']) === null;
foreach ($checks as $label => $ok) if (!$ok) { fwrite(STDERR, 'FAIL: ' . $label . PHP_EOL); exit(1); }
echo 'journal_memory_preparation_test.php: ' . count($checks) . " checks passed\n";
