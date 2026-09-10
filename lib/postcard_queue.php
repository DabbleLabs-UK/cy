<?php
declare(strict_types=1);

// The reply tray is deliberately small. Once it is full, intake remains open but
// new items become durable fan mail: visible in the public archive, with no false
// promise of an immediate personal reply.
const CY_REPLY_TRAY_CAPACITY = 8;
const CY_FAN_PROMOTE_EVERY_REPLIES = 5;
// A single empty or failed model call is transient, not evidence that the reply
// tray is full. Give a claimed postcard three total attempts before retaining it
// as final fan mail, with a short pause between attempts to avoid a hot loop when
// the model service is temporarily unavailable.
const CY_REPLY_MAX_ATTEMPTS = 3;
const CY_REPLY_RETRY_DELAY_SECONDS = 10;
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

/**
 * A runner has one reply generation lane. Do not hand it another postcard while
 * a previously claimed reply remains in progress.
 */
function captive_postcard_inflight_replies(PDO $db): int
{
    return (int)$db->query(
        "SELECT COUNT(*) FROM postcards
         WHERE mail_class = 'reply' AND replied_at IS NULL AND blocked = 0
           AND delivered_at IS NOT NULL
           AND delivered_at >= DATE_SUB(NOW(), INTERVAL " . CY_REPLY_CLAIM_TTL_SECONDS . " SECOND)"
    )->fetchColumn();
}

/**
 * A reply claim which never completed is retained, but it is not attempted or
 * presented as a fresh arrival again. fan_final is the existing terminal class
 * for mail that reached the reply path without producing a usable reply.
 */
function captive_postcard_expire_stale_claims(PDO $db): int
{
    $claimTtl = max(60, CY_REPLY_CLAIM_TTL_SECONDS);
    return (int)$db->exec(
        "UPDATE postcards
         SET mail_class = 'fan_final'
         WHERE mail_class = 'reply' AND replied_at IS NULL AND blocked = 0
           AND delivered_at IS NOT NULL
           AND delivered_at < DATE_SUB(NOW(), INTERVAL {$claimTtl} SECOND)"
    );
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
function captive_postcard_mark_replied(PDO $db, int $postcardId, string $at): void
{
    if ($postcardId <= 0) {
        return;
    }
    $queue = captive_postcard_queue_lock($db);
    $update = $db->prepare(
        'UPDATE postcards SET replied_at = :at
         WHERE id = :id AND replied_at IS NULL'
    );
    $update->execute([':at' => $at, ':id' => $postcardId]);
    if ($update->rowCount() !== 1) {
        return;
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
}
