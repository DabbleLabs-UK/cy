<?php
declare(strict_types=1);
// Private FastCGI/CLI probe, never a public application endpoint.
// Exactly one compile OR one load per request. Never compile then include.
header('Content-Type: application/json');
header('Cache-Control: no-store');
$phase = $_SERVER['CY_PHASE'] ?? 'preflight';
$plan = json_decode(file_get_contents(__DIR__ . '/validation-plan.json'), true, 512, JSON_THROW_ON_ERROR);
if (($plan['schema'] ?? null) !== 'cy.php-validation.v1') throw new RuntimeException('Invalid validation plan');
$result = ['ok' => true, 'phase' => $phase, 'php' => PHP_VERSION];
foreach (['opcache.enable', 'opcache.validate_timestamps', 'opcache.revalidate_freq', 'opcache.file_update_protection'] as $key) {
    $result[$key] = ini_get($key);
}
if (!filter_var(ini_get('opcache.enable'), FILTER_VALIDATE_BOOLEAN)
    || !filter_var(ini_get('opcache.validate_timestamps'), FILTER_VALIDATE_BOOLEAN)) {
    throw new RuntimeException('Incompatible cache configuration');
}
if ($phase !== 'preflight') {
    $entry = $plan['checks'][$phase] ?? null;
    if (!is_array($entry) || !in_array($entry['action'] ?? null, ['compile', 'load'], true)
        || !is_string($entry['path'] ?? null) || !is_file($entry['path'])
        || preg_match('/^[a-f0-9]{64}$/D', $entry['sha256'] ?? '') !== 1) {
        throw new RuntimeException('Invalid check');
    }
    $path = realpath($entry['path']);
    if (hash_file('sha256', $path) !== $entry['sha256']) throw new RuntimeException('Source hash mismatch');
    // Invalidation does not load declarations. A failed invalidation can mean
    // the path was not cached; compilation/loading below is still mandatory.
    $result['invalidated'] = opcache_invalidate($path, true);
    $result['action'] = $entry['action'];
    if ($entry['action'] === 'compile') {
        if (!opcache_compile_file($path)) throw new RuntimeException('Serving compilation failed');
        $result['compiled'] = true;
    } else {
        // PHP compiles the file as part of this single include. Dependencies
        // retain their normal require_once semantics; no handler is executed.
        // Only reviewed declaration-only library entry points belong here.
        ob_start();
        try {
            require_once $path;
            if (ob_get_length() !== 0) throw new RuntimeException('Unexpected library output');
        } finally {
            ob_end_clean();
        }
        foreach ($entry['functions'] ?? [] as $name) {
            if (!function_exists($name)) throw new RuntimeException('Missing required function');
        }
        foreach ($entry['classes'] ?? [] as $name) {
            if (!class_exists($name, false)) throw new RuntimeException('Missing required class');
        }
        $result['loaded'] = true;
    }
    if (hash_file('sha256', $path) !== $entry['sha256']) throw new RuntimeException('Source changed during check');
    $result['sha256'] = $entry['sha256'];
}
echo json_encode($result, JSON_THROW_ON_ERROR), PHP_EOL;
