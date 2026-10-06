<?php
declare(strict_types=1);

// Accounting only: memory content and lifecycle remain in the canonical store.
// Transaction lock order: formation queue -> settings -> inference attempt.
function captive_memory_inference_config(): array
{
    static $config;
    return $config ??= json_decode(file_get_contents(__DIR__ . '/../config/memory-formation-inference.json'), true, 32, JSON_THROW_ON_ERROR);
}

function captive_memory_inference_settings(array $input): array
{
    $defaults = captive_memory_inference_config()['defaults'];
    if (array_diff_key($input, $defaults)) throw new InvalidArgumentException('unknown setting');
    $settings = array_replace($defaults, $input);
    if (!in_array($settings['mode'], ['DEEPSEEK', 'LOCAL', 'OFF'], true)) throw new InvalidArgumentException('invalid mode');
    foreach (['concurrency' => 4, 'requests_hour' => 1000, 'requests_day' => 10000, 'requests_month' => 100000] as $key => $max) {
        if (!is_int($settings[$key]) || $settings[$key] < 1 || $settings[$key] > $max) throw new InvalidArgumentException('invalid ' . $key);
    }
    foreach (['gbp_hour', 'gbp_day', 'gbp_month'] as $key) {
        $value = $settings[$key];
        if ((!is_int($value) && !is_float($value)) || !is_finite((float)$value) || $value < 0 || $value > 1000) {
            throw new InvalidArgumentException('invalid ' . $key);
        }
    }
    return $settings;
}

function captive_memory_inference_lock(PDO $db): array
{
    $row = $db->query('SELECT settings FROM memory_formation_inference_settings WHERE id = 1 FOR UPDATE')->fetchColumn();
    if ($row === false) throw new RuntimeException('formation inference settings missing');
    return captive_memory_inference_settings(json_decode($row, true, 32, JSON_THROW_ON_ERROR));
}

function captive_memory_inference_int(array $input, string $key, int $min, int $max): int
{
    $value = $input[$key] ?? null;
    if (!is_int($value) || $value < $min || $value > $max) throw new InvalidArgumentException('invalid ' . $key);
    return $value;
}

function captive_memory_inference_token(mixed $value): string
{
    if (!is_string($value) || !preg_match('/\A[a-f0-9]{32}\z/', $value)) throw new InvalidArgumentException('invalid claim or request');
    return $value;
}

function captive_memory_inference_model(mixed $value): string
{
    if (!is_string($value) || !preg_match('/\A[a-zA-Z0-9._:\/ -]{1,160}\z/', $value)) throw new InvalidArgumentException('invalid model');
    return $value;
}

function captive_memory_inference_reason(mixed $value): string
{
    $allowed = ['deepseek_active', 'local_selected', 'disabled', 'credentials_missing', 'model_mismatch',
        'concurrency_full', 'hour_request_cap', 'day_request_cap', 'month_request_cap',
        'hour_spend_cap', 'day_spend_cap', 'month_spend_cap', 'generated', 'timeout', 'network_error',
        'transport_failure', 'rate_limit', 'provider_unavailable', 'provider_error', 'cancelled', 'local_busy',
        'invalid_decision', 'application_conflict'];
    if (!is_string($value) || !in_array($value, $allowed, true)) throw new InvalidArgumentException('invalid reason');
    return $value;
}

function captive_memory_inference_cost(int $uncached, int $cached, int $output, array $pricing): float
{
    return round((max(0, $uncached) * $pricing['input_uncached_per_million']
        + max(0, $cached) * $pricing['input_cached_per_million']
        + max(0, $output) * $pricing['output_per_million']) / 1000000 * $pricing['usd_to_gbp'], 10);
}

function captive_memory_inference_windows(PDO $db): array
{
    $windows = [];
    foreach (['hour' => 'UTC_TIMESTAMP() - INTERVAL 1 HOUR', 'day' => 'UTC_DATE()', 'month' => "DATE_FORMAT(UTC_DATE(), '%Y-%m-01')"] as $key => $start) {
        $row = $db->query("SELECT COUNT(*) AS requests,
            COALESCE(SUM(COALESCE(actual_gbp,estimated_gbp)),0) AS estimated_gbp,
            COALESCE(SUM(IF(actual_gbp IS NULL,estimated_gbp,0)),0) AS uncertain_gbp
            FROM memory_formation_inference_attempts WHERE provider = 'deepseek' AND created_at >= {$start}")->fetch(PDO::FETCH_ASSOC);
        $windows[$key] = ['requests' => (int)$row['requests'], 'estimated_gbp' => (float)$row['estimated_gbp'], 'uncertain_gbp' => (float)$row['uncertain_gbp']];
    }
    return $windows;
}

function captive_memory_inference_cap_reason(array $settings, array $windows, int $active, float $estimate): ?string
{
    if ($active >= $settings['concurrency']) return 'concurrency_full';
    foreach (['hour', 'day', 'month'] as $key) {
        if ($windows[$key]['requests'] >= $settings['requests_' . $key]) return $key . '_request_cap';
        if ($windows[$key]['estimated_gbp'] + $estimate > $settings['gbp_' . $key] + 0.00000000001) return $key . '_spend_cap';
    }
    return null;
}

function captive_memory_inference_job_lock(PDO $db, array $input): array
{
    $id = captive_memory_inference_int($input, 'job_id', 1, PHP_INT_MAX);
    captive_memory_inference_token($input['claim_token'] ?? null);
    $read = $db->prepare("SELECT *, started_at >= NOW(3) - INTERVAL 10 MINUTE AS claim_live
        FROM autobiographical_memory_formation_queue WHERE id = ? FOR UPDATE");
    $read->execute([$id]);
    $job = $read->fetch(PDO::FETCH_ASSOC);
    if (!$job) throw new InvalidArgumentException('unknown formation job');
    return $job;
}

function captive_memory_inference_reserve(PDO $db, array $input): array
{
    $job = captive_memory_inference_job_lock($db, $input);
    $settings = captive_memory_inference_lock($db);
    $pricing = captive_memory_inference_config()['pricing'];
    $token = $input['claim_token'];
    $read = $db->prepare('SELECT * FROM memory_formation_inference_attempts WHERE claim_token = ? FOR UPDATE');
    $read->execute([$token]);
    if ($existing = $read->fetch(PDO::FETCH_ASSOC)) {
        if ((int)$existing['queue_id'] !== (int)$job['id']) throw new InvalidArgumentException('formation request mismatch');
        return ['ok' => true, 'execute' => false, 'request_id' => $existing['request_id'], 'mode' => $existing['mode'],
            'provider' => $existing['provider'], 'configured_model' => $existing['configured_model'],
            'reason' => $existing['provider'] ? 'already_reserved' : $existing['reason'],
            'pricing' => json_decode($existing['pricing'], true, 32, JSON_THROW_ON_ERROR)];
    }
    $source = json_decode($job['source_payload'], true, 32, JSON_THROW_ON_ERROR);
    if ($job['status'] !== 'PROCESSING' || !$job['claim_live'] || !hash_equals((string)$job['claim_token'], $token)
        || !in_array($job['source_type'], ['POSTCARD', 'CY_REPLY'], true)
        || !preg_match('/\A[a-f0-9]{32}\z/', (string)$job['subject_visitor_id'])
        || $job['privacy_scope'] !== 'SENDER_RECALLABLE'
        || ($source['sourceVisibility'] ?? null) !== 'SENDER_RECALLABLE'
        || ($source['subjectVisitorId'] ?? null) !== $job['subject_visitor_id']
        || ($source['sourceType'] ?? null) !== $job['source_type'] || ($source['sourceId'] ?? null) !== $job['source_id']) {
        return ['ok' => true, 'execute' => false, 'request_id' => null, 'mode' => $settings['mode'], 'provider' => null,
            'configured_model' => $pricing['model'], 'reason' => 'claim_not_active', 'pricing' => $pricing];
    }
    $inputTokens = captive_memory_inference_int($input, 'input_tokens', 1, 10000000);
    $outputTokens = captive_memory_inference_int($input, 'max_output_tokens', 1, 1000000);
    $mode = $settings['mode'];
    $model = $pricing['model'];
    $provider = null;
    $reason = 'disabled';
    $estimate = 0.0;
    if ($mode === 'LOCAL') {
        $provider = 'ollama';
        $model = captive_memory_inference_model($input['local_model'] ?? 'local');
        $reason = 'local_selected';
    } elseif ($mode === 'DEEPSEEK') {
        $estimate = captive_memory_inference_cost($inputTokens, 0, $outputTokens, $pricing);
        // Expiration releases only the concurrency slot, never uncertain spend.
        $active = (int)$db->query("SELECT COUNT(*) FROM memory_formation_inference_attempts
            WHERE provider = 'deepseek' AND settled_at IS NULL AND created_at >= UTC_TIMESTAMP() - INTERVAL 30 MINUTE")->fetchColumn();
        $reason = ($input['cloud_available'] ?? false) !== true ? 'credentials_missing'
            : (($input['configured_model'] ?? '') !== $model ? 'model_mismatch'
                : captive_memory_inference_cap_reason($settings, captive_memory_inference_windows($db), $active, $estimate));
        if ($reason === null) { $provider = 'deepseek'; $reason = 'deepseek_active'; }
    }
    if ($provider !== 'deepseek') $estimate = 0.0;
    $request = bin2hex(random_bytes(16));
    $db->prepare('INSERT INTO memory_formation_inference_attempts
        (request_id,queue_id,claim_token,mode,provider,configured_model,status,reason,created_at,
         reserved_input_tokens,reserved_output_tokens,estimated_gbp,actual_gbp,pricing)
        VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),?,?,?,?,?)')->execute([
            $request, $job['id'], $token, $mode, $provider, $model, $provider ? 'reserved' : 'held', $reason,
            $inputTokens, $outputTokens, $estimate, $provider === 'deepseek' ? null : 0, json_encode($pricing, JSON_THROW_ON_ERROR),
        ]);
    return ['ok' => true, 'execute' => $provider !== null, 'request_id' => $request, 'mode' => $mode,
        'provider' => $provider, 'configured_model' => $model, 'reason' => $reason, 'pricing' => $pricing];
}

function captive_memory_inference_settle(PDO $db, array $input): array
{
    $job = captive_memory_inference_job_lock($db, $input);
    captive_memory_inference_lock($db);
    $request = captive_memory_inference_token($input['request_id'] ?? null);
    $read = $db->prepare('SELECT * FROM memory_formation_inference_attempts WHERE request_id = ? FOR UPDATE');
    $read->execute([$request]);
    $row = $read->fetch(PDO::FETCH_ASSOC);
    if (!$row || (int)$row['queue_id'] !== (int)$job['id'] || !hash_equals($row['claim_token'], $input['claim_token'])) {
        throw new InvalidArgumentException('formation request mismatch');
    }
    if (!$row['provider']) throw new InvalidArgumentException('held request was not admitted');
    if ($row['settled_at']) return ['ok' => true, 'settled' => true, 'duplicate' => true];
    $status = $input['status'] ?? '';
    if (!in_array($status, ['generated', 'failed', 'cancelled'], true)) throw new InvalidArgumentException('invalid status');
    $reason = captive_memory_inference_reason($input['reason'] ?? ($status === 'generated' ? 'generated' : 'provider_error'));
    $actualModel = isset($input['actual_model']) ? captive_memory_inference_model($input['actual_model']) : null;
    $latency = captive_memory_inference_int($input, 'latency_ms', 0, 86400000);
    $prompt = $output = $cached = $uncached = null;
    $actual = $row['provider'] === 'ollama' ? 0.0 : null;
    if (isset($input['usage'])) {
        if (!is_array($input['usage'])) throw new InvalidArgumentException('invalid usage');
        $usage = $input['usage'];
        $prompt = captive_memory_inference_int($usage, 'prompt_tokens', 0, 10000000);
        $output = captive_memory_inference_int($usage, 'completion_tokens', 0, 10000000);
        $cached = isset($usage['cached_tokens']) ? captive_memory_inference_int($usage, 'cached_tokens', 0, $prompt) : 0;
        $uncached = $prompt - $cached;
        $actual = $row['provider'] === 'ollama' ? 0.0 : captive_memory_inference_cost($uncached, $cached, $output, json_decode($row['pricing'], true, 32, JSON_THROW_ON_ERROR));
    }
    $db->prepare('UPDATE memory_formation_inference_attempts SET settled_at=UTC_TIMESTAMP(3),status=?,reason=?,actual_model=?,
        input_tokens=?,output_tokens=?,cached_tokens=?,uncached_tokens=?,actual_gbp=?,latency_ms=? WHERE request_id=?')
        ->execute([$status,$reason,$actualModel,$prompt,$output,$cached,$uncached,$actual,$latency,$request]);
    return ['ok' => true, 'settled' => true, 'duplicate' => false];
}

function captive_memory_inference_completion_lock(PDO $db, array $job, string $token, string $request, string $category): array
{
    captive_memory_inference_token($request);
    captive_memory_inference_lock($db);
    $read = $db->prepare('SELECT * FROM memory_formation_inference_attempts WHERE request_id = ? FOR UPDATE');
    $read->execute([$request]);
    $row = $read->fetch(PDO::FETCH_ASSOC);
    if (!$row || (int)$row['queue_id'] !== (int)$job['id'] || !hash_equals($row['claim_token'], $token)) {
        throw new InvalidArgumentException('formation accounting claim mismatch');
    }
    if (!$row['provider'] && in_array($category, ['CREATE','UPDATE','RESOLVE','NOTHING','INVALID'], true)) {
        throw new InvalidArgumentException('held inference has no model decision');
    }
    return $row;
}

function captive_memory_inference_complete(PDO $db, string $request, string $category, ?string $rejection, string $outcome): void
{
    $db->prepare('UPDATE memory_formation_inference_attempts SET completed_at=UTC_TIMESTAMP(3),decision=?,rejection_code=?,application_outcome=?
        WHERE request_id=? AND completed_at IS NULL')->execute([$category,$rejection,$outcome,$request]);
}

function captive_memory_inference_same_origin(array $server): bool
{
    if (strtolower(trim(explode(';', $server['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') return false;
    if (isset($server['HTTP_SEC_FETCH_SITE']) && $server['HTTP_SEC_FETCH_SITE'] !== 'same-origin') return false;
    $parts = parse_url($server['HTTP_ORIGIN'] ?? $server['HTTP_REFERER'] ?? '');
    if (!$parts || !isset($parts['scheme'], $parts['host']) || !in_array($parts['scheme'], ['https','http'], true)) return false;
    if ($parts['scheme'] !== 'https' && !in_array($parts['host'], ['127.0.0.1','localhost','[::1]'], true)) return false;
    $authority = strtolower($parts['host']) . (isset($parts['port']) ? ':' . $parts['port'] : '');
    return hash_equals(strtolower($server['HTTP_HOST'] ?? ''), $authority);
}

function captive_memory_inference_view(PDO $db, string $range, bool $admin): array
{
    $ranges = ['1H'=>3600, '24H'=>86400, '30D'=>2592000, 'ALL'=>null];
    if (!array_key_exists($range, $ranges)) throw new InvalidArgumentException('invalid range');
    $now = time();
    $start = $ranges[$range] === null
        ? (int)$db->query("SELECT COALESCE(TIMESTAMPDIFF(SECOND,'1970-01-01',MIN(created_at)),TIMESTAMPDIFF(SECOND,'1970-01-01',UTC_TIMESTAMP())) FROM memory_formation_inference_attempts")->fetchColumn()
        : $now - $ranges[$range];
    $bucket = max(1, (int)ceil(($now - $start + 1) / 120));
    $since = gmdate('Y-m-d H:i:s', $start);
    $read = $db->prepare("SELECT COUNT(provider) AS requests,
        COALESCE(SUM(provider='deepseek'),0) AS cloud_requests, COALESCE(SUM(provider='ollama'),0) AS local_requests,
        COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(SUM(cached_tokens),0) AS cached_tokens, COALESCE(SUM(uncached_tokens),0) AS uncached_tokens,
        COALESCE(SUM(COALESCE(actual_gbp,estimated_gbp)),0) AS estimated_gbp,
        COALESCE(SUM(IF(actual_gbp IS NULL,estimated_gbp,0)),0) AS uncertain_gbp,
        COALESCE(SUM(latency_ms),0) AS latency_ms, COALESCE(AVG(latency_ms),0) AS mean_latency_ms,
        COALESCE(SUM(status IN ('failed','cancelled') OR (provider IS NOT NULL AND decision IN ('ERROR','TIMEOUT','PREEMPTED','CONFLICT'))),0) AS failures,
        COALESCE(SUM(decision='CONFLICT'),0) AS application_conflicts, COALESCE(SUM(status='held'),0) AS held,
        COALESCE(SUM(decision='CREATE'),0) AS formed, COALESCE(SUM(decision='UPDATE'),0) AS updated,
        COALESCE(SUM(decision='RESOLVE'),0) AS resolved, COALESCE(SUM(decision='NOTHING'),0) AS nothing,
        COALESCE(SUM(decision='INVALID'),0) AS invalid
        FROM memory_formation_inference_attempts WHERE created_at >= ?");
    $read->execute([$since]);
    $totals = array_map(static fn($value) => (float)$value, $read->fetch(PDO::FETCH_ASSOC));
    $read = $db->prepare("SELECT FLOOR((TIMESTAMPDIFF(SECOND,'1970-01-01',created_at)-{$start})/{$bucket}) AS bucket,
        COUNT(provider) AS requests, COALESCE(SUM(COALESCE(actual_gbp,estimated_gbp)),0) AS estimated_gbp,
        COALESCE(SUM(IF(actual_gbp IS NULL,estimated_gbp,0)),0) AS uncertain_gbp,
        COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens
        FROM memory_formation_inference_attempts WHERE created_at >= ? GROUP BY bucket ORDER BY bucket");
    $read->execute([$since]);
    $buckets = [];
    foreach ($read->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $at = $start + (int)$row['bucket'] * $bucket;
        unset($row['bucket']);
        $buckets[] = ['at'=>gmdate('Y-m-d\TH:i:s\Z',$at)] + array_map(static fn($value)=>(float)$value,$row);
    }
    $settings = captive_memory_inference_settings(json_decode($db->query('SELECT settings FROM memory_formation_inference_settings WHERE id=1')->fetchColumn(),true,32,JSON_THROW_ON_ERROR));
    $read = $db->prepare('SELECT provider,configured_model,actual_model,reason FROM memory_formation_inference_attempts WHERE mode=? ORDER BY created_at DESC,request_id DESC LIMIT 1');
    $read->execute([$settings['mode']]);
    $latest = $read->fetch(PDO::FETCH_ASSOC) ?: [];
    $status = ['mode'=>$settings['mode'], 'provider'=>$latest['provider'] ?? null,
        'configured_model'=>$latest['configured_model'] ?? ($settings['mode'] === 'LOCAL' ? 'local' : captive_memory_inference_config()['pricing']['model']),
        'actual_model'=>$latest['actual_model'] ?? null, 'reason'=>$latest['reason'] ?? 'no_requests'];
    if ($settings['mode'] === 'OFF') $status = array_replace($status,['provider'=>null,'reason'=>'disabled']);
    if ($settings['mode'] === 'LOCAL') $status = array_replace($status,['provider'=>'ollama','reason'=>'local_selected']);
    $pending = $db->query("SELECT COUNT(*) AS count, MAX(TIMESTAMPDIFF(SECOND,queued_at,NOW(3))) AS age
        FROM autobiographical_memory_formation_queue WHERE source_type IN ('POSTCARD','CY_REPLY')
        AND subject_visitor_id IS NOT NULL AND privacy_scope='SENDER_RECALLABLE' AND status IN ('PENDING','PROCESSING','RETRYABLE')")->fetch(PDO::FETCH_ASSOC);
    // Public view contains only aggregates and safe operational/model labels.
    return ['ok'=>true,'can_admin'=>$admin,'settings'=>$settings,'pricing'=>captive_memory_inference_config()['pricing'],
        'status'=>$status,'range'=>$range,'start'=>gmdate('Y-m-d\TH:i:s\Z',$start),'end'=>gmdate('Y-m-d\TH:i:s\Z',$now),
        'totals'=>$totals,'windows'=>captive_memory_inference_windows($db),'buckets'=>$buckets,
        'pending_count'=>(int)$pending['count'],'oldest_pending_age_seconds'=>$pending['age'] === null ? null : max(0,(int)$pending['age'])];
}
