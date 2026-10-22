<?php
declare(strict_types=1);

const CY_POSTCARD_RECALL_PERMISSION = 'compact-public-recall-v1';

function captive_postcard_recall_permission(array $input): ?string
{
    if (!array_key_exists('public_recollection', $input)) return null;
    if ($input['public_recollection'] !== CY_POSTCARD_RECALL_PERMISSION) {
        throw new InvalidArgumentException('invalid public recollection permission');
    }
    return CY_POSTCARD_RECALL_PERMISSION;
}

// Authoritative publication and exchange permission, never a runner assertion
// or public-archive visibility. Only reply formation can offer this extra slot.
function captive_postcard_recollection_exchange(PDO $db, array $source, bool $requirePermission = true): ?array
{
    if (($source['sourceType'] ?? '') !== 'CY_REPLY'
        || !preg_match('/^postcard-reply:([1-9][0-9]*)$/', (string)($source['sourceId'] ?? ''), $m)) return null;
    $eligibility = $requirePermission ? ' AND p.blocked = 0 AND p.recall_permission_version = ? AND p.recall_permitted_at IS NOT NULL' : '';
    $read = $db->prepare("SELECT p.*, a.payload AS arrival_payload, r.seq AS reply_seq, r.ts AS reply_ts, r.payload AS reply_payload
        FROM postcards p JOIN events a ON a.seq = p.arrival_event_id AND a.kind = 'postcard_in'
        JOIN events r ON r.kind = 'postcard_out'
          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.payload, '$.reply_to')), JSON_UNQUOTE(JSON_EXTRACT(r.payload, '$.id'))) = CAST(p.id AS CHAR)
        WHERE p.id = ? AND p.visitor_id = ? AND p.replied_at IS NOT NULL $eligibility
        ORDER BY r.seq ASC LIMIT 1");
    $read->execute(array_merge([(int)$m[1], $source['subjectVisitorId'] ?? null], $requirePermission ? [CY_POSTCARD_RECALL_PERMISSION] : []));
    $row = $read->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;
    $arrival = json_decode($row['arrival_payload'], true, 32, JSON_THROW_ON_ERROR);
    $reply = json_decode($row['reply_payload'], true, 32, JSON_THROW_ON_ERROR);
    if ((int)($arrival['id'] ?? 0) !== (int)$row['id'] || !is_string($reply['body'] ?? null) || trim($reply['body']) === '') return null;
    return ['postcardId' => (int)$row['id'], 'replySeq' => (int)$row['reply_seq'],
        'permissionVersion' => $row['recall_permission_version'], 'permissionAt' => $row['recall_permitted_at'],
        'senderLabel' => $row['from_name'], 'postcardAt' => $row['posted_at'], 'occurredAt' => $row['reply_ts'],
        // Only the screened, published text. An image/caption alone is not new
        // testimony, nor permission to reuse an image.
        'correspondentText' => (string)($arrival['body'] ?? ''), 'replyText' => $reply['body']];
}

function captive_postcard_enqueue_recollection(PDO $db, int $postcardId, int $replySeq): void
{
    $read = $db->prepare('SELECT visitor_id, from_name, recall_permission_version FROM postcards WHERE id = ?');
    $read->execute([$postcardId]);
    $postcard = $read->fetch(PDO::FETCH_ASSOC);
    if (!$postcard || !$postcard['visitor_id'] || $postcard['recall_permission_version'] !== CY_POSTCARD_RECALL_PERMISSION) return;
    $read = $db->prepare("SELECT ts, payload FROM events WHERE seq = ? AND kind = 'postcard_out'");
    $read->execute([$replySeq]);
    $reply = $read->fetch(PDO::FETCH_ASSOC);
    if (!$reply) throw new InvalidArgumentException('published reply source missing');
    $payload = json_decode($reply['payload'], true, 32, JSON_THROW_ON_ERROR);
    if ((int)($payload['reply_to'] ?? $payload['id'] ?? 0) !== $postcardId || !is_string($payload['body'] ?? null)) {
        throw new InvalidArgumentException('published reply source mismatch');
    }
    $source = ['sourceType' => 'CY_REPLY', 'sourceId' => 'postcard-reply:' . $postcardId,
        'subjectVisitorId' => $postcard['visitor_id'], 'sourceVisibility' => 'SENDER_RECALLABLE',
        'text' => mb_substr($payload['body'], 0, 1600), 'occurredAt' => $reply['ts'],
        'participantLabel' => $postcard['from_name'], 'tags' => ['cy-expression', 'postcard', 'reply'],
        'linkedSourceIds' => !empty($payload['environment_event_id']) ? [$payload['environment_event_id']] : []];
    // Sender-only reply formation survives even if the independently required
    // screened-arrival/public-recollection eligibility check later fails.
    // Same source identity/queue, atomically with publication. Delivery replay
    // cannot enqueue another call. No separate public-memory inference job.
    captive_memory_enqueue_source($db, $source);
}

function captive_postcard_public_summary(mixed $proposal, array $exchange): ?array
{
    if ($proposal === null) return null;
    if (!is_array($proposal) || count($proposal) !== 2 || !isset($proposal['basis'], $proposal['summary'])
        || !in_array($proposal['basis'], ['POSTCARD', 'CY_REPLY'], true) || !is_string($proposal['summary'])) {
        throw new InvalidArgumentException('invalid public recollection');
    }
    $text = trim($proposal['summary']);
    $original = $proposal['basis'] === 'POSTCARD' ? $exchange['correspondentText'] : $exchange['replyText'];
    $allText = $exchange['correspondentText'] . ' ' . $exchange['replyText'];
    // Fail closed on obvious identifiers and copied source phrases. This is
    // conservative data minimisation, not a general semantic privacy oracle.
    // Opted-in personal gist is allowed; identifiers are not. Do not reject
    // employment, loss, health or feelings merely because they are personal.
    preg_match_all('/\b[A-Z][a-z]{2,}\b/u', $allText, $names);
    $names = array_diff($names[0], ['The', 'This', 'That', 'There', 'They', 'Their', 'What', 'When', 'Where', 'How', 'Hello', 'Thanks']);
    $named = false;
    foreach ($names as $name) if (preg_match('/\b' . preg_quote($name, '/') . '\b/iu', $text)) $named = true;
    $words = preg_split('/[^\p{L}\p{N}]+/u', mb_strtolower($text), -1, PREG_SPLIT_NO_EMPTY);
    $sourceWords = ' ' . implode(' ', preg_split('/[^\p{L}\p{N}]+/u', mb_strtolower($allText), -1, PREG_SPLIT_NO_EMPTY)) . ' ';
    $copied = false;
    for ($i = 0; $i + 4 <= count($words); $i++) {
        if (str_contains($sourceWords, ' ' . implode(' ', array_slice($words, $i, 4)) . ' ')) $copied = true;
    }
    if ($text === '' || mb_strlen($text) > 200 || trim($original) === ''
        || $named || $copied || preg_match('/[<>|\x00-\x1F]|["\x{201c}\x{201d}]/u', $text)
        || preg_match('/https?:|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\d[\s()+.-]*){7,}/iu', $text)
        || preg_match('/(?<![\w@])@[a-z0-9_][a-z0-9_.-]{1,}|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/iu', $text)
        || preg_match('/\b\d{1,5}\s+(?:[\p{L}]+\s+){1,4}(?:street|road|lane|avenue|mews|close|drive|court|way)\b/iu', $text)
        || (mb_strlen(trim((string)$exchange['senderLabel'])) >= 3
            && mb_stripos($text, trim((string)$exchange['senderLabel'])) !== false)
        || mb_strtolower($text) === mb_strtolower(trim($original))) {
        throw new InvalidArgumentException('unsafe public recollection');
    }
    $prefix = $proposal['basis'] === 'POSTCARD' ? 'A correspondent told Cy: ' : 'Cy replied to a correspondent: ';
    return ['basis' => $proposal['basis'], 'summary' => $prefix . $text];
}

function captive_postcard_apply_recollection(PDO $db, array $source, mixed $proposal): ?array
{
    if ($proposal === null) return null;
    $exchange = captive_postcard_recollection_exchange($db, $source);
    if (!$exchange) throw new InvalidArgumentException('exchange not eligible for public recollection');
    $safe = captive_postcard_public_summary($proposal, $exchange);
    // One canonical memory identity per exchange, across retries/claims. A
    // deleted/archived record is not resurrected by delayed completion.
    $hex = hash('sha256', 'cy-public-recollection:' . $exchange['postcardId']);
    $id = substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
    $read = $db->prepare('SELECT id FROM autobiographical_memories WHERE id = ?');
    $read->execute([$id]);
    if ($read->fetchColumn()) return ['memory_id' => $id, 'duplicate' => true];
    $origin = $safe['basis'];
    $primary = ['sourceType' => $origin, 'sourceId' => ($origin === 'POSTCARD' ? 'postcard:' : 'postcard-reply:') . $exchange['postcardId'],
        'subjectVisitorId' => $source['subjectVisitorId'], 'sourceVisibility' => 'SENDER_RECALLABLE',
        'occurredAt' => $origin === 'POSTCARD' ? $exchange['postcardAt'] : $exchange['occurredAt'],
        'text' => 'Published exchange; ' . $exchange['permissionVersion'] . ' at ' . $exchange['permissionAt'] . '; reply event ' . $exchange['replySeq'] . '.'];
    $result = captive_memory_apply($db, ['decision' => 'CREATE', 'memoryId' => $id, 'type' => 'EPISODIC',
        'privacyScope' => 'PUBLIC_RECALLABLE', 'consistencyStatus' => 'UNCERTAIN',
        'content' => $safe['summary'], 'publicSummary' => $safe['summary'], 'originKind' => $origin,
        'classification' => 'opted-in correspondence recollection', 'source' => $primary,
        'tags' => captive_memory_tokens($safe['summary'])]);
    // Preserve both sides of the exchange, but no raw transcript in the public
    // representation/source excerpts. Their original records remain unchanged.
    foreach (['POSTCARD' => 'postcard:', 'CY_REPLY' => 'postcard-reply:'] as $kind => $prefix) {
        captive_memory_add_source($db, $id, array_replace($primary, ['sourceType' => $kind, 'sourceId' => $prefix . $exchange['postcardId'],
            'occurredAt' => $kind === 'POSTCARD' ? $exchange['postcardAt'] : $exchange['occurredAt']]));
    }
    return $result;
}
