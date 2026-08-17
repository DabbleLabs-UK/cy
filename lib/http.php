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

function captive_require_ingest_key(): void
{
    $key = $_SERVER['HTTP_X_CAPTIVE_KEY'] ?? '';
    if (!hash_equals(captive_ingest_key(), $key)) {
        captive_error_response('unauthorized', 401);
    }
}
