<?php
declare(strict_types=1);

// Public postcard archive helpers. This layer reads the existing queue truth;
// it never changes admission, claiming, retry, promotion or moderation state.

const CY_POSTCARD_ARCHIVE_DEFAULT_LIMIT = 20;
const CY_POSTCARD_ARCHIVE_MAX_LIMIT = 40;
const CY_POSTCARD_ARCHIVE_FILTERS = ['all', 'replied', 'waiting', 'fan_mail'];

function captive_postcard_archive_filter(mixed $raw): string
{
    $filter = strtolower(trim((string)($raw ?? 'all')));
    if ($filter === '') {
        $filter = 'all';
    }
    if (!in_array($filter, CY_POSTCARD_ARCHIVE_FILTERS, true)) {
        throw new InvalidArgumentException('invalid archive filter');
    }
    return $filter;
}

function captive_postcard_archive_limit(mixed $raw): int
{
    $limit = filter_var($raw, FILTER_VALIDATE_INT);
    if ($limit === false || $limit < 1) {
        return CY_POSTCARD_ARCHIVE_DEFAULT_LIMIT;
    }
    return min(CY_POSTCARD_ARCHIVE_MAX_LIMIT, $limit);
}

function captive_postcard_archive_cursor(mixed $raw): ?int
{
    if ($raw === null || $raw === '') {
        return null;
    }
    if (!is_scalar($raw) || !preg_match('/^[1-9][0-9]*$/', (string)$raw)) {
        throw new InvalidArgumentException('invalid archive cursor');
    }
    return (int)$raw;
}

function captive_postcard_archive_status(array $row): string
{
    if (!empty($row['blocked'])) {
        return 'not_delivered';
    }
    if (!empty($row['replied_at'])) {
        return 'replied';
    }
    if (in_array((string)($row['mail_class'] ?? ''), ['fan', 'fan_final'], true)) {
        return 'fan_mail';
    }
    return 'waiting';
}

function captive_postcard_archive_status_label(string $status): string
{
    return match ($status) {
        'replied' => 'REPLIED',
        'fan_mail' => 'FAN MAIL',
        'not_delivered' => 'NOT DELIVERED',
        default => 'WAITING FOR CY',
    };
}

function captive_postcard_archive_is_yours(array $row, ?string $visitorId): bool
{
    $rowVisitor = (string)($row['visitor_id'] ?? '');
    return $visitorId !== null && $rowVisitor !== '' && hash_equals($visitorId, $rowVisitor);
}

function captive_postcard_archive_iso(mixed $value): ?string
{
    if ($value === null || trim((string)$value) === '') {
        return null;
    }
    try {
        $date = new DateTimeImmutable((string)$value, new DateTimeZone('UTC'));
        return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    } catch (Throwable) {
        return null;
    }
}

function captive_postcard_archive_image(mixed $path): ?string
{
    $path = trim((string)($path ?? ''));
    if ($path === '') {
        return null;
    }
    // Postcard intake only writes re-encoded WebP files under uploads/YYYY/MM.
    // Keep a corrupt or legacy arbitrary path out of a public image src.
    return preg_match('#^uploads/[0-9]{4}/[0-9]{2}/[a-f0-9]{32}\.webp$#', $path)
        ? $path
        : null;
}

/** @param array{body:mixed,ts:mixed}|null $reply */
function captive_postcard_archive_item(array $row, ?array $reply, ?string $visitorId): array
{
    $status = captive_postcard_archive_status($row);
    $mailClass = (string)($row['mail_class'] ?? 'reply');
    $hasImage = trim((string)($row['image_path'] ?? '')) !== '';

    return [
        'id' => (int)$row['id'],
        'from' => $row['from_name'] !== null && trim((string)$row['from_name']) !== ''
            ? (string)$row['from_name']
            : null,
        'body' => $row['body'] !== null ? (string)$row['body'] : null,
        'received_at' => captive_postcard_archive_iso($row['posted_at'] ?? null),
        'has_image' => $hasImage,
        'image' => captive_postcard_archive_image($row['image_path'] ?? null),
        'image_attrib' => $row['image_attrib'] !== null ? (string)$row['image_attrib'] : null,
        'status' => $status,
        'status_label' => captive_postcard_archive_status_label($status),
        'your_postcard' => captive_postcard_archive_is_yours($row, $visitorId),
        'was_fan_mail' => !empty($row['promoted_at']),
        'fan_mail_may_reply' => $status === 'fan_mail' && $mailClass === 'fan',
        'reply' => $reply === null ? null : [
            'body' => (string)($reply['body'] ?? ''),
            'replied_at' => captive_postcard_archive_iso($reply['ts'] ?? null),
        ],
    ];
}

/** @return array<int,array{body:string,ts:mixed}> */
function captive_postcard_archive_replies(PDO $db, array $postcardIds): array
{
    $ids = array_values(array_filter(array_map('intval', $postcardIds), static fn(int $id): bool => $id > 0));
    if (!$ids) {
        return [];
    }

    $placeholders = [];
    foreach ($ids as $i => $_id) {
        $placeholders[] = ':pc' . $i;
    }
    $postcardExpr = "CAST(COALESCE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.reply_to')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.id')), '')
    ) AS UNSIGNED)";
    $stmt = $db->prepare(
        'SELECT seq, ts, payload, ' . $postcardExpr . ' AS postcard_id
         FROM events
         WHERE kind = \'postcard_out\'
           AND ' . $postcardExpr . ' IN (' . implode(', ', $placeholders) . ')
         ORDER BY seq ASC'
    );
    foreach ($ids as $i => $id) {
        $stmt->bindValue(':pc' . $i, $id, PDO::PARAM_INT);
    }
    $stmt->execute();

    $replies = [];
    foreach ($stmt->fetchAll() as $row) {
        $id = (int)$row['postcard_id'];
        if ($id <= 0 || isset($replies[$id])) {
            continue;
        }
        $payload = json_decode((string)$row['payload'], true);
        if (!is_array($payload)) {
            continue;
        }
        $replies[$id] = [
            'body' => (string)($payload['body'] ?? ''),
            'ts' => $row['ts'],
        ];
    }
    return $replies;
}

/**
 * @return array{items:array<int,array>,next_cursor:?int,has_more:bool}
 */
function captive_postcard_archive_fetch(
    PDO $db,
    string $filter,
    ?int $cursor,
    int $limit,
    ?string $visitorId
): array {
    $conditions = [];
    $params = [];

    // public_at is written only after runner screening produced a public arrival
    // event. The signed sender may also see their own pre-screening or rejected
    // item; no other visitor can see it.
    if ($visitorId === null) {
        $conditions[] = 'p.public_at IS NOT NULL AND p.blocked = 0';
    } else {
        $conditions[] = '((p.public_at IS NOT NULL AND p.blocked = 0) OR p.visitor_id = :visitor_id)';
        $params[':visitor_id'] = [$visitorId, PDO::PARAM_STR];
    }

    if ($filter === 'replied') {
        $conditions[] = 'p.replied_at IS NOT NULL AND p.blocked = 0';
    } elseif ($filter === 'waiting') {
        $conditions[] = "p.mail_class = 'reply' AND p.replied_at IS NULL AND p.blocked = 0";
    } elseif ($filter === 'fan_mail') {
        $conditions[] = "p.mail_class IN ('fan', 'fan_final') AND p.replied_at IS NULL AND p.blocked = 0";
    }
    if ($cursor !== null) {
        $conditions[] = 'p.id < :cursor';
        $params[':cursor'] = [$cursor, PDO::PARAM_INT];
    }

    $fetch = min(CY_POSTCARD_ARCHIVE_MAX_LIMIT, max(1, $limit)) + 1;
    $sql = 'SELECT p.id, p.visitor_id, p.from_name, p.body, p.image_path,
                   p.image_attrib, p.posted_at, p.mail_class, p.promoted_at,
                   p.replied_at, p.blocked
            FROM postcards p
            WHERE ' . implode(' AND ', $conditions) . '
            ORDER BY p.id DESC
            LIMIT :fetch';
    $stmt = $db->prepare($sql);
    foreach ($params as $placeholder => [$value, $type]) {
        $stmt->bindValue($placeholder, $value, $type);
    }
    $stmt->bindValue(':fetch', $fetch, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    $hasMore = count($rows) > $limit;
    if ($hasMore) {
        $rows = array_slice($rows, 0, $limit);
    }
    $replies = captive_postcard_archive_replies($db, array_column($rows, 'id'));
    $items = array_map(
        static fn(array $row): array => captive_postcard_archive_item(
            $row,
            $replies[(int)$row['id']] ?? null,
            $visitorId
        ),
        $rows
    );

    return [
        'items' => $items,
        'next_cursor' => $hasMore && $rows ? (int)$rows[count($rows) - 1]['id'] : null,
        'has_more' => $hasMore,
    ];
}
