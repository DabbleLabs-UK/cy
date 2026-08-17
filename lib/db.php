<?php
declare(strict_types=1);

function captive_config(): array
{
    static $config = null;
    if ($config === null) {
        $path = __DIR__ . '/../config/config.php';
        if (!file_exists($path)) {
            throw new RuntimeException('Missing config/config.php - copy config/config.sample.php and fill in real values');
        }
        $config = require $path;
    }
    return $config;
}

function captive_db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $cfg = captive_config()['db'];
        $dsn = sprintf(
            'mysql:host=%s;dbname=%s;charset=%s',
            $cfg['host'],
            $cfg['name'],
            $cfg['charset'] ?? 'utf8mb4'
        );
        $pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    return $pdo;
}

function captive_ingest_key(): string
{
    return captive_config()['ingest_key'];
}

function captive_cookie_secret(): string
{
    $cfg = captive_config();
    // Fall back to the ingest key if a dedicated cookie secret is not set, so an
    // older config.php still boots (cookies just share the secret).
    return $cfg['cookie_secret'] ?? $cfg['ingest_key'];
}
