<?php
declare(strict_types=1);

// The reply tray is deliberately small. Once it is full, intake remains open but
// new items become durable fan mail: visible in the public archive, with no false
// promise of an immediate personal reply.
const CY_REPLY_TRAY_CAPACITY = 8;
const CY_FAN_PROMOTE_EVERY_REPLIES = 5;
// Only definitive completed quality failures consume the terminal allowance.
// Interruptions and infrastructure holds use a separate bounded retry backoff.
const CY_REPLY_MAX_ATTEMPTS = 3;
const CY_REPLY_RETRY_DELAY_SECONDS = 10;
const CY_REPLY_TEMPORARY_RETRY_SECONDS = 30;
const CY_REPLY_MAX_RETRY_SECONDS = 900;
// A claimed reply normally completes in a few minutes. If a runner disappears
// after claiming one, do not let that abandoned claim occupy the bounded tray
// forever. The postcard itself remains retained in the database and timeline.
const CY_REPLY_CLAIM_TTL_SECONDS = 1800;

function captive_postcard_disposition(int $activeReplies, int $capacity = CY_REPLY_TRAY_CAPACITY): string
{
    return $activeReplies < max(1, $capacity) ? 'reply_queue' : 'fan_mail';
}

function captive_postcard_fan_mail_supported(array $query): bool
{
    return isset($query['fan_mail']) && (string)$query['fan_mail'] === '1';
}

function captive_postcard_can_claim_next(int $inFlightReplies): bool
{
    return $inFlightReplies <= 0;
}

/** @return array{attempts:int,retry:bool,mail_class:string,retry_after_seconds:int} */
function captive_postcard_failed_attempt(int $completedAttempts, int $maxAttempts = CY_REPLY_MAX_ATTEMPTS): array
{
    $attempts = max(0, $completedAttempts) + 1;
    $retry = $attempts < max(1, $maxAttempts);
    return [
        'attempts' => $attempts,
        'retry' => $retry,
        'mail_class' => $retry ? 'reply' : 'fan_final',
        'retry_after_seconds' => $retry ? CY_REPLY_RETRY_DELAY_SECONDS : 0,
    ];
}

// A retry is the same physical postcard returning to the model lane. Its first
// arrival is already in the public chronology, so later attempts must not create
// duplicate postcard cards or imply that the visitor posted it again.
function captive_postcard_should_publish_arrival(int $completedAttempts): bool
{
    return $completedAttempts <= 0;
}

function captive_postcard_retry_delay(int $temporaryFailures): int
{
    return min(CY_REPLY_MAX_RETRY_SECONDS, CY_REPLY_TEMPORARY_RETRY_SECONDS * (2 ** min(5, max(0, $temporaryFailures - 1))));
}

function captive_postcard_claim_matches(array $postcard, mixed $generation): bool
{
    // Missing generations are tolerated only for the pre-migration generation.
    return ($generation === null && (int)$postcard['claim_generation'] === 0)
        || (is_int($generation) && $generation >= 0 && $generation === (int)$postcard['claim_generation']);
}

// This inspection runs with the queue and postcard locked. Unknown paid work,
// unsettled work, and generated output awaiting durable publication cannot be
// converted into another provider call merely by expiring/releasing a claim.
function captive_postcard_retry_blocker(PDO $db, int $id): ?string
{
    $read = $db->prepare('SELECT status, publication_result FROM postcard_inference_turns WHERE postcard_id = ?');
    $read->execute([$id]);
    $turn = $read->fetch(PDO::FETCH_ASSOC);
    if ($turn && ($turn['publication_result'] === 'published' || $turn['status'] === 'generated')) return 'publication_pending';
    $read = $db->prepare("SELECT provider, status, settled_at, validation_failure, safe_retry FROM postcard_inference_attempts WHERE postcard_id = ?");
    $read->execute([$id]);
    foreach ($read->fetchAll(PDO::FETCH_ASSOC) as $attempt) {
        if (!$attempt['settled_at']) return 'outcome_unknown';
        if (in_array($attempt['status'], ['success', 'generated'], true) && !$attempt['validation_failure']) return 'publication_pending';
        if ($attempt['provider'] === 'deepseek' && !$attempt['safe_retry'] && !in_array($attempt['status'], ['not_sent', 'refused', 'validation_rejected', 'success', 'generated'], true)) return 'outcome_unknown';
    }
    return null;
}

function captive_postcard_defer(PDO $db, int $id, mixed $generation, string $failureClass): bool
{
    captive_postcard_queue_lock($db);
    $read = $db->prepare("SELECT * FROM postcards WHERE id = ? AND mail_class = 'reply' AND replied_at IS NULL AND blocked = 0 AND delivered_at IS NOT NULL FOR UPDATE");
    $read->execute([$id]);
    $row = $read->fetch(PDO::FETCH_ASSOC);
    if (!$row || !captive_postcard_claim_matches($row, $generation)) return false;
    if (!in_array($failureClass, ['temporary', 'quality', 'ambiguous'], true)) $failureClass = 'temporary';
    $hold = captive_postcard_retry_blocker($db, $id);
    if ($failureClass === 'ambiguous') $hold ??= 'outcome_unknown';
    $quality = (int)$row['quality_failures'] + (int)($failureClass === 'quality' && $hold === null);
    $temporary = (int)$row['temporary_failures'] + (int)($failureClass !== 'quality' || $hold !== null);
    $terminal = $hold === null && $quality >= CY_REPLY_MAX_ATTEMPTS;
    $delay = $terminal ? 0 : ($failureClass === 'quality' && $hold === null ? CY_REPLY_RETRY_DELAY_SECONDS : captive_postcard_retry_delay($temporary));
    $db->prepare('UPDATE postcards SET delivered_at = NULL, deliver_at = DATE_ADD(NOW(), INTERVAL ? SECOND), temporary_failures = ?, quality_failures = ?, retry_hold = ?, mail_class = ? WHERE id = ?')
        ->execute([$delay, $temporary, $quality, $hold, $terminal ? 'fan_final' : 'reply', $id]);
    return true;
}

/**
 * A runner has one reply generation lane. Do not hand it another postcard while
 * a previously claimed reply remains in progress.
 */
function captive_postcard_inflight_replies(PDO $db): int
{
    return (int)$db->query(
        "SELECT COUNT(*) FROM postcards
         WHERE mail_class = 'reply' AND replied_at IS NULL AND blocked = 0
           AND retry_hold IS NULL
           AND delivered_at IS NOT NULL
           AND delivered_at >= DATE_SUB(NOW(), INTERVAL " . CY_REPLY_CLAIM_TTL_SECONDS . " SECOND)"
    )->fetchColumn();
}

/**
 * Claim expiry is a lease failure, never a quality decision. Release safely
 * retryable work; hold uncertain/provider-completed work for late settlement.
 */
function captive_postcard_expire_stale_claims(PDO $db): int
{
    $claimTtl = max(60, CY_REPLY_CLAIM_TTL_SECONDS);
    $rows = $db->query(
        "SELECT id, claim_generation FROM postcards
         WHERE mail_class = 'reply' AND replied_at IS NULL AND blocked = 0
           AND delivered_at IS NOT NULL
           AND delivered_at < DATE_SUB(NOW(), INTERVAL {$claimTtl} SECOND) FOR UPDATE"
    )->fetchAll(PDO::FETCH_ASSOC);
    $count = 0;
    foreach ($rows as $row) {
        $count += (int)captive_postcard_defer($db, (int)$row['id'], (int)$row['claim_generation'], 'temporary');
    }
    return $count;
}

/** @param array{posted_at?:mixed,promoted?:mixed}|null $source */
function captive_postcard_event_provenance(array $payload, ?array $source): array
{
    if ($source === null) {
        return $payload;
    }
    $payload['promoted'] = !empty($source['promoted']);
    if (!empty($source['posted_at'])) {
        $posted = new DateTimeImmutable((string)$source['posted_at'], new DateTimeZone('UTC'));
        $payload['posted_at'] = $posted->format('Y-m-d\TH:i:s\Z');
    }
    return $payload;
}

/** @return array{reply_capacity:int,promote_every:int,completed_since_promotion:int} */
function captive_postcard_queue_lock(PDO $db): array
{
    $row = $db->query(
        'SELECT reply_capacity, promote_every, completed_since_promotion
         FROM postcard_queue_state WHERE id = 1 FOR UPDATE'
    )->fetch();
    if (!$row) {
        throw new RuntimeException('postcard queue state is missing');
    }
    return [
        'reply_capacity' => max(1, (int)$row['reply_capacity']),
        'promote_every' => max(1, (int)$row['promote_every']),
        'completed_since_promotion' => max(0, (int)$row['completed_since_promotion']),
    ];
}

function captive_postcard_active_replies(PDO $db): int
{
    $claimTtl = max(60, CY_REPLY_CLAIM_TTL_SECONDS);
    return (int)$db->query(
        "SELECT COUNT(*) FROM postcards
         WHERE mail_class = 'reply' AND replied_at IS NULL AND blocked = 0
           AND retry_hold IS NULL
           AND (
             delivered_at IS NULL
             OR delivered_at >= DATE_SUB(NOW(), INTERVAL {$claimTtl} SECOND)
           )"
    )->fetchColumn();
}

// Promote only fan mail that has already been archived publicly. Resetting
// delivered_at then lets the normal inbox path hand it to Cy as a reply item.
function captive_postcard_promote_oldest(PDO $db): bool
{
    $changed = $db->exec(
        "UPDATE postcards
         SET mail_class = 'reply', promoted_at = NOW(), delivered_at = NULL
         WHERE mail_class = 'fan' AND delivered_at IS NOT NULL AND blocked = 0
         ORDER BY posted_at ASC, id ASC
         LIMIT 1"
    );
    return (int)$changed === 1;
}

// Called only for the first authoritative reply event for a postcard. Every fifth
// completed reply reserves the newly-freed place for the oldest archived fan item.
function captive_postcard_mark_replied(PDO $db, int $postcardId, string $at, mixed $generation = null): bool
{
    if ($postcardId <= 0) {
        return false;
    }
    $queue = captive_postcard_queue_lock($db);
    $read = $db->prepare('SELECT claim_generation FROM postcards WHERE id = ? FOR UPDATE');
    $read->execute([$postcardId]);
    $row = $read->fetch(PDO::FETCH_ASSOC);
    if (!$row || !captive_postcard_claim_matches($row, $generation)) return false;
    $update = $db->prepare(
        "UPDATE postcards SET replied_at = :at, retry_hold = NULL
         WHERE id = :id AND replied_at IS NULL AND blocked = 0 AND mail_class = 'reply'"
    );
    $update->execute([':at' => $at, ':id' => $postcardId]);
    if ($update->rowCount() !== 1) {
        return false;
    }

    $completed = $queue['completed_since_promotion'] + 1;
    if ($completed >= $queue['promote_every'] && captive_postcard_promote_oldest($db)) {
        $completed = 0;
    }
    $state = $db->prepare(
        'UPDATE postcard_queue_state
         SET completed_since_promotion = :completed, updated_at = NOW()
         WHERE id = 1'
    );
    $state->execute([':completed' => $completed]);
    return true;
}
