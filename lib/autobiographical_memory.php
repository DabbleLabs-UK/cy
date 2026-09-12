<?php
declare(strict_types=1);

const CY_MEMORY_TYPES = ['EPISODIC', 'PERSON', 'MOTIF', 'UNRESOLVED_THREAD', 'SEMANTIC'];
const CY_MEMORY_SCOPES = ['INTERNAL_ONLY', 'SENDER_RECALLABLE', 'PUBLIC_RECALLABLE'];
const CY_MEMORY_CONSISTENCY = ['CONSISTENT', 'CONFLICTED', 'UNCERTAIN'];
const CY_MEMORY_REASONS = [
    'SAME_PERSON', 'SAME_PLACE', 'SHARED_ENTITIES', 'SIMILAR_SUBJECT',
    'UNRESOLVED_THREAD', 'CURRENT_EVENT', 'DIRECT_SENDER_HISTORY',
];
const CY_MEMORY_CANDIDATE_LIMIT = 10;
const CY_MEMORY_PUBLIC_LIMIT = 20;

function captive_memory_tokens(string $text): array
{
    preg_match_all("/[a-z0-9']{3,}/", mb_strtolower($text), $matches);
    return array_slice(array_values(array_unique($matches[0] ?? [])), 0, 48);
}

function captive_memory_source_priority(array $source): int
{
    $type = strtoupper((string)($source['sourceType'] ?? ''));
    $tags = array_map('strtolower', captive_memory_tags($source['tags'] ?? []));
    if ($type === 'POSTCARD') {
        return 100;
    }
    if ($type === 'CY_REPLY') {
        return 95;
    }
    if (in_array('unresolved', $tags, true) || in_array('unresolved-thread', $tags, true)) {
        return 85;
    }
    if ($type === 'ENVIRONMENT_EVENT') {
        return 70;
    }
    if ($type === 'CY_EXPRESSION') {
        return 40;
    }
    if ($type === 'AMBIENT_EVENT') {
        return 20;
    }
    return 50;
}

function captive_memory_validate_source(array $source): array
{
    $sourceType = strtoupper(mb_substr(trim((string)($source['sourceType'] ?? '')), 0, 32));
    $sourceId = mb_substr(trim((string)($source['sourceId'] ?? '')), 0, 128);
    if ($sourceType === '' || $sourceId === '') {
        throw new InvalidArgumentException('memory source type and id required');
    }
    $visitorId = isset($source['subjectVisitorId'])
        && preg_match('/^[a-f0-9]{32}$/', (string)$source['subjectVisitorId'])
        ? (string)$source['subjectVisitorId'] : null;
    $scope = in_array($source['sourceVisibility'] ?? '', CY_MEMORY_SCOPES, true)
        ? (string)$source['sourceVisibility'] : 'INTERNAL_ONLY';
    if ($scope === 'SENDER_RECALLABLE' && $visitorId === null) {
        throw new InvalidArgumentException('sender-recallable source requires visitor');
    }
    $source['sourceType'] = $sourceType;
    $source['sourceId'] = $sourceId;
    $source['subjectVisitorId'] = $visitorId;
    $source['sourceVisibility'] = $scope;
    $source['text'] = mb_substr(trim((string)($source['text'] ?? '')), 0, 2000);
    $source['tags'] = captive_memory_tags($source['tags'] ?? []);
    return $source;
}

function captive_memory_queue_depth(PDO $db): int
{
    return (int)$db->query(
        "SELECT COUNT(*) FROM autobiographical_memory_formation_queue
         WHERE status IN ('PENDING', 'PROCESSING', 'RETRYABLE')"
    )->fetchColumn();
}

function captive_memory_enqueue_source(PDO $db, array $source): array
{
    $source = captive_memory_validate_source($source);
    $priority = captive_memory_source_priority($source);
    $stmt = $db->prepare(
        "INSERT INTO autobiographical_memory_formation_queue
            (source_type, source_id, source_payload, subject_visitor_id, privacy_scope,
             priority, status, attempts, available_at, queued_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, NOW(3), NOW(3), NOW(3))
         ON DUPLICATE KEY UPDATE source_id = VALUES(source_id)"
    );
    $stmt->execute([
        $source['sourceType'], $source['sourceId'],
        json_encode($source, JSON_UNESCAPED_SLASHES), $source['subjectVisitorId'],
        $source['sourceVisibility'], $priority,
    ]);
    return [
        'queued' => $stmt->rowCount() === 1,
        'duplicate' => $stmt->rowCount() !== 1,
        'priority' => $priority,
        'depth' => captive_memory_queue_depth($db),
    ];
}

function captive_memory_claim_source(PDO $db): ?array
{
    $db->beginTransaction();
    try {
        $db->exec(
            "UPDATE autobiographical_memory_formation_queue
             SET status = 'RETRYABLE', available_at = NOW(3),
                 last_error = 'recovered after interrupted processing', updated_at = NOW(3)
             WHERE status = 'PROCESSING' AND started_at < DATE_SUB(NOW(3), INTERVAL 10 MINUTE)"
        );
        $row = $db->query(
            "SELECT * FROM autobiographical_memory_formation_queue
             WHERE status IN ('PENDING', 'RETRYABLE') AND available_at <= NOW(3)
             ORDER BY priority DESC, queued_at ASC, id ASC LIMIT 1 FOR UPDATE"
        )->fetch();
        if (!$row) {
            $db->commit();
            return null;
        }
        $stmt = $db->prepare(
            "UPDATE autobiographical_memory_formation_queue
             SET status = 'PROCESSING', attempts = attempts + 1,
                 started_at = NOW(3), updated_at = NOW(3) WHERE id = ?"
        );
        $stmt->execute([(int)$row['id']]);
        $db->commit();
        $row['source'] = json_decode((string)$row['source_payload'], true) ?: [];
        $row['attempts'] = (int)$row['attempts'] + 1;
        return $row;
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

function captive_memory_sender_scope_key(?string $visitorId): string
{
    return $visitorId ?? '';
}

function captive_memory_tags(mixed $value): array
{
    $out = [];
    foreach (is_array($value) ? $value : [] as $tag) {
        $tag = mb_substr(trim((string)$tag), 0, 64);
        if ($tag !== '' && !in_array($tag, $out, true)) {
            $out[] = $tag;
        }
        if (count($out) >= 16) {
            break;
        }
    }
    return $out;
}

function captive_memory_visible_to_prompt(array $memory, ?string $visitorId): bool
{
    if (($memory['status'] ?? '') !== 'ACTIVE') {
        return false;
    }
    if (($memory['privacy_scope'] ?? '') === 'INTERNAL_ONLY') {
        $subjectVisitorId = $memory['subject_visitor_id'] ?? null;
        return $subjectVisitorId === null
            || $visitorId === null
            || hash_equals((string)$subjectVisitorId, $visitorId);
    }
    if (($memory['privacy_scope'] ?? '') === 'PUBLIC_RECALLABLE') {
        return true;
    }
    return ($memory['privacy_scope'] ?? '') === 'SENDER_RECALLABLE'
        && $visitorId !== null
        && hash_equals((string)($memory['subject_visitor_id'] ?? ''), $visitorId);
}

function captive_memory_public_item(array $row, bool $senderOwns = false): array
{
    $public = ($row['privacy_scope'] ?? '') === 'PUBLIC_RECALLABLE';
    $content = $public ? (string)($row['public_summary'] ?? '')
        : ($senderOwns ? (string)($row['content'] ?? '') : '');
    return [
        'type' => (string)$row['memory_type'],
        'classification' => $row['classification'],
        'consistency' => (string)$row['consistency_status'],
        'summary' => $content,
        'first_formed' => (string)$row['created_at'],
        'last_updated' => (string)$row['updated_at'],
        'last_resurfaced' => $row['last_retrieved_at'],
        'source_count' => (int)($row['source_count'] ?? 0),
        'tags' => captive_memory_tags(isset($row['tags']) ? explode(',', (string)$row['tags']) : []),
    ];
}

// Deterministic engineering retrieval. There is no combined scalar and none of
// these ranks are interpreted as psychological strength or activation.
function captive_memory_rank_candidates(array $rows, array $query, ?string $visitorId, int $limit = CY_MEMORY_CANDIDATE_LIMIT): array
{
    $queryTags = captive_memory_tags($query['tags'] ?? []);
    $queryTerms = captive_memory_tokens((string)($query['text'] ?? ''));
    $location = trim((string)($query['location'] ?? ''));
    if ($location !== '' && !in_array($location, $queryTags, true)) {
        $queryTags[] = $location;
    }
    $ranked = [];
    foreach ($rows as $row) {
        if (!captive_memory_visible_to_prompt($row, $visitorId)) {
            continue;
        }
        $tags = captive_memory_tags(isset($row['tags']) ? explode(',', (string)$row['tags']) : []);
        $tagMatches = array_values(array_intersect($queryTags, $tags));
        $terms = captive_memory_tokens((string)($row['content'] ?? '') . ' ' . (string)($row['public_summary'] ?? ''));
        $termMatches = array_values(array_intersect($queryTerms, $terms));
        $samePerson = $visitorId !== null
            && ($row['subject_visitor_id'] ?? null) !== null
            && hash_equals((string)$row['subject_visitor_id'], $visitorId);
        if (!$samePerson && !$tagMatches && !$termMatches) {
            continue;
        }
        $reasons = [];
        if ($samePerson) {
            $reasons[] = 'SAME_PERSON';
            $reasons[] = 'DIRECT_SENDER_HISTORY';
        }
        if ($location !== '' && in_array($location, $tags, true)) {
            $reasons[] = 'SAME_PLACE';
        }
        if ($tagMatches) {
            $reasons[] = 'SHARED_ENTITIES';
        }
        if ($termMatches) {
            $reasons[] = 'SIMILAR_SUBJECT';
        }
        if (($row['memory_type'] ?? '') === 'UNRESOLVED_THREAD') {
            $reasons[] = 'UNRESOLVED_THREAD';
        }
        $row['tags_array'] = $tags;
        $row['retrieval_reasons'] = array_values(array_unique($reasons));
        $row['_rank'] = [
            $samePerson ? 1 : 0,
            count($tagMatches),
            count($termMatches),
            ($row['memory_type'] ?? '') === 'UNRESOLVED_THREAD' ? 1 : 0,
            strtotime((string)($row['updated_at'] ?? '1970-01-01')) ?: 0,
        ];
        $ranked[] = $row;
    }
    usort($ranked, static function (array $a, array $b): int {
        for ($i = 0; $i < count($a['_rank']); $i++) {
            if ($a['_rank'][$i] !== $b['_rank'][$i]) {
                return $b['_rank'][$i] <=> $a['_rank'][$i];
            }
        }
        return strcmp((string)$a['id'], (string)$b['id']);
    });
    return array_slice($ranked, 0, max(0, min(CY_MEMORY_CANDIDATE_LIMIT, $limit)));
}

function captive_memory_retrieval_mechanisms(array $query, ?string $visitorId): array
{
    $mechanisms = [];
    if ($visitorId !== null) {
        $mechanisms[] = 'EXACT_PERSON';
    }
    if (captive_memory_tags($query['tags'] ?? [])
        || trim((string)($query['location'] ?? '')) !== '') {
        $mechanisms[] = 'STRUCTURED_TAG';
    }
    if (captive_memory_tokens((string)($query['text'] ?? ''))) {
        $mechanisms[] = 'FULLTEXT_LEXICAL';
    }
    return $mechanisms;
}

function captive_memory_snapshot(array $memory): array
{
    return [
        'memory_type' => $memory['memory_type'],
        'status' => $memory['status'],
        'privacy_scope' => $memory['privacy_scope'],
        'epistemic_status' => 'SUBJECTIVE_AUTOBIOGRAPHICAL_MEMORY',
        'consistency_status' => $memory['consistency_status'],
        'content' => $memory['content'],
        'public_summary' => $memory['public_summary'],
        'classification' => $memory['classification'],
        'name_recallable' => (bool)$memory['name_recallable'],
    ];
}

function captive_memory_validate_operation(array $operation): array
{
    $decision = strtoupper((string)($operation['decision'] ?? ''));
    if (!in_array($decision, ['CREATE', 'UPDATE', 'ARCHIVE', 'DELETE'], true)) {
        throw new InvalidArgumentException('invalid memory operation');
    }
    $id = (string)($operation['memoryId'] ?? '');
    if (!preg_match('/^[0-9a-f-]{36}$/', $id)) {
        throw new InvalidArgumentException('invalid memory id');
    }
    if ($decision === 'CREATE' && !in_array($operation['type'] ?? '', CY_MEMORY_TYPES, true)) {
        throw new InvalidArgumentException('invalid memory type');
    }
    if ($decision === 'CREATE' && !in_array($operation['privacyScope'] ?? '', CY_MEMORY_SCOPES, true)) {
        throw new InvalidArgumentException('invalid privacy scope');
    }
    if (isset($operation['consistencyStatus'])
        && !in_array($operation['consistencyStatus'], CY_MEMORY_CONSISTENCY, true)) {
        throw new InvalidArgumentException('invalid consistency status');
    }
    if (in_array($decision, ['CREATE', 'UPDATE'], true)) {
        $source = $operation['source'] ?? null;
        if (!is_array($source)
            || trim((string)($source['sourceType'] ?? '')) === ''
            || trim((string)($source['sourceId'] ?? '')) === '') {
            throw new InvalidArgumentException('memory provenance source required');
        }
    }
    if ($decision === 'CREATE') {
        $scope = (string)$operation['privacyScope'];
        $subjectVisitorId = (string)($operation['source']['subjectVisitorId'] ?? '');
        if ($scope === 'SENDER_RECALLABLE' && !preg_match('/^[0-9a-f]{32}$/', $subjectVisitorId)) {
            throw new InvalidArgumentException('sender-recallable memory requires its subject visitor id');
        }
        if ($scope === 'PUBLIC_RECALLABLE' && trim((string)($operation['publicSummary'] ?? '')) === '') {
            throw new InvalidArgumentException('public-recallable memory requires a public summary');
        }
    }
    return $operation;
}

function captive_memory_fetch_rows(PDO $db, array $query, ?string $visitorId): array
{
    // Indexed engineering pre-filter. Each path contributes IDs from the whole
    // active store, so age alone never makes a retained memory unreachable.
    $candidateIds = [];
    $addIds = static function (array $rows) use (&$candidateIds): void {
        foreach ($rows as $row) {
            $id = (string)($row['id'] ?? '');
            if ($id !== '') {
                $candidateIds[$id] = true;
            }
        }
    };

    if ($visitorId !== null) {
        $stmt = $db->prepare(
            "SELECT id FROM autobiographical_memories
             WHERE status = 'ACTIVE' AND subject_visitor_id = ?
             ORDER BY updated_at DESC LIMIT 100"
        );
        $stmt->execute([$visitorId]);
        $addIds($stmt->fetchAll());
    }

    $tags = captive_memory_tags($query['tags'] ?? []);
    $location = mb_substr(trim((string)($query['location'] ?? '')), 0, 64);
    if ($location !== '' && !in_array($location, $tags, true)) {
        $tags[] = $location;
    }
    if ($tags) {
        $placeholders = implode(',', array_fill(0, count($tags), '?'));
        $stmt = $db->prepare(
            "SELECT m.id
             FROM autobiographical_memories m
             JOIN autobiographical_memory_tags t ON t.memory_id = m.id
             WHERE m.status = 'ACTIVE' AND t.tag IN ($placeholders)
             GROUP BY m.id
             ORDER BY COUNT(DISTINCT t.tag) DESC, m.updated_at DESC
             LIMIT 200"
        );
        $stmt->execute($tags);
        $addIds($stmt->fetchAll());
    }

    $terms = captive_memory_tokens((string)($query['text'] ?? ''));
    if ($terms) {
        $booleanQuery = implode(' ', array_map(
            static fn(string $term): string => $term . '*',
            $terms
        ));
        $stmt = $db->prepare(
            "SELECT id,
                    MATCH(content, public_summary) AGAINST (? IN BOOLEAN MODE) AS fts_rank
             FROM autobiographical_memories
             WHERE status = 'ACTIVE'
             HAVING fts_rank > 0
             ORDER BY fts_rank DESC, updated_at DESC
             LIMIT 200"
        );
        $stmt->execute([$booleanQuery]);
        $addIds($stmt->fetchAll());
    }

    $ids = array_slice(array_keys($candidateIds), 0, 500);
    if (!$ids) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $db->prepare(
        "SELECT m.*, GROUP_CONCAT(DISTINCT t.tag ORDER BY t.tag SEPARATOR ',') AS tags,
                COUNT(DISTINCT CONCAT(s.source_type, ':', s.source_id)) AS source_count
         FROM autobiographical_memories m
         LEFT JOIN autobiographical_memory_tags t ON t.memory_id = m.id
         LEFT JOIN autobiographical_memory_sources s ON s.memory_id = m.id
         WHERE m.id IN ($placeholders)
         GROUP BY m.id"
    );
    $stmt->execute($ids);
    return $stmt->fetchAll();
}

function captive_memory_query(PDO $db, array $query, ?string $visitorId, int $limit = CY_MEMORY_CANDIDATE_LIMIT): array
{
    $rows = captive_memory_fetch_rows($db, $query, $visitorId);
    $ranked = captive_memory_rank_candidates($rows, $query, $visitorId, $limit);
    return array_map(static function (array $row) use ($visitorId): array {
        $crossVisitor = $visitorId !== null
            && (string)$row['privacy_scope'] === 'PUBLIC_RECALLABLE'
            && (($row['subject_visitor_id'] ?? null) === null
                || !hash_equals((string)$row['subject_visitor_id'], $visitorId));
        return [
            'id' => (string)$row['id'],
            'type' => (string)$row['memory_type'],
            'status' => (string)$row['status'],
            'privacyScope' => (string)$row['privacy_scope'],
            'subjectVisitorId' => $row['subject_visitor_id'],
            'content' => $crossVisitor ? (string)($row['public_summary'] ?? '') : (string)$row['content'],
            'publicSummary' => $row['public_summary'],
            'classification' => $row['classification'],
            'consistencyStatus' => (string)$row['consistency_status'],
            'version' => (int)$row['version'],
            'tags' => $row['tags_array'],
            'reasons' => $row['retrieval_reasons'],
            'sourceCount' => (int)$row['source_count'],
        ];
    }, $ranked);
}

function captive_memory_add_source(PDO $db, string $memoryId, array $source): void
{
    $stmt = $db->prepare(
        'INSERT IGNORE INTO autobiographical_memory_sources
            (memory_id, source_type, source_id, source_timestamp, source_excerpt, source_visibility, created_at)
         VALUES (:memory_id, :source_type, :source_id, :source_timestamp, :source_excerpt, :source_visibility, NOW(3))'
    );
    $timestamp = $source['occurredAt'] ?? null;
    $stmt->bindValue(':memory_id', $memoryId);
    $stmt->bindValue(':source_type', mb_substr((string)($source['sourceType'] ?? 'UNKNOWN'), 0, 32));
    $stmt->bindValue(':source_id', mb_substr((string)($source['sourceId'] ?? ''), 0, 128));
    $stmt->bindValue(':source_timestamp', $timestamp, $timestamp !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
    $excerpt = isset($source['text']) ? mb_substr((string)$source['text'], 0, 2000) : null;
    $stmt->bindValue(':source_excerpt', $excerpt, $excerpt !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
    $visibility = in_array($source['sourceVisibility'] ?? '', CY_MEMORY_SCOPES, true)
        ? $source['sourceVisibility'] : 'INTERNAL_ONLY';
    $stmt->bindValue(':source_visibility', $visibility);
    $stmt->execute();
}

function captive_memory_replace_tags(PDO $db, string $memoryId, array $tags): void
{
    $db->prepare('DELETE FROM autobiographical_memory_tags WHERE memory_id = ?')->execute([$memoryId]);
    $insert = $db->prepare('INSERT INTO autobiographical_memory_tags (memory_id, tag) VALUES (?, ?)');
    foreach (captive_memory_tags($tags) as $tag) {
        $insert->execute([$memoryId, $tag]);
    }
}

function captive_memory_apply(PDO $db, array $rawOperation): array
{
    $op = captive_memory_validate_operation($rawOperation);
    $decision = strtoupper((string)$op['decision']);
    $id = (string)$op['memoryId'];
    $db->beginTransaction();
    try {
        if ($decision === 'CREATE') {
            $memory = [
                'memory_type' => $op['type'], 'status' => 'ACTIVE',
                'privacy_scope' => $op['privacyScope'],
                'consistency_status' => $op['consistencyStatus'] ?? 'UNCERTAIN',
                'content' => mb_substr(trim((string)($op['content'] ?? '')), 0, 2000),
                'public_summary' => isset($op['publicSummary']) ? mb_substr(trim((string)$op['publicSummary']), 0, 600) : null,
                'classification' => isset($op['classification']) ? mb_substr(trim((string)$op['classification']), 0, 80) : null,
                'name_recallable' => !empty($op['nameRecallable']) ? 1 : 0,
            ];
            if ($memory['content'] === '') {
                throw new InvalidArgumentException('memory content required');
            }
            $stmt = $db->prepare(
                'INSERT INTO autobiographical_memories
                    (id, memory_type, status, privacy_scope, consistency_status, subject_visitor_id,
                     content, public_summary, classification, name_recallable, created_at, updated_at)
                 VALUES (:id, :type, :status, :scope, :consistency, :visitor,
                         :content, :public_summary, :classification, :name_recallable, NOW(3), NOW(3))'
            );
            $stmt->execute([
                ':id' => $id, ':type' => $memory['memory_type'], ':status' => 'ACTIVE',
                ':scope' => $memory['privacy_scope'], ':consistency' => $memory['consistency_status'],
                ':visitor' => $op['source']['subjectVisitorId'] ?? null, ':content' => $memory['content'],
                ':public_summary' => $memory['public_summary'], ':classification' => $memory['classification'],
                ':name_recallable' => $memory['name_recallable'],
            ]);
            $version = 1;
        } else {
            $select = $db->prepare('SELECT * FROM autobiographical_memories WHERE id = ? FOR UPDATE');
            $select->execute([$id]);
            $current = $select->fetch();
            if (!$current) {
                throw new InvalidArgumentException('memory not found');
            }
            if ($decision === 'UPDATE') {
                $expected = (int)($op['expectedVersion'] ?? 0);
                if ($expected !== (int)$current['version']) {
                    throw new RuntimeException('memory version conflict');
                }
                $memory = [
                    'memory_type' => $current['memory_type'], 'status' => 'ACTIVE',
                    'privacy_scope' => $current['privacy_scope'],
                    'consistency_status' => $op['consistencyStatus'] ?? $current['consistency_status'],
                    'content' => mb_substr(trim((string)($op['content'] ?? '')), 0, 2000),
                    'public_summary' => array_key_exists('publicSummary', $op) ? mb_substr(trim((string)$op['publicSummary']), 0, 600) : $current['public_summary'],
                    'classification' => array_key_exists('classification', $op) ? mb_substr(trim((string)$op['classification']), 0, 80) : $current['classification'],
                    'name_recallable' => (int)$current['name_recallable'],
                ];
                $version = (int)$current['version'] + 1;
                $upd = $db->prepare(
                    'UPDATE autobiographical_memories
                     SET content = :content, public_summary = :public_summary,
                         classification = :classification, consistency_status = :consistency,
                         version = :version, updated_at = NOW(3)
                     WHERE id = :id'
                );
                $upd->execute([
                    ':content' => $memory['content'], ':public_summary' => $memory['public_summary'],
                    ':classification' => $memory['classification'], ':consistency' => $memory['consistency_status'],
                    ':version' => $version, ':id' => $id,
                ]);
            } elseif ($decision === 'ARCHIVE') {
                $memory = array_replace($current, ['status' => 'ARCHIVED']);
                $version = (int)$current['version'] + 1;
                $db->prepare("UPDATE autobiographical_memories SET status = 'ARCHIVED', version = ?, updated_at = NOW(3) WHERE id = ?")
                    ->execute([$version, $id]);
            } else {
                // Privacy deletion leaves only a content-free, unlinked tombstone.
                // Previous content-bearing revisions and public activity are also
                // removed; ordinary forgetting uses ARCHIVE instead.
                $version = (int)$current['version'] + 1;
                $memory = array_replace($current, [
                    'status' => 'DELETED', 'content' => '', 'public_summary' => null,
                    'classification' => 'deleted for privacy', 'privacy_scope' => 'INTERNAL_ONLY',
                    'subject_visitor_id' => null, 'name_recallable' => 0,
                ]);
                $db->prepare("UPDATE autobiographical_memories
                    SET status = 'DELETED', content = '', public_summary = NULL,
                        classification = 'deleted for privacy', privacy_scope = 'INTERNAL_ONLY',
                        subject_visitor_id = NULL, name_recallable = 0,
                        last_retrieved_at = NULL, retrieval_count = 0,
                        version = ?, updated_at = NOW(3)
                    WHERE id = ?")->execute([$version, $id]);
                $db->prepare('DELETE FROM autobiographical_memory_sources WHERE memory_id = ?')->execute([$id]);
                $db->prepare('DELETE FROM autobiographical_memory_tags WHERE memory_id = ?')->execute([$id]);
                $db->prepare('DELETE FROM autobiographical_memory_revisions WHERE memory_id = ?')->execute([$id]);
                $db->prepare('DELETE FROM autobiographical_memory_activity WHERE memory_id = ?')->execute([$id]);
            }
        }
        if (in_array($decision, ['CREATE', 'UPDATE'], true)) {
            captive_memory_add_source($db, $id, $op['source'] ?? []);
            captive_memory_replace_tags($db, $id, $op['tags'] ?? []);
        }
        $snapshot = $decision === 'DELETE'
            ? ['status' => 'DELETED']
            : captive_memory_snapshot($memory);
        $rev = $db->prepare(
            'INSERT INTO autobiographical_memory_revisions
                (memory_id, version, operation, snapshot, source_type, source_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW(3))'
        );
        $rev->execute([
            $id, $version, $decision, json_encode($snapshot, JSON_UNESCAPED_SLASHES),
            $op['source']['sourceType'] ?? null, $op['source']['sourceId'] ?? null,
        ]);
        $db->commit();
        return ['memory_id' => $id, 'version' => $version, 'operation' => $decision];
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}
