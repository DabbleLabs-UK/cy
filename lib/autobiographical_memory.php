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
const CY_MEMORY_FORMATION_FAILURE_LIMIT = 6;
const CY_MEMORY_GENERIC_SOURCE_TYPES = ['ENVIRONMENT_EVENT', 'DREAM_EXPRESSION', 'CY_EXPRESSION'];
const CY_MEMORY_GENERIC_CADENCE_MS = 1800000;
// Bounded retention for generic formation candidates. Recent-first selection
// means a generic source not admitted within this window is never examined;
// aging it to a terminal EXPIRED state keeps the claimable queue from becoming
// an ever-growing archive. The window is deliberately generous so this is a
// gradual, uniform age-out, never a bulk purge of accumulated history.
const CY_MEMORY_GENERIC_RETENTION_DAYS = 30;
const CY_MEMORY_GENERIC_EXPIRY_BATCH = 100;
const CY_MEMORY_FORMATION_REJECTION_CODES = [
    'JSON_FORMAT', 'SCHEMA', 'ILLEGAL_ACTION', 'ILLEGAL_TYPE', 'UNKNOWN_REF',
    'MISSING_FIELD', 'FORBIDDEN_FIELD', 'PRIVACY_PROVENANCE', 'APPLICATION_CONFLICT',
];

function captive_memory_formation_retry(int $failureStreak, string $category, int $modelInvalidStreak = 0): array
{
    $invalids = min(CY_MEMORY_FORMATION_FAILURE_LIMIT, max(0, $modelInvalidStreak));
    if ($category === 'PREEMPTED') {
        return ['status' => 'RETRYABLE', 'failure_streak' => $failureStreak,
            'model_invalid_streak' => $invalids, 'delay_seconds' => 30];
    }
    $failures = min(CY_MEMORY_FORMATION_FAILURE_LIMIT, max(0, $failureStreak) + 1);
    if ($category === 'INVALID') $invalids = min(CY_MEMORY_FORMATION_FAILURE_LIMIT, $invalids + 1);
    // Operational outages and model-access timeouts must not permanently
    // condemn a valid durable source. Only repeated invalid model decisions
    // can reach terminal failure; all retries remain rate-limited.
    return ['status' => $category === 'INVALID' && $invalids >= CY_MEMORY_FORMATION_FAILURE_LIMIT ? 'FAILED' : 'RETRYABLE',
        'failure_streak' => $failures, 'model_invalid_streak' => $invalids,
        'delay_seconds' => min(900, 30 * (2 ** ($failures - 1)))];
}

function captive_memory_formation_rejection_code(mixed $value): ?string
{
    if ($value === null) return null;
    if (!is_string($value) || !in_array($value, CY_MEMORY_FORMATION_REJECTION_CODES, true)) {
        throw new InvalidArgumentException('invalid formation rejection code');
    }
    return $value;
}

function captive_memory_formation_filter(array $input): array
{
    $senderOnly = $input['sender_only'] ?? false;
    $age = $input['min_age_seconds'] ?? 0;
    $visitor = $input['visitor_id'] ?? null;
    if (!is_bool($senderOnly) || !is_int($age) || $age < 0 || $age > 86400
        || ($visitor !== null && (!is_string($visitor) || !preg_match('/^[a-f0-9]{32}$/', $visitor)))) {
        throw new InvalidArgumentException('invalid formation claim filter');
    }
    return ['sender_only' => $senderOnly, 'min_age_seconds' => $age, 'visitor_id' => $visitor];
}

function captive_memory_generic_source_type(mixed $type): string
{
    if (!is_string($type) || !in_array($type, CY_MEMORY_GENERIC_SOURCE_TYPES, true)) {
        throw new InvalidArgumentException('invalid generic formation source type');
    }
    return $type;
}

function captive_memory_formation_health(PDO $db): array
{
    $row = $db->query("SELECT
        COALESCE(SUM(status = 'PENDING'),0) AS pending,
        COALESCE(SUM(status = 'PROCESSING'),0) AS processing,
        COALESCE(SUM(status = 'RETRYABLE'),0) AS retryable,
        COALESCE(SUM(status = 'FAILED'),0) AS failed,
        COALESCE(SUM(status = 'QUARANTINED'),0) AS quarantined,
        COALESCE(SUM(status IN ('PENDING','RETRYABLE') AND available_at <= NOW(3)
            AND source_type IN ('POSTCARD','CY_REPLY') AND subject_visitor_id IS NOT NULL),0) AS sender_ready,
        MAX(IF(status IN ('PENDING','PROCESSING','RETRYABLE'), TIMESTAMPDIFF(SECOND,queued_at,NOW(3)),NULL)) AS oldest_pending_age_seconds,
        MIN(IF(status IN ('PENDING','RETRYABLE'),available_at,NULL)) AS next_available_at,
        MAX(IF(status IN ('FAILED','QUARANTINED'),updated_at,NULL)) AS last_terminal_at
        FROM autobiographical_memory_formation_queue")->fetch(PDO::FETCH_ASSOC);
    foreach (['pending','processing','retryable','failed','quarantined','sender_ready'] as $key) $row[$key] = (int)$row[$key];
    $row['oldest_pending_age_seconds'] = $row['oldest_pending_age_seconds'] === null ? null : max(0, (int)$row['oldest_pending_age_seconds']);
    $row['sender_sources'] = [];
    foreach (['POSTCARD','CY_REPLY'] as $type) {
        $row['sender_sources'][$type] = array_fill_keys(['pending','processing','retryable','failed','processed','quarantined','linked','unlinked'], 0);
    }
    $sources = $db->query("SELECT source_type, status, subject_visitor_id IS NOT NULL AS linked, COUNT(*) AS count
        FROM autobiographical_memory_formation_queue WHERE source_type IN ('POSTCARD','CY_REPLY')
        GROUP BY source_type, status, subject_visitor_id IS NOT NULL")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($sources as $source) {
        $counts =& $row['sender_sources'][$source['source_type']];
        $status = strtolower($source['status']);
        if (array_key_exists($status, $counts)) $counts[$status] += (int)$source['count'];
        $counts[(int)$source['linked'] === 1 ? 'linked' : 'unlinked'] += (int)$source['count'];
        unset($counts);
    }
    $sender = $db->query("SELECT
        MAX(IF(status = 'PROCESSED',completed_at,NULL)) AS last_sender_success_at,
        MIN(IF(status = 'RETRYABLE',available_at,NULL)) AS next_sender_retry_at,
        MAX(IF(status IN ('PENDING','PROCESSING','RETRYABLE'),TIMESTAMPDIFF(SECOND,queued_at,NOW(3)),NULL)) AS oldest_sender_pending_age_seconds
        FROM autobiographical_memory_formation_queue WHERE source_type IN ('POSTCARD','CY_REPLY')")->fetch(PDO::FETCH_ASSOC);
    $sender['oldest_sender_pending_age_seconds'] = $sender['oldest_sender_pending_age_seconds'] === null
        ? null : max(0, (int)$sender['oldest_sender_pending_age_seconds']);
    $row += $sender;
    $failure = $db->query("SELECT result_category AS category, completed_at AS at
        FROM autobiographical_memory_formation_attempts WHERE source_type IN ('POSTCARD','CY_REPLY')
          AND result_category IN ('INVALID','ERROR','TIMEOUT','CONFLICT')
        UNION ALL SELECT last_result_category AS category, updated_at AS at
        FROM autobiographical_memory_formation_queue WHERE source_type IN ('POSTCARD','CY_REPLY')
          AND last_result_category IN ('INVALID','ERROR','TIMEOUT','CONFLICT')
        ORDER BY at DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
    $row['last_sender_failure'] = $failure ?: null;
    $row['failure_limit'] = CY_MEMORY_FORMATION_FAILURE_LIMIT;
    return $row;
}

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

function captive_memory_prepare_formation_queue(PDO $db, bool $genericOnly = false): void
{
    // Old generic environment copies of correspondence lack a sender scope.
    // Retain their bytes/provenance, but never let them form public memories.
    $db->exec("UPDATE autobiographical_memory_formation_queue q
            JOIN environment_events e ON e.event_id = q.source_id
            SET q.status = 'QUARANTINED', q.claim_token = NULL,
                q.last_result_category = 'UNLINKED_CORRESPONDENCE',
                q.last_error = 'correspondence source has no canonical sender binding', q.updated_at = NOW(3)
            WHERE q.source_type = 'ENVIRONMENT_EVENT' AND q.subject_visitor_id IS NULL
              AND q.status IN ('PENDING','RETRYABLE')
              AND e.event_type IN ('postcard','postcard_reply','postcard_with_image')");
    $db->exec(
            "UPDATE autobiographical_memory_formation_queue
             SET status = 'RETRYABLE',
                 available_at = DATE_ADD(NOW(3), INTERVAL LEAST(900, 30 * POW(2, LEAST(failure_streak, 5))) SECOND),
                 failure_streak = LEAST(6, failure_streak + 1), claim_token = NULL,
                 last_result_category = 'TIMEOUT',
                 last_error = 'recovered after interrupted processing', updated_at = NOW(3)
             WHERE status = 'PROCESSING' AND started_at < DATE_SUB(NOW(3), INTERVAL 10 MINUTE)"
            . ($genericOnly ? " AND source_type IN ('ENVIRONMENT_EVENT','DREAM_EXPRESSION','CY_EXPRESSION')" : '')
    );
    if ($genericOnly) {
        // Bounded retention: a generic candidate not admitted within the window
        // is never examined under recent-first selection. Age such stragglers to
        // a terminal EXPIRED state so the claimable queue cannot grow without
        // bound. Database time drives the window (no runner-clock skew); the
        // actual transition lives in captive_memory_expire_stale_generic_sources.
        $t = $db->query('SELECT NOW(3) AS now, DATE_SUB(NOW(3), INTERVAL '
            . CY_MEMORY_GENERIC_RETENTION_DAYS . ' DAY) AS cutoff')->fetch(PDO::FETCH_ASSOC);
        if ($t) {
            captive_memory_expire_stale_generic_sources($db, (string)$t['now'], (string)$t['cutoff']);
        }
    }
}

// Age generic formation candidates that were never admitted within the
// retention window to a terminal EXPIRED state. The row and its provenance are
// retained (world history is untouched, stored separately); sender-scoped rows
// are never affected. Rate-limited per sweep via the batch so the sweep is
// always a gradual, uniform age-out rather than a bulk purge. now/cutoff are
// supplied by the caller from authoritative database time; the portable
// derived-table batch keeps the statement valid on MariaDB and under test.
function captive_memory_expire_stale_generic_sources(
    PDO $db, string $now, string $cutoff, int $batch = CY_MEMORY_GENERIC_EXPIRY_BATCH
): int {
    $batch = max(1, $batch);
    $stmt = $db->prepare(
        "UPDATE autobiographical_memory_formation_queue
         SET status = 'EXPIRED', claim_token = NULL,
             last_result_category = 'EXPIRED_UNREACHED',
             last_error = 'generic candidate aged out unprocessed past retention window',
             updated_at = :now
         WHERE id IN (
           SELECT id FROM (
             SELECT id FROM autobiographical_memory_formation_queue
             WHERE status IN ('PENDING','RETRYABLE')
               AND source_type IN ('ENVIRONMENT_EVENT','DREAM_EXPRESSION','CY_EXPRESSION')
               AND subject_visitor_id IS NULL
               AND queued_at < :cutoff
             ORDER BY queued_at ASC
             LIMIT $batch
           ) AS due
         )"
    );
    $stmt->execute([':now' => $now, ':cutoff' => $cutoff]);
    return $stmt->rowCount();
}

// Internal selector: callers own the transaction and the generic admission lock.
// The HTTP claim filter cannot supply this class or opt out of admission.
function captive_memory_claim_source_in_transaction(PDO $db, array $filter, mixed $genericSourceType = null): ?array
{
    if ($genericSourceType !== null) {
        $genericSourceType = captive_memory_generic_source_type($genericSourceType);
        if ($filter['sender_only'] || $filter['visitor_id'] !== null) {
            throw new InvalidArgumentException('generic formation cannot use sender claim filters');
        }
    }
    $where = $filter['sender_only'] ? " AND source_type IN ('POSTCARD','CY_REPLY') AND subject_visitor_id IS NOT NULL" : '';
    $params = [$filter['min_age_seconds']];
    if ($filter['visitor_id'] !== null) {
        $where .= ' AND subject_visitor_id = ?';
        $params[] = $filter['visitor_id'];
    }
    $order = 'priority DESC, queued_at ASC, id ASC';
    if ($genericSourceType !== null) {
        $where .= " AND source_type = ? AND subject_visitor_id IS NULL AND privacy_scope <> 'SENDER_RECALLABLE'";
        $params[] = $genericSourceType;
        $order = '(attempts = 0 AND queued_at >= DATE_SUB(NOW(3), INTERVAL 24 HOUR)) DESC, queued_at ASC, id ASC';
    }
    $select = $db->prepare(
            "SELECT * FROM autobiographical_memory_formation_queue
             WHERE status IN ('PENDING', 'RETRYABLE') AND available_at <= NOW(3)
               AND queued_at <= DATE_SUB(NOW(3), INTERVAL ? SECOND)" . $where . "
             ORDER BY " . $order . ' LIMIT 1 FOR UPDATE'
    );
    $select->execute($params);
    $row = $select->fetch();
    if (!$row) return null;
    // Old clients keep their ordinary priority ordering, but a generic row
    // can only be claimed after the outer caller enters durable admission.
    if ($genericSourceType === null && in_array($row['source_type'], CY_MEMORY_GENERIC_SOURCE_TYPES, true)) return null;
    $stmt = $db->prepare(
            "UPDATE autobiographical_memory_formation_queue
             SET status = 'PROCESSING', attempts = attempts + 1,
                 claim_token = ?, started_at = NOW(3), updated_at = NOW(3) WHERE id = ?"
    );
    $token = bin2hex(random_bytes(16));
    $stmt->execute([$token, (int)$row['id']]);
    $row['source'] = json_decode((string)$row['source_payload'], true) ?: [];
    $row['attempts'] = (int)$row['attempts'] + 1;
    $row['claim_token'] = $token;
    return $row;
}

function captive_memory_claim_source(PDO $db, array $filter = []): ?array
{
    $filter = captive_memory_formation_filter($filter);
    $db->beginTransaction();
    try {
        captive_memory_prepare_formation_queue($db);
        $row = captive_memory_claim_source_in_transaction($db, $filter);
        $db->commit();
        if ($row === null && !$filter['sender_only'] && $filter['visitor_id'] === null) {
            return captive_memory_claim_generic_source($db, $filter['min_age_seconds'])['job'];
        }
        return $row;
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

function captive_memory_generic_admission(string $reason, int $waitMs, ?array $job = null): array
{
    return ['job' => $job, 'admission' => [
        'reason' => $reason,
        'wait_ms' => max(0, min(CY_MEMORY_GENERIC_CADENCE_MS, $waitMs)),
    ]];
}

function captive_memory_claim_generic_source(PDO $db, int $minAgeSeconds = 0): array
{
    $filter = captive_memory_formation_filter(['min_age_seconds' => $minAgeSeconds]);
    $lockName = null;
    $locked = false;
    try {
        // No host-global lock: independent CY databases do not block each other.
        $database = $db->query('SELECT DATABASE()')->fetchColumn();
        if (!is_string($database) || $database === '' || $db->inTransaction()) {
            return captive_memory_generic_admission('UNAVAILABLE', 30000);
        }
        $lockName = 'cy_generic_memory:' . substr(hash('sha256', $database), 0, 40);
        $lock = $db->prepare('SELECT GET_LOCK(?, 0)');
        $lock->execute([$lockName]);
        $acquired = $lock->fetchColumn();
        if ((string)$acquired !== '1') {
            return captive_memory_generic_admission((string)$acquired === '0' ? 'BUSY' : 'UNAVAILABLE', 30000);
        }
        $locked = true;
        $db->beginTransaction();
        captive_memory_prepare_formation_queue($db, true);
        $senderReady = $db->query("SELECT COUNT(*) FROM autobiographical_memory_formation_queue
            WHERE source_type IN ('POSTCARD','CY_REPLY') AND subject_visitor_id IS NOT NULL
              AND (status = 'PROCESSING' OR (status IN ('PENDING','RETRYABLE')
                  AND available_at <= NOW(3) AND queued_at <= DATE_SUB(NOW(3), INTERVAL 120 SECOND)))")->fetchColumn();
        if ($senderReady === false) throw new RuntimeException('generic sender admission unavailable');
        if ((int)$senderReady > 0) {
            $result = captive_memory_generic_admission('SENDER_PRIORITY', 30000);
        } else {
            // All claims count, including failures, preemptions and terminal rows.
            // Use database time so a restarted or skewed runner cannot reset it.
            $wait = $db->query("SELECT COALESCE(LEAST(1800000, GREATEST(0,
                    1800000 - FLOOR(TIMESTAMPDIFF(MICROSECOND, MAX(started_at), NOW(3)) / 1000))), 0)
                FROM autobiographical_memory_formation_queue
                WHERE source_type IN ('ENVIRONMENT_EVENT','DREAM_EXPRESSION','CY_EXPRESSION')")->fetchColumn();
            if ($wait === false || !is_numeric($wait)) throw new RuntimeException('generic cadence unavailable');
            if ((int)$wait > 0) {
                $result = captive_memory_generic_admission('CADENCE', (int)$wait);
            } else {
                $types = $db->prepare("SELECT source_type FROM autobiographical_memory_formation_queue
                    WHERE source_type IN ('ENVIRONMENT_EVENT','DREAM_EXPRESSION','CY_EXPRESSION')
                    GROUP BY source_type
                    HAVING SUM(status IN ('PENDING','RETRYABLE') AND available_at <= NOW(3)
                        AND queued_at <= DATE_SUB(NOW(3), INTERVAL ? SECOND) AND subject_visitor_id IS NULL
                        AND privacy_scope <> 'SENDER_RECALLABLE') > 0
                    ORDER BY MAX(started_at) ASC,
                        FIELD(source_type,'ENVIRONMENT_EVENT','DREAM_EXPRESSION','CY_EXPRESSION') ASC LIMIT 1");
                $types->execute([$filter['min_age_seconds']]);
                $type = $types->fetchColumn();
                $job = $type === false ? null : captive_memory_claim_source_in_transaction(
                    $db, $filter, captive_memory_generic_source_type($type)
                );
                $result = captive_memory_generic_admission($job ? 'ADMITTED' : 'EMPTY', $job ? CY_MEMORY_GENERIC_CADENCE_MS : 30000, $job);
                if ($job) {
                    $age = $db->prepare('SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, queued_at, NOW(3)))
                        FROM autobiographical_memory_formation_queue WHERE id = ?');
                    $age->execute([(int)$job['id']]);
                    $result['admission']['source_type'] = $job['source_type'];
                    $result['admission']['queue_age_seconds'] = (int)$age->fetchColumn();
                    $result['depth'] = captive_memory_queue_depth($db);
                }
            }
        }
        $db->commit();
        return $result;
    } catch (Throwable $e) {
        // No fallback claimant when durable admission cannot be established.
        return captive_memory_generic_admission('UNAVAILABLE', 30000);
    } finally {
        if ($locked) {
            try {
                if ($db->inTransaction()) $db->rollBack();
            } finally {
                $release = $db->prepare('SELECT RELEASE_LOCK(?)');
                $release->execute([$lockName]);
            }
        }
    }
}

function captive_memory_sender_scope_key(?string $visitorId): string
{
    return $visitorId ?? '';
}

function captive_memory_finish_source(PDO $db, array $input, bool $atomic = true): array
{
    $id = (int)($input['job_id'] ?? 0);
    $token = $input['claim_token'] ?? null;
    $category = strtoupper((string)($input['result_category'] ?? 'ERROR'));
    $rejectionCode = captive_memory_formation_rejection_code($input['rejection_code'] ?? null);
    $categories = ['CREATE','UPDATE','RESOLVE','NOTHING','INVALID','ERROR','TIMEOUT','PREEMPTED','CONFLICT'];
    if ($id < 1 || !in_array($category, $categories, true)
        || ($atomic && (!is_string($token) || !preg_match('/^[a-f0-9]{32}$/', $token)))) {
        throw new InvalidArgumentException('invalid formation completion');
    }
    $operations = $input['operations'] ?? [];
    if (!is_array($operations) || count($operations) > 8) throw new InvalidArgumentException('invalid formation operations');
    $finished = in_array($category, ['CREATE','UPDATE','RESOLVE','NOTHING'], true);
    if ((!$finished || $category === 'NOTHING') && $operations) throw new InvalidArgumentException('unexpected formation operations');
    if ($atomic && $finished && $category !== 'NOTHING' && !$operations) throw new InvalidArgumentException('formation operations required');
    $db->beginTransaction();
    try {
        $read = $db->prepare('SELECT * FROM autobiographical_memory_formation_queue WHERE id = ? FOR UPDATE');
        $read->execute([$id]);
        $job = $read->fetch(PDO::FETCH_ASSOC);
        if (!$job) throw new InvalidArgumentException('formation job not found');
        $token = $token ?? $job['claim_token']; // Compatibility for the old completion-only client during deployment.
        if (!$atomic && !$token && $job['status'] === 'PROCESSING') {
            // A claim already running when 027 was applied has no token yet.
            $token = bin2hex(random_bytes(16));
            $job['claim_token'] = $token;
            $db->prepare('UPDATE autobiographical_memory_formation_queue SET claim_token = ? WHERE id = ?')->execute([$token, $id]);
        }
        if ($token) {
            $receipt = $db->prepare('SELECT result_payload FROM autobiographical_memory_formation_attempts WHERE queue_id = ? AND claim_token = ?');
            $receipt->execute([$id, $token]);
            $saved = $receipt->fetchColumn();
            if ($saved !== false && $saved !== null) {
                $result = json_decode($saved, true, 32, JSON_THROW_ON_ERROR);
                $db->commit();
                return array_replace($result, ['duplicate' => true]);
            }
        }
        if ($job['status'] !== 'PROCESSING' || !$token || !hash_equals((string)$job['claim_token'], (string)$token)) {
            throw new RuntimeException('formation claim conflict');
        }
        $inferenceRequest = $input['formation_request_id'] ?? null;
        if ($inferenceRequest !== null) {
            require_once __DIR__ . '/memory_formation_inference.php';
            if (!is_string($inferenceRequest)) throw new InvalidArgumentException('invalid formation request');
            captive_memory_inference_completion_lock($db, $job, $token, $inferenceRequest, $category);
        }
        $source = captive_memory_validate_source(json_decode($job['source_payload'], true, 32, JSON_THROW_ON_ERROR));
        $senderSource = in_array($job['source_type'], ['POSTCARD','CY_REPLY'], true);
        $results = [];
        foreach ($operations as $operation) {
            if (!is_array($operation)) throw new InvalidArgumentException('invalid formation operation');
            $op = captive_memory_validate_operation($operation);
            $expectedDecision = $category === 'RESOLVE' ? 'ARCHIVE' : $category;
            if ($op['decision'] !== $expectedDecision) throw new InvalidArgumentException('formation decision does not match result');
            $supplied = $op['source'] ?? [];
            if (($supplied['sourceType'] ?? null) !== $source['sourceType']
                || ($supplied['sourceId'] ?? null) !== $source['sourceId']
                || ($supplied['subjectVisitorId'] ?? null) !== $source['subjectVisitorId']
                || ($supplied['sourceVisibility'] ?? null) !== $source['sourceVisibility']) {
                throw new InvalidArgumentException('formation source mismatch');
            }
            if ($senderSource && (!$source['subjectVisitorId'] || $source['sourceVisibility'] !== 'SENDER_RECALLABLE')) {
                throw new InvalidArgumentException('correspondence requires canonical sender privacy');
            }
            if ($op['decision'] === 'CREATE') {
                if ($senderSource && ($op['privacyScope'] !== 'SENDER_RECALLABLE' || !empty($op['publicSummary']))) {
                    throw new InvalidArgumentException('correspondence memory must remain sender recallable');
                }
            } else {
                $existing = $db->prepare('SELECT * FROM autobiographical_memories WHERE id = ? FOR UPDATE');
                $existing->execute([$op['memoryId']]);
                $memory = $existing->fetch(PDO::FETCH_ASSOC);
                if (!$memory || $memory['status'] !== 'ACTIVE'
                    || ($memory['subject_visitor_id'] ?? null) !== $source['subjectVisitorId']
                    || ($senderSource && $memory['privacy_scope'] !== 'SENDER_RECALLABLE')) {
                    throw new InvalidArgumentException('formation target is not eligible for source sender');
                }
                if ($senderSource && !empty($op['publicSummary'])) throw new InvalidArgumentException('private correspondence has no public summary');
                if ((int)($op['expectedVersion'] ?? 0) !== (int)$memory['version']) throw new RuntimeException('memory version conflict');
                if ($op['decision'] === 'ARCHIVE' && $memory['memory_type'] !== 'UNRESOLVED_THREAD') {
                    throw new InvalidArgumentException('resolution requires unresolved thread');
                }
            }
            $op['source'] = $source;
            $results[] = captive_memory_apply($db, $op);
            // Same transaction and claim receipt as the mutation, including the
            // private activity row; a lost acknowledgement cannot duplicate it.
            $current = $db->prepare('SELECT privacy_scope, public_summary FROM autobiographical_memories WHERE id = ?');
            $current->execute([$op['memoryId']]);
            $memory = $current->fetch(PDO::FETCH_ASSOC);
            $db->prepare('INSERT INTO autobiographical_memory_activity
                (memory_id, activity_type, public_text, reason_codes, privacy_scope, created_at)
                VALUES (?, ?, ?, ?, ?, NOW(3))')->execute([
                    $op['memoryId'], $op['decision'] === 'CREATE' ? 'MEMORY_FORMED' : 'MEMORY_CHANGED',
                    $memory['privacy_scope'] === 'PUBLIC_RECALLABLE' ? $memory['public_summary'] : null,
                    '[]', $memory['privacy_scope'],
                ]);
        }
        $retry = $finished ? ['status' => 'PROCESSED', 'failure_streak' => 0, 'model_invalid_streak' => 0, 'delay_seconds' => 0]
            : captive_memory_formation_retry((int)$job['failure_streak'], $category, (int)$job['model_invalid_streak']);
        $error = isset($input['error']) ? mb_substr((string)$input['error'], 0, 1000) : null;
        $db->prepare("UPDATE autobiographical_memory_formation_queue
            SET status = ?, failure_streak = ?, model_invalid_streak = ?, last_result_category = ?,
                completed_at = IF(?,NOW(3),completed_at),
                available_at = IF(?,available_at,DATE_ADD(NOW(3),INTERVAL ? SECOND)),
                last_error = ?, updated_at = NOW(3) WHERE id = ?")
            ->execute([$retry['status'], $retry['failure_streak'], $retry['model_invalid_streak'], $category, $finished ? 1 : 0,
                $finished ? 1 : 0, $retry['delay_seconds'], $error, $id]);
        $depth = captive_memory_queue_depth($db);
        $result = ['ok' => true, 'status' => $retry['status'], 'result_category' => $category, 'depth' => $depth,
            'failure_streak' => $retry['failure_streak'], 'retry_delay_seconds' => $retry['delay_seconds'],
            'model_invalid_streak' => $retry['model_invalid_streak'], 'rejection_code' => $rejectionCode,
            'results' => $results, 'duplicate' => false];
        if ($inferenceRequest !== null) {
            captive_memory_inference_complete($db, $inferenceRequest, $category, $rejectionCode, $retry['status']);
            $result['formation_request_id'] = $inferenceRequest;
        }
        $db->prepare('INSERT INTO autobiographical_memory_formation_attempts
            (queue_id, claim_token, result_payload, source_type, source_id, started_at, completed_at,
             provider, model, prompt_chars, latency_ms, result_category, resulting_memory_id,
             queue_depth_before, queue_depth_after, error_text, created_at)
            VALUES (?, ?, ?, ?, ?, COALESCE(?,NOW(3)), NOW(3), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))')
            ->execute([$id, $token, json_encode($result, JSON_THROW_ON_ERROR), $job['source_type'], $job['source_id'],
                $job['started_at'], mb_substr((string)($input['provider'] ?? ''),0,32) ?: null,
                mb_substr((string)($input['model'] ?? ''),0,160) ?: null,
                max(0,(int)($input['prompt_chars'] ?? 0)), max(0,(int)($input['latency_ms'] ?? 0)),
                $category, $results[0]['memory_id'] ?? $input['memory_id'] ?? null,
                max(0,(int)($input['queue_depth_before'] ?? 0)), $depth, $error]);
        $db->commit();
        return $result;
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
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
//
// $recentExpressionTerms is PROVENANCE ONLY: a set of tokens from Cy's own
// recent-expression buffer, supplied by the caller for cross-referencing
// against whatever terms/tags actually caused a match. It never widens or
// narrows which rows match, never changes $_rank/ordering, and never changes
// $limit. It only lets each row additionally record whether the match it
// already made also happens to overlap with something Cy recently said.
function captive_memory_rank_candidates(
    array $rows,
    array $query,
    ?string $visitorId,
    int $limit = CY_MEMORY_CANDIDATE_LIMIT,
    array $recentExpressionTerms = []
): array
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

        // Provenance: which specific tokens caused this match, and did any of
        // them independently also appear in Cy's own recent-expression buffer.
        // This is read-only cross-referencing against already-computed matches
        // and never influences whether/how the row is ranked or included.
        $matchedLexical = array_values(array_unique(array_merge($tagMatches, $termMatches)));
        $expressionOverlap = array_values(array_intersect($matchedLexical, $recentExpressionTerms));
        $row['matched_tags'] = $tagMatches;
        $row['matched_terms'] = $termMatches;
        $row['match_provenance'] = [
            'lexical_match' => $tagMatches !== [] || $termMatches !== [],
            'structured_sender_identity' => $samePerson,
            'recent_cy_expression_overlap' => $expressionOverlap !== [],
            'recent_cy_expression_overlap_terms' => $expressionOverlap,
        ];
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
    return captive_memory_rows_by_ids($db, $ids);
}

function captive_memory_rows_by_ids(PDO $db, array $ids): array
{
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

function captive_memory_query(
    PDO $db,
    array $query,
    ?string $visitorId,
    int $limit = CY_MEMORY_CANDIDATE_LIMIT,
    array $recentExpressionTerms = []
): array
{
    $rows = captive_memory_fetch_rows($db, $query, $visitorId);
    $ranked = captive_memory_rank_candidates($rows, $query, $visitorId, $limit, $recentExpressionTerms);
    return captive_memory_candidate_items($ranked, $visitorId);
}

function captive_memory_sender_continuity(PDO $db, array $query, string $visitorId): array
{
    if (!preg_match('/^[a-f0-9]{32}$/', $visitorId)) {
        throw new InvalidArgumentException('valid sender visitor id required');
    }
    $candidates = [];
    $terms = captive_memory_tokens((string)($query['text'] ?? ''));
    $tags = captive_memory_tags($query['tags'] ?? []);
    $location = mb_substr(trim((string)($query['location'] ?? '')), 0, 64);
    if ($location !== '' && !in_array($location, $tags, true)) {
        $tags[] = $location;
    }
    foreach (['PERSON', 'UNRESOLVED_THREAD'] as $type) {
        // Indexed same-sender/type discovery happens before the bounded pool.
        // New episodic exchanges cannot displace an old retained person/topic.
        $stmt = $db->prepare(
            "SELECT id FROM autobiographical_memories
             WHERE subject_visitor_id = ? AND status = 'ACTIVE' AND memory_type = ?
               AND privacy_scope IN ('INTERNAL_ONLY', 'SENDER_RECALLABLE', 'PUBLIC_RECALLABLE')
             ORDER BY updated_at DESC, id ASC LIMIT 100"
        );
        $stmt->execute([$visitorId, $type]);
        $ids = array_column($stmt->fetchAll(), 'id');
        // Independent indexed relevance paths keep older facts reachable even
        // after more than 100 newer memories of the same type have accumulated.
        if ($terms) {
            $booleanQuery = implode(' ', array_map(static fn(string $term): string => $term . '*', $terms));
            $stmt = $db->prepare(
                "SELECT id, MATCH(content, public_summary) AGAINST (? IN BOOLEAN MODE) AS fts_rank
                 FROM autobiographical_memories
                 WHERE subject_visitor_id = ? AND status = 'ACTIVE' AND memory_type = ?
                   AND privacy_scope IN ('INTERNAL_ONLY', 'SENDER_RECALLABLE', 'PUBLIC_RECALLABLE')
                 HAVING fts_rank > 0
                 ORDER BY fts_rank DESC, updated_at DESC, id ASC LIMIT 100"
            );
            $stmt->execute([$booleanQuery, $visitorId, $type]);
            $ids = array_merge($ids, array_column($stmt->fetchAll(), 'id'));
        }
        if ($tags) {
            $placeholders = implode(',', array_fill(0, count($tags), '?'));
            $stmt = $db->prepare(
                "SELECT m.id FROM autobiographical_memories m
                 JOIN autobiographical_memory_tags t ON t.memory_id = m.id
                 WHERE m.subject_visitor_id = ? AND m.status = 'ACTIVE' AND m.memory_type = ?
                   AND m.privacy_scope IN ('INTERNAL_ONLY', 'SENDER_RECALLABLE', 'PUBLIC_RECALLABLE')
                   AND t.tag IN ($placeholders)
                 GROUP BY m.id
                 ORDER BY COUNT(DISTINCT t.tag) DESC, m.updated_at DESC, m.id ASC LIMIT 100"
            );
            $stmt->execute(array_merge([$visitorId, $type], $tags));
            $ids = array_merge($ids, array_column($stmt->fetchAll(), 'id'));
        }
        $ids = array_values(array_unique($ids));
        $rows = captive_memory_rows_by_ids($db, $ids);
        $ranked = captive_memory_rank_candidates($rows, $query, $visitorId, 2);
        array_push($candidates, ...captive_memory_candidate_items($ranked, $visitorId));
    }
    return $candidates;
}

function captive_memory_candidate_items(array $ranked, ?string $visitorId): array
{
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
            // Retrieval-cue provenance (instrumentation only; never sent to the
            // model - see filterMemoriesBeforePrompt in autobiographical-memory.js
            // which whitelists fields and does not forward these).
            'matchedTags' => $row['matched_tags'] ?? [],
            'matchedTerms' => $row['matched_terms'] ?? [],
            'matchProvenance' => $row['match_provenance'] ?? [
                'lexical_match' => false, 'structured_sender_identity' => false,
                'recent_cy_expression_overlap' => false, 'recent_cy_expression_overlap_terms' => [],
            ],
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
    $tags = captive_memory_tags($tags);
    // Tag replacement is wholesale. An empty set would DELETE every existing
    // tag, so an UPDATE that volunteered no tags silently erased curated or
    // derived tags (this is what wiped the 8-by-4 motif). Treat an empty set as
    // "no change" and preserve existing tags. CREATE has no prior tags, so this
    // is a harmless no-op there. Privacy DELETE clears tags via its own direct
    // DELETE (see captive_memory_apply) and is unaffected. A non-empty set still
    // replaces wholesale, so ordinary retag/refresh semantics are unchanged.
    if ($tags === []) {
        return;
    }
    $db->prepare('DELETE FROM autobiographical_memory_tags WHERE memory_id = ?')->execute([$memoryId]);
    $insert = $db->prepare('INSERT INTO autobiographical_memory_tags (memory_id, tag) VALUES (?, ?)');
    foreach ($tags as $tag) {
        $insert->execute([$memoryId, $tag]);
    }
}

function captive_memory_apply(PDO $db, array $rawOperation): array
{
    $op = captive_memory_validate_operation($rawOperation);
    $decision = strtoupper((string)$op['decision']);
    $id = (string)$op['memoryId'];
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) $db->beginTransaction();
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
        } elseif ($decision === 'ARCHIVE' && isset($op['source'])) {
            captive_memory_add_source($db, $id, $op['source']);
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
        if ($ownsTransaction) $db->commit();
        return ['memory_id' => $id, 'version' => $version, 'operation' => $decision];
    } catch (Throwable $e) {
        if ($ownsTransaction && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}
