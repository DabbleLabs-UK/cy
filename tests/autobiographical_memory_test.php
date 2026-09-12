<?php
declare(strict_types=1);

require __DIR__ . '/../lib/autobiographical_memory.php';

$sender = str_repeat('a', 32);
$other = str_repeat('b', 32);
$row = [
    'id' => '00000000-0000-4000-8000-000000000001',
    'memory_type' => 'PERSON', 'status' => 'ACTIVE',
    'privacy_scope' => 'SENDER_RECALLABLE', 'subject_visitor_id' => $sender,
    'content' => 'A returning visitor asked about the cell.', 'public_summary' => null,
    'classification' => 'visitor history', 'consistency_status' => 'CONSISTENT',
    'created_at' => '2026-09-12 10:00:00.000', 'updated_at' => '2026-09-12 10:00:00.000',
    'last_retrieved_at' => null, 'tags' => 'cell,postcard', 'source_count' => 2,
];
$public = array_replace($row, [
    'id' => '00000000-0000-4000-8000-000000000002',
    'memory_type' => 'MOTIF', 'privacy_scope' => 'PUBLIC_RECALLABLE',
    'subject_visitor_id' => $other, 'content' => 'Private wording with a displayed name.',
    'public_summary' => 'Someone else once raised a similar question about the cell.',
    'tags' => 'cell,confinement',
]);
$archived = array_replace($row, ['id' => '00000000-0000-4000-8000-000000000003', 'status' => 'ARCHIVED']);

$checks = [];
$checks['same sender memory is eligible'] = captive_memory_visible_to_prompt($row, $sender);
$checks['different sender memory is filtered'] = !captive_memory_visible_to_prompt($row, $other);
$checks['public memory is cross-visitor eligible'] = captive_memory_visible_to_prompt($public, $sender);
$checks['archived memory is filtered'] = !captive_memory_visible_to_prompt($archived, $sender);
$checks['internal memory is available to Cy'] = captive_memory_visible_to_prompt(
    array_replace($row, ['privacy_scope' => 'INTERNAL_ONLY', 'subject_visitor_id' => null]),
    $other
);
$checks['visitor-linked internal memory does not leak to another sender'] = !captive_memory_visible_to_prompt(
    array_replace($row, ['privacy_scope' => 'INTERNAL_ONLY']),
    $other
);

$same = captive_memory_rank_candidates([$public, $row], ['text' => 'cell', 'tags' => ['postcard']], $sender);
$checks['same sender receives direct history first'] = ($same[0]['id'] ?? '') === $row['id'];
$checks['same sender reason is traceable'] = in_array('DIRECT_SENDER_HISTORY', $same[0]['retrieval_reasons'] ?? [], true);

$different = captive_memory_rank_candidates([$row, $public], ['text' => 'cell', 'tags' => ['cell']], $other);
$checks['private memory does not leak to different sender'] = count($different) === 1 && $different[0]['id'] === $public['id'];
$item = captive_memory_public_item($public);
$checks['public browser uses public summary not private content'] = $item['summary'] === $public['public_summary'];
$checks['public browser omits memory id'] = !array_key_exists('id', $item);
$checks['public browser omits subject visitor id'] = !array_key_exists('subject_visitor_id', $item);

$validated = captive_memory_validate_operation([
    'decision' => 'CREATE', 'memoryId' => '00000000-0000-4000-8000-000000000004',
    'type' => 'EPISODIC', 'privacyScope' => 'INTERNAL_ONLY',
    'source' => ['sourceType' => 'ENVIRONMENT_EVENT', 'sourceId' => 'env-test'],
]);
$checks['create operation validates'] = $validated['type'] === 'EPISODIC';
$bad = false;
try {
    captive_memory_validate_operation([
        'decision' => 'CREATE', 'memoryId' => '00000000-0000-4000-8000-000000000004',
        'type' => 'INVENTED', 'privacyScope' => 'PUBLIC_RECALLABLE',
        'source' => ['sourceType' => 'ENVIRONMENT_EVENT', 'sourceId' => 'env-test'],
    ]);
} catch (InvalidArgumentException) {
    $bad = true;
}
$checks['unknown memory type is rejected'] = $bad;
$missingSource = false;
try {
    captive_memory_validate_operation([
        'decision' => 'CREATE', 'memoryId' => '00000000-0000-4000-8000-000000000005',
        'type' => 'EPISODIC', 'privacyScope' => 'INTERNAL_ONLY',
    ]);
} catch (InvalidArgumentException) {
    $missingSource = true;
}
$checks['memory without provenance is rejected'] = $missingSource;

$source = file_get_contents(__DIR__ . '/../public/api/memory.php');
$checks['public query hard-codes public recall scope'] = is_string($source)
    && str_contains($source, "m.privacy_scope = 'PUBLIC_RECALLABLE'");
$checks['technical candidate response requires ingest key'] = is_string($source)
    && strpos($source, 'captive_require_ingest_key()') < strpos($source, "if (\$action === 'query')");
$checks['public resurfacing activity is derived from public records server-side'] = is_string($source)
    && str_contains($source, "privacy_scope = 'PUBLIC_RECALLABLE'")
    && str_contains($source, "'MEMORY_RESURFACED'");
$checks['candidate response reports attempted retrieval mechanisms'] = is_string($source)
    && str_contains($source, 'captive_memory_retrieval_mechanisms($query, $visitorId)');

$migration = file_get_contents(__DIR__ . '/../sql/015_autobiographical_memory.sql');
$checks['canonical motif is data not prompt text'] = is_string($migration)
    && str_contains($migration, 'handoff-17:8-by-4')
    && str_contains($migration, "'MOTIF'");
$library = file_get_contents(__DIR__ . '/../lib/autobiographical_memory.php');
$checks['candidate discovery is not restricted to newest 250 memories'] = is_string($library)
    && !str_contains($library, 'LIMIT 250')
    && str_contains($library, 'MATCH(content, public_summary) AGAINST (? IN BOOLEAN MODE)');
$checks['retrieval mechanism list reflects the actual query features'] = captive_memory_retrieval_mechanisms(
    ['text' => 'cell machine', 'tags' => ['confinement']],
    $sender
) === ['EXACT_PERSON', 'STRUCTURED_TAG', 'FULLTEXT_LEXICAL'];
$checks['privacy delete does not retain a content hash'] = is_string($library)
    && !str_contains($library, 'previous_content_sha256');
$checks['privacy delete clears content-bearing revisions'] = is_string($library)
    && str_contains($library, 'DELETE FROM autobiographical_memory_revisions WHERE memory_id = ?');
$runtimeMigration = file_get_contents(__DIR__ . '/../sql/017_memory_runtime_queue.sql');
$checks['formation queue is durable and source-idempotent'] = is_string($runtimeMigration)
    && str_contains($runtimeMigration, 'autobiographical_memory_formation_queue')
    && str_contains($runtimeMigration, 'uniq_memory_formation_source');
$checks['prepared sets are fingerprinted and sender scoped'] = is_string($runtimeMigration)
    && str_contains($runtimeMigration, 'context_fingerprint')
    && str_contains($runtimeMigration, 'sender_scope_key');
$checks['formation and surfacing attempts have persistent observability'] = is_string($runtimeMigration)
    && str_contains($runtimeMigration, 'autobiographical_memory_formation_attempts')
    && str_contains($runtimeMigration, 'autobiographical_memory_surfacing_attempts');
$checks['visitor work has deterministic queue priority'] =
    captive_memory_source_priority(['sourceType' => 'POSTCARD'])
        > captive_memory_source_priority(['sourceType' => 'ENVIRONMENT_EVENT'])
    && captive_memory_source_priority(['sourceType' => 'ENVIRONMENT_EVENT'])
        > captive_memory_source_priority(['sourceType' => 'CY_EXPRESSION']);
$checks['sender recallable source requires a real visitor scope'] = (function (): bool {
    try {
        captive_memory_validate_source([
            'sourceType' => 'POSTCARD', 'sourceId' => 'postcard:private',
            'sourceVisibility' => 'SENDER_RECALLABLE',
        ]);
        return false;
    } catch (InvalidArgumentException) {
        return true;
    }
})();

$failed = 0;
foreach ($checks as $label => $ok) {
    echo ($ok ? '  ok   ' : '  FAIL ') . $label . "\n";
    if (!$ok) {
        $failed++;
    }
}
echo $failed === 0 ? "ALL PASS\n" : $failed . " FAILED\n";
exit($failed === 0 ? 0 : 1);
