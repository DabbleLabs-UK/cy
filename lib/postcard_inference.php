<?php
declare(strict_types=1);

// The settings row serializes every admission/settlement. When postcard state is
// also needed the lock order is queue -> postcard -> settings -> attempt.
// A reserved request is never retried after acknowledgement loss. Unknown usage
// keeps its full reservation; only provider usage can replace that estimate.
function captive_postcard_inference_config(): array
{
    static $config;
    return $config ??= json_decode(file_get_contents(__DIR__ . '/../config/postcard-inference.json'), true, 32, JSON_THROW_ON_ERROR);
}

function captive_postcard_inference_settings(array $input): array
{
    $defaults = captive_postcard_inference_config()['defaults'];
    if (array_diff_key($input, $defaults)) {
        throw new InvalidArgumentException('unknown setting');
    }
    $result = array_replace($defaults, $input);
    if (!is_bool($result['enabled']) || !in_array($result['route'], ['AUTO', 'LOCAL', 'DEEPSEEK'], true)) {
        throw new InvalidArgumentException('invalid routing settings');
    }
    foreach (['concurrency' => 4, 'requests_hour' => 1000, 'requests_day' => 10000, 'requests_month' => 100000] as $key => $max) {
        if (!is_int($result[$key]) || $result[$key] < 1 || $result[$key] > $max) {
            throw new InvalidArgumentException('invalid ' . $key);
        }
    }
    foreach (['gbp_hour', 'gbp_day', 'gbp_month'] as $key) {
        if (!is_int($result[$key]) && !is_float($result[$key])) {
            throw new InvalidArgumentException('invalid ' . $key);
        }
        if (!is_finite((float)$result[$key]) || $result[$key] < 0 || $result[$key] > 1000) {
            throw new InvalidArgumentException('invalid ' . $key);
        }
    }
    return $result;
}

function captive_postcard_inference_lock(PDO $db): array
{
    $row = $db->query('SELECT settings FROM postcard_inference_settings WHERE id = 1 FOR UPDATE')->fetchColumn();
    if ($row === false) {
        throw new RuntimeException('postcard inference settings missing');
    }
    return captive_postcard_inference_settings(json_decode($row, true, 32, JSON_THROW_ON_ERROR));
}

function captive_postcard_inference_cost(int $uncached, int $cached, int $output, array $pricing): float
{
    return round((max(0, $uncached) * $pricing['input_uncached_per_million']
        + max(0, $cached) * $pricing['input_cached_per_million']
        + max(0, $output) * $pricing['output_per_million']) / 1000000 * $pricing['usd_to_gbp'], 10);
}

function captive_postcard_inference_windows(PDO $db): array
{
    $result = [];
    foreach (['hour' => 'UTC_TIMESTAMP() - INTERVAL 1 HOUR', 'day' => 'UTC_DATE()', 'month' => "DATE_FORMAT(UTC_DATE(), '%Y-%m-01')"] as $key => $start) {
        $row = $db->query("SELECT COUNT(*) AS requests,
            COALESCE(SUM(COALESCE(actual_gbp, estimated_gbp)), 0) AS estimated_gbp,
            COALESCE(SUM(IF(actual_gbp IS NULL, estimated_gbp, 0)), 0) AS uncertain_gbp
            FROM postcard_inference_attempts WHERE provider = 'deepseek' AND created_at >= {$start}")->fetch(PDO::FETCH_ASSOC);
        $result[$key] = ['requests' => (int)$row['requests'], 'estimated_gbp' => (float)$row['estimated_gbp'], 'uncertain_gbp' => (float)$row['uncertain_gbp']];
    }
    return $result;
}

function captive_postcard_inference_cap_reason(array $settings, array $windows, int $active, float $estimate): ?string
{
    if ($active >= $settings['concurrency']) return 'concurrency_full';
    foreach (['hour', 'day', 'month'] as $key) {
        if ($windows[$key]['requests'] >= $settings['requests_' . $key]) return $key . '_request_cap';
        if ($windows[$key]['estimated_gbp'] + $estimate > $settings['gbp_' . $key] + 0.00000000001) return $key . '_spend_cap';
    }
    return null;
}

function captive_postcard_inference_admission(PDO $db, array $settings, float $estimate): ?string
{
    // Provider calls have a bounded foreground timeout. Expiring only the
    // concurrency lease after 30 minutes never releases the unknown spend or
    // makes the unique attempt eligible to run again.
    $active = (int)$db->query("SELECT COUNT(*) FROM postcard_inference_attempts WHERE provider = 'deepseek' AND settled_at IS NULL AND created_at >= UTC_TIMESTAMP() - INTERVAL 30 MINUTE")->fetchColumn();
    return captive_postcard_inference_cap_reason($settings, captive_postcard_inference_windows($db), $active, $estimate);
}

function captive_postcard_inference_route_choice(array $settings, bool $available, bool $healthy, ?string $cap): array
{
    if (!$settings['enabled']) return ['provider' => 'ollama', 'reason' => 'cloud_disabled'];
    if ($settings['route'] === 'LOCAL') return ['provider' => 'ollama', 'reason' => 'local_selected'];
    $reason = !$available ? 'credentials_missing' : (!$healthy ? 'provider_unavailable' : $cap);
    if ($reason === null) return ['provider' => 'deepseek', 'reason' => 'deepseek_active'];
    return ['provider' => $settings['route'] === 'AUTO' ? 'ollama' : null, 'reason' => $reason];
}

function captive_postcard_inference_turn_lock(PDO $db, int $id): ?array
{
    captive_postcard_queue_lock($db);
    $read = $db->prepare('SELECT id, visitor_id, blocked, mail_class, replied_at, delivered_at,
        (delivered_at >= NOW() - INTERVAL ' . CY_REPLY_CLAIM_TTL_SECONDS . ' SECOND) AS claim_live
        FROM postcards WHERE id = ? FOR UPDATE');
    $read->execute([$id]);
    return $read->fetch(PDO::FETCH_ASSOC) ?: null;
}

function captive_postcard_inference_route(PDO $db, array $input): array
{
    $id = captive_postcard_inference_int($input, 'postcard_id', 1, PHP_INT_MAX);
    $postcard = captive_postcard_inference_turn_lock($db, $id);
    $settings = captive_postcard_inference_lock($db);
    $pricing = captive_postcard_inference_config()['pricing'];
    $existing = $db->prepare('SELECT * FROM postcard_inference_turns WHERE postcard_id = ?');
    $existing->execute([$id]);
    if ($turn = $existing->fetch(PDO::FETCH_ASSOC)) {
        return ['ok' => true, 'execute' => false, 'provider' => $turn['provider'], 'route' => $turn['route'], 'reason' => 'already_claimed', 'settings' => $settings, 'pricing' => $pricing];
    }
    if (!$postcard || $postcard['blocked'] || $postcard['replied_at'] || $postcard['mail_class'] !== 'reply' || !$postcard['claim_live']) {
        return ['ok' => true, 'execute' => false, 'provider' => null, 'route' => $settings['route'], 'reason' => 'not_claimable', 'settings' => $settings, 'pricing' => $pricing];
    }
    $available = ($input['cloud_available'] ?? false) === true && ($input['model'] ?? '') === $pricing['model'];
    $recentFailure = (int)$db->query("SELECT COUNT(*) FROM postcard_inference_attempts WHERE provider = 'deepseek' AND provider_error IS NOT NULL AND settled_at >= UTC_TIMESTAMP() - INTERVAL 60 SECOND")->fetchColumn();
    $choice = captive_postcard_inference_route_choice($settings, $available, ($input['cloud_healthy'] ?? false) === true && $recentFailure === 0, captive_postcard_inference_admission($db, $settings, 0));
    $model = $choice['provider'] === 'deepseek' ? $pricing['model'] : captive_postcard_inference_model($input['local_model'] ?? 'local');
    $insert = $db->prepare('INSERT INTO postcard_inference_turns (postcard_id, route, provider, model, status, reason, fallback_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))');
    $fallback = $settings['enabled'] && $settings['route'] === 'AUTO' && $choice['provider'] === 'ollama' ? $choice['reason'] : null;
    $insert->execute([$id, $settings['route'], $choice['provider'], $model, $choice['provider'] ? 'claimed' : 'held', $choice['reason'], $fallback]);
    return ['ok' => true, 'execute' => $choice['provider'] !== null, 'route' => $settings['route'], 'settings' => $settings, 'pricing' => $pricing,
        'correspondence' => captive_postcard_inference_correspondence($db, $postcard)] + $choice;
}

function captive_postcard_inference_correspondence(PDO $db, array $postcard): array
{
    if (empty($postcard['visitor_id'])) return [];
    // Replied items prove prior receipt. Delivery alone is only an inbox claim,
    // and unscreened/fan-mail arrivals do not establish that Cy knew the text.
    // Legacy outgoing prose has no indexed postcard linkage and is omitted.
    $read = $db->prepare("SELECT p.from_name, p.body, p.posted_at, e.payload AS reply_payload
        FROM postcards p
        LEFT JOIN postcard_inference_turns t ON t.postcard_id = p.id
        LEFT JOIN events e ON e.seq = t.publication_event_id AND e.kind = 'postcard_out'
        WHERE p.visitor_id = ? AND p.id < ? AND p.blocked = 0 AND p.replied_at IS NOT NULL
        ORDER BY p.id DESC LIMIT 2");
    $read->execute([$postcard['visitor_id'], $postcard['id']]);
    $result = [];
    foreach (array_reverse($read->fetchAll(PDO::FETCH_ASSOC)) as $row) {
        $reply = json_decode((string)($row['reply_payload'] ?? ''), true);
        $result[] = [
            'from_name' => mb_substr((string)($row['from_name'] ?? ''), 0, 40),
            'body' => mb_substr((string)($row['body'] ?? ''), 0, 500),
            'posted_at' => $row['posted_at'],
            'reply' => is_array($reply) && is_string($reply['body'] ?? null) ? mb_substr($reply['body'], 0, 500) : null,
        ];
    }
    return $result;
}

function captive_postcard_inference_int(array $input, string $key, int $min, int $max): int
{
    $value = $input[$key] ?? null;
    if (!is_int($value) || $value < $min || $value > $max) throw new InvalidArgumentException('invalid ' . $key);
    return $value;
}

function captive_postcard_inference_model(mixed $model): string
{
    if (!is_string($model) || !preg_match('/\A[a-zA-Z0-9._:\/ -]{1,120}\z/', $model)) throw new InvalidArgumentException('invalid model');
    return $model;
}

function captive_postcard_inference_reason(mixed $reason): string
{
    // Reasons are codes, never exception messages or provider response bodies.
    $allowed = ['cloud_disabled', 'local_selected', 'deepseek_active', 'credentials_missing', 'provider_unavailable',
        'concurrency_full', 'hour_request_cap', 'day_request_cap', 'month_request_cap', 'hour_spend_cap', 'day_spend_cap',
        'month_spend_cap', 'timeout', 'network_error', 'provider_error', 'validation_rejected', 'cancelled', 'empty_response',
        'generated', 'held', 'budget_unavailable', 'already_claimed', 'publication_pending', 'local_fallback'];
    return is_string($reason) && in_array($reason, $allowed, true) ? $reason : 'provider_error';
}

function captive_postcard_inference_reserve(PDO $db, array $input): array
{
    $id = captive_postcard_inference_int($input, 'postcard_id', 1, PHP_INT_MAX);
    $postcard = captive_postcard_inference_turn_lock($db, $id);
    $settings = captive_postcard_inference_lock($db);
    $pricing = captive_postcard_inference_config()['pricing'];
    $provider = $input['provider'] ?? '';
    $attempt = $input['attempt'] ?? '';
    $model = captive_postcard_inference_model($input['model'] ?? null);
    if (!in_array($provider, ['deepseek', 'ollama'], true) || !in_array($attempt, ['initial', 'repair'], true)) throw new InvalidArgumentException('invalid attempt');
    $tokens = captive_postcard_inference_int($input, 'input_tokens', 1, 1000000);
    $output = captive_postcard_inference_int($input, 'max_output_tokens', 1, 8192);
    $read = $db->prepare('SELECT * FROM postcard_inference_turns WHERE postcard_id = ?');
    $read->execute([$id]);
    $turn = $read->fetch(PDO::FETCH_ASSOC);
    if (!$postcard || $postcard['replied_at'] || $postcard['blocked'] || $postcard['mail_class'] !== 'reply' || !$postcard['claim_live'] || !$turn || $turn['provider'] !== $provider || !in_array($turn['status'], ['claimed', 'generating'], true)) {
        return ['ok' => true, 'execute' => false, 'reason' => 'turn_not_active'];
    }
    $read = $db->prepare('SELECT request_id FROM postcard_inference_attempts WHERE postcard_id = ? AND provider = ? AND attempt = ?');
    $read->execute([$id, $provider, $attempt]);
    if ($request = $read->fetchColumn()) return ['ok' => true, 'execute' => false, 'request_id' => $request, 'reason' => 'already_reserved'];
    if ($attempt === 'repair') {
        $initial = $db->prepare("SELECT status, validation_failure, settled_at FROM postcard_inference_attempts WHERE postcard_id = ? AND provider = ? AND attempt = 'initial'");
        $initial->execute([$id, $provider]);
        $first = $initial->fetch(PDO::FETCH_ASSOC);
        if (!$first || !$first['settled_at'] || !$first['validation_failure']) return ['ok' => true, 'execute' => false, 'reason' => 'repair_not_allowed'];
    }
    $estimate = $provider === 'deepseek' ? captive_postcard_inference_cost($tokens, 0, $output, $pricing) : 0;
    if ($provider === 'deepseek') {
        if ($model !== $pricing['model']) throw new InvalidArgumentException('unconfigured cloud model');
        $reason = !$settings['enabled'] ? 'cloud_disabled' : ($settings['route'] === 'LOCAL' ? 'local_selected' : captive_postcard_inference_admission($db, $settings, $estimate));
        if ($reason) return ['ok' => true, 'execute' => false, 'reason' => $reason, 'pricing' => $pricing, 'estimated_gbp' => $estimate];
    }
    $hex = bin2hex(random_bytes(16));
    $request = substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
    $insert = $db->prepare("INSERT INTO postcard_inference_attempts (request_id, postcard_id, attempt, provider, model, route, status, estimated_gbp, pricing, created_at) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, UTC_TIMESTAMP(3))");
    $insert->execute([$request, $id, $attempt, $provider, $model, $turn['route'], $estimate, json_encode($pricing, JSON_THROW_ON_ERROR)]);
    $db->prepare("UPDATE postcard_inference_turns SET status = 'generating', model = ?, updated_at = UTC_TIMESTAMP(3) WHERE postcard_id = ?")->execute([$model, $id]);
    return ['ok' => true, 'execute' => true, 'request_id' => $request, 'pricing' => $pricing, 'estimated_gbp' => $estimate];
}

function captive_postcard_inference_settle(PDO $db, array $input): array
{
    captive_postcard_inference_lock($db);
    $request = $input['request_id'] ?? '';
    if (!is_string($request) || !preg_match('/\A[a-f0-9-]{36}\z/', $request)) throw new InvalidArgumentException('invalid request_id');
    $read = $db->prepare('SELECT * FROM postcard_inference_attempts WHERE request_id = ? FOR UPDATE');
    $read->execute([$request]);
    $row = $read->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new InvalidArgumentException('unknown request');
    if ($row['settled_at']) {
        $pricing = json_decode($row['pricing'], true, 32, JSON_THROW_ON_ERROR);
        $actual = $row['actual_gbp'] === null ? null : (float)$row['actual_gbp'];
        return ['ok' => true, 'settled' => true, 'duplicate' => true, 'actual_gbp' => $actual, 'cost_gbp' => $actual,
            'cost_usd' => $actual === null ? null : $actual / $pricing['usd_to_gbp'],
            'uncertain_gbp' => $actual === null ? (float)$row['estimated_gbp'] : 0];
    }
    $status = $input['status'] ?? '';
    if (!in_array($status, ['success', 'generated', 'failed', 'cancelled', 'aborted', 'refused', 'validation_rejected', 'unknown', 'provider_error'], true)) throw new InvalidArgumentException('invalid status');
    $usage = $input['usage'] ?? null;
    $prompt = $output = $cached = $uncached = $actual = null;
    if ($usage !== null) {
        if (!is_array($usage)) throw new InvalidArgumentException('invalid usage');
        $prompt = captive_postcard_inference_int($usage, 'prompt_tokens', 0, 10000000);
        $output = captive_postcard_inference_int($usage, 'completion_tokens', 0, 10000000);
        $cached = isset($usage['cached_tokens']) ? captive_postcard_inference_int($usage, 'cached_tokens', 0, $prompt) : 0;
        $uncached = $prompt - $cached;
        if (isset($usage['uncached_tokens']) && $usage['uncached_tokens'] !== $uncached) throw new InvalidArgumentException('inconsistent usage');
        $actual = $row['provider'] === 'deepseek' ? captive_postcard_inference_cost($uncached, $cached, $output, json_decode($row['pricing'], true, 32, JSON_THROW_ON_ERROR)) : 0;
    } elseif ($row['provider'] === 'ollama') {
        $actual = 0;
    }
    $latency = captive_postcard_inference_int($input, 'latency_ms', 0, 86400000);
    // Empty transport-failure output is not a rejected prose candidate. Treating
    // it as one would incorrectly block AUTO's permitted local fallback.
    $failure = $status === 'validation_rejected'
        || (in_array($status, ['success', 'generated'], true) && !empty($input['validation_failure']));
    $error = empty($input['provider_error']) ? null : captive_postcard_inference_reason($input['provider_error']);
    $update = $db->prepare('UPDATE postcard_inference_attempts SET settled_at = UTC_TIMESTAMP(3), status = ?, input_tokens = ?, output_tokens = ?, cached_tokens = ?, uncached_tokens = ?, actual_gbp = ?, latency_ms = ?, validation_failure = ?, provider_error = ? WHERE request_id = ?');
    $update->execute([$status, $prompt, $output, $cached, $uncached, $actual, $latency, (int)$failure, $error, $request]);
    $pricing = json_decode($row['pricing'], true, 32, JSON_THROW_ON_ERROR);
    return ['ok' => true, 'settled' => true, 'actual_gbp' => $actual, 'cost_gbp' => $actual,
        'cost_usd' => $actual === null ? null : $actual / $pricing['usd_to_gbp'],
        'uncertain_gbp' => $actual === null ? (float)$row['estimated_gbp'] : 0];
}

function captive_postcard_inference_outcome(PDO $db, array $input, bool $fallback = false): array
{
    $id = captive_postcard_inference_int($input, 'postcard_id', 1, PHP_INT_MAX);
    $postcard = captive_postcard_inference_turn_lock($db, $id);
    $settings = captive_postcard_inference_lock($db);
    $read = $db->prepare('SELECT * FROM postcard_inference_turns WHERE postcard_id = ? FOR UPDATE');
    $read->execute([$id]);
    $turn = $read->fetch(PDO::FETCH_ASSOC);
    if (!$turn || !$postcard || $postcard['replied_at'] || $postcard['blocked'] || $postcard['mail_class'] !== 'reply' || !$postcard['claim_live'] || $turn['publication_result']) return ['ok' => true, 'execute' => false, 'reason' => 'turn_closed'];
    $reason = captive_postcard_inference_reason($input['reason'] ?? $input['status'] ?? 'provider_error');
    if ($fallback) {
        if ($turn['route'] !== 'AUTO' || $turn['provider'] !== 'deepseek' || !in_array($turn['status'], ['claimed', 'generating'], true)) return ['ok' => true, 'execute' => false, 'reason' => 'fallback_not_allowed'];
        $read = $db->prepare("SELECT COUNT(*) FROM postcard_inference_attempts WHERE postcard_id = ? AND provider = 'deepseek' AND (settled_at IS NULL OR validation_failure = 1 OR status IN ('success', 'generated'))");
        $read->execute([$id]);
        if ((int)$read->fetchColumn() > 0) return ['ok' => true, 'execute' => false, 'reason' => 'fallback_not_allowed'];
        $db->prepare("UPDATE postcard_inference_turns SET provider = 'ollama', status = 'claimed', reason = 'local_fallback', fallback_reason = ?, updated_at = UTC_TIMESTAMP(3) WHERE postcard_id = ?")->execute([$reason, $id]);
        return ['ok' => true, 'execute' => true, 'provider' => 'ollama', 'reason' => $reason];
    }
    $status = $input['status'] ?? '';
    if (!in_array($status, ['generated', 'validation_rejected', 'held'], true)) throw new InvalidArgumentException('invalid outcome');
    $db->prepare('UPDATE postcard_inference_turns SET status = ?, reason = ?, updated_at = UTC_TIMESTAMP(3) WHERE postcard_id = ?')->execute([$status, $reason, $id]);
    return ['ok' => true, 'execute' => true];
}

function captive_postcard_inference_same_origin(array $server): bool
{
    if (strtolower(trim(explode(';', $server['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') return false;
    if (isset($server['HTTP_SEC_FETCH_SITE']) && $server['HTTP_SEC_FETCH_SITE'] !== 'same-origin') return false;
    $origin = $server['HTTP_ORIGIN'] ?? $server['HTTP_REFERER'] ?? '';
    $parts = parse_url($origin);
    if (!$parts || !isset($parts['scheme'], $parts['host']) || !in_array($parts['scheme'], ['https', 'http'], true)) return false;
    if ($parts['scheme'] !== 'https' && !in_array($parts['host'], ['127.0.0.1', 'localhost', '[::1]'], true)) return false;
    $authority = strtolower($parts['host']) . (isset($parts['port']) ? ':' . $parts['port'] : '');
    return hash_equals(strtolower($server['HTTP_HOST'] ?? ''), $authority);
}

function captive_postcard_inference_publication(PDO $db, int $postcardId, string $result, ?int $eventId = null): void
{
    // Compatibility for an old server during the additive migration rollout.
    try {
        $db->prepare('UPDATE postcard_inference_turns SET publication_result = ?, publication_event_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE postcard_id = ? AND publication_result IS NULL')->execute([$result, $eventId, $postcardId]);
    } catch (PDOException $error) {
        if (($error->errorInfo[0] ?? null) !== '42S02' || (int)($error->errorInfo[1] ?? 0) !== 1146) throw $error;
    }
}

function captive_postcard_inference_view(PDO $db, string $range, bool $admin): array
{
    $ranges = ['1H' => 3600, '24H' => 86400, '30D' => 2592000, 'ALL' => null];
    if (!array_key_exists($range, $ranges)) throw new InvalidArgumentException('invalid range');
    $now = time();
    $start = $ranges[$range] === null
        ? (int)$db->query("SELECT COALESCE(TIMESTAMPDIFF(SECOND, '1970-01-01', MIN(created_at)), TIMESTAMPDIFF(SECOND, '1970-01-01', UTC_TIMESTAMP())) FROM postcard_inference_attempts")->fetchColumn()
        : $now - $ranges[$range];
    $bucket = max(1, (int)ceil(($now - $start + 1) / 120));
    $since = gmdate('Y-m-d H:i:s', $start);
    $read = $db->prepare("SELECT COUNT(*) AS requests,
        COALESCE(SUM(provider = 'deepseek'),0) AS cloud_requests, COALESCE(SUM(provider = 'ollama'),0) AS local_requests,
        COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(SUM(cached_tokens),0) AS cached_tokens, COALESCE(SUM(uncached_tokens),0) AS uncached_tokens,
        COALESCE(SUM(COALESCE(actual_gbp, estimated_gbp)),0) AS estimated_gbp,
        COALESCE(SUM(IF(actual_gbp IS NULL, estimated_gbp, 0)),0) AS uncertain_gbp,
        COALESCE(SUM(latency_ms),0) AS latency_ms, COALESCE(AVG(latency_ms),0) AS mean_latency_ms,
        COALESCE(SUM(status IN ('failed','cancelled','aborted','refused','validation_rejected','unknown','provider_error')),0) AS failures,
        COALESCE(SUM(validation_failure),0) AS validation_failures
        FROM postcard_inference_attempts WHERE created_at >= ?");
    $read->execute([$since]);
    $totals = array_map(static fn($value) => (float)$value, $read->fetch(PDO::FETCH_ASSOC));
    $read = $db->prepare("SELECT SUM(fallback_reason IS NOT NULL) AS fallbacks, SUM(publication_result = 'published') AS published FROM postcard_inference_turns WHERE created_at >= ?");
    $read->execute([$since]);
    foreach ($read->fetch(PDO::FETCH_ASSOC) as $key => $value) $totals[$key] = (int)$value;
    $read = $db->prepare("SELECT FLOOR((TIMESTAMPDIFF(SECOND, '1970-01-01', created_at) - {$start}) / {$bucket}) AS bucket,
        COUNT(*) AS requests, SUM(provider = 'deepseek') AS cloud_requests, SUM(provider = 'ollama') AS local_requests,
        SUM(COALESCE(actual_gbp, estimated_gbp)) AS estimated_gbp,
        SUM(IF(actual_gbp IS NULL, estimated_gbp, 0)) AS uncertain_gbp,
        COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens
        FROM postcard_inference_attempts WHERE created_at >= ? GROUP BY bucket ORDER BY bucket");
    $read->execute([$since]);
    $buckets = [];
    foreach ($read->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $at = $start + (int)$row['bucket'] * $bucket;
        unset($row['bucket']);
        $buckets[] = ['at' => gmdate('Y-m-d\TH:i:s\Z', $at)] + array_map(static fn($value) => (float)$value, $row);
    }
    $settings = captive_postcard_inference_settings(json_decode($db->query('SELECT settings FROM postcard_inference_settings WHERE id = 1')->fetchColumn(), true, 32, JSON_THROW_ON_ERROR));
    $latest = $db->query('SELECT provider, model, reason FROM postcard_inference_turns ORDER BY updated_at DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
    $status = ['route' => $settings['route'], 'provider' => $latest['provider'] ?? null, 'model' => $latest['model'] ?? captive_postcard_inference_config()['pricing']['model'], 'reason' => $latest['reason'] ?? 'no_requests'];
    if (!$settings['enabled'] || $settings['route'] === 'LOCAL') {
        $status['provider'] = 'ollama';
        $localModel = $db->query("SELECT model FROM postcard_inference_attempts WHERE provider = 'ollama' ORDER BY created_at DESC LIMIT 1")->fetchColumn();
        $status['model'] = $localModel === false ? 'local' : $localModel;
        $status['reason'] = !$settings['enabled'] ? 'cloud_disabled' : 'local_selected';
    }
    // Public telemetry is aggregate only. No postcard IDs, text or raw errors.
    return ['ok' => true, 'can_admin' => $admin, 'settings' => $settings,
        'pricing' => captive_postcard_inference_config()['pricing'], 'status' => $status,
        'range' => $range, 'start' => gmdate('Y-m-d\TH:i:s\Z', $start), 'end' => gmdate('Y-m-d\TH:i:s\Z', $now),
        'totals' => $totals, 'windows' => captive_postcard_inference_windows($db), 'buckets' => $buckets, 'recent' => []];
}
