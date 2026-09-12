<?php
declare(strict_types=1);

function captive_json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function captive_error_response(string $message, int $status = 400): never
{
    captive_json_response(['ok' => false, 'error' => $message], $status);
}

function captive_client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function captive_public_event_payload(string $kind, mixed $payload, bool $includeDreamDiagnostics = false): mixed
{
    if (($kind === 'dream' || $kind === 'dream_inspection') && is_array($payload)) {
        if ($includeDreamDiagnostics) {
            return $payload;
        }
        // Dream generation keeps a compact inspection packet beside the public
        // expression. Ordinary visitors receive only presentation fields. The
        // owner-only Raw request may opt into the diagnostic packet explicitly.
        $publicKeys = $kind === 'dream'
            ? [
                'id',
                'sleep_period_id',
                'state',
                'classification',
                'fragments',
                'lucid',
                'drawing_id',
                'drawing_version',
                'output_validation',
                'output_schema',
            ]
            : ['id', 'sleep_period_id', 'output_validation'];
        return array_intersect_key($payload, array_flip($publicKeys));
    }
    if ($kind === 'gen' && is_array($payload)) {
        // A generation row also stores the full prompt/debug inspection used by
        // the runner's private diagnostics. Repeating those hundreds of KB on
        // the visitor feed made ordinary day loads and catch-up pages exhaust
        // PHP memory. The public UI consumes only this compact telemetry.
        $publicKeys = [
            'tokens_in',
            'tokens_out',
            'prompt_tok_s',
            'gen_tok_s',
            'ttft_ms',
            'total_ms',
            'load_ms',
            'mode',
            'anger',
            'expressed',
            'ctx_chars',
            'duty',
            'next_idle_ms',
            'cadence_ms',
            'idle_reason',
            'ahead_chars',
            'threads',
            'provider',
            'model',
            'num_ctx',
            'inbox_ok',
            'tempo_ok',
            'last_error',
            'form',
            'temperature',
            'top_p',
            'repeat_penalty',
            'num_predict',
            'token_limited',
        ];
        return array_intersect_key($payload, array_flip($publicKeys));
    }
    if ($kind === 'vitals' && is_array($payload) && isset($payload['soma']) && is_array($payload['soma'])) {
        unset($payload['soma']['physiologicalSatietyInspection']);
    }
    return $payload;
}

function captive_require_ingest_key(): void
{
    $key = $_SERVER['HTTP_X_CY_KEY'] ?? '';
    if (!hash_equals(captive_ingest_key(), $key)) {
        captive_error_response('unauthorized', 401);
    }
}
