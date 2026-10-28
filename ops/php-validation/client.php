<?php
declare(strict_types=1);
// No application bootstrap, DB, provider, publication or service-control calls.
function cy_php_validation_request(string $probe, string $phase, string $socket, ?callable $transport = null): array
{
    $plan = json_decode(file_get_contents($probe . '/validation-plan.json'), true, 512, JSON_THROW_ON_ERROR);
    if (($plan['schema'] ?? null) !== 'cy.php-validation.v1'
        || ($phase !== 'preflight' && !isset($plan['checks'][$phase]))) throw new RuntimeException('Unknown validation phase');
    if ($transport === null) {
        $command = ['/usr/bin/cgi-fcgi', '-bind', '-connect', $socket];
        $pipes = [];
        $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, [
            'SCRIPT_FILENAME' => $probe . '/probe.php', 'SCRIPT_NAME' => '/cy-private-rollout-check',
            'REQUEST_METHOD' => 'GET', 'CY_PHASE' => $phase,
        ]);
        if (!is_resource($process)) throw new RuntimeException('Cannot invoke FPM check');
        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]); fclose($pipes[1]);
        $stderr = stream_get_contents($pipes[2]); fclose($pipes[2]);
        $code = proc_close($process);
        if ($code !== 0 || trim($stderr) !== '') throw new RuntimeException('FPM check transport failed');
    } else {
        $stdout = $transport($phase);
    }
    $parts = preg_split('/\r?\n\r?\n/', $stdout, 2);
    if (count($parts) !== 2 || preg_match('/^Status:\s*(?!200\b)\d{3}/im', $parts[0])) {
        throw new RuntimeException('FPM check HTTP failure');
    }
    $result = json_decode(trim($parts[1]), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($result) || ($result['ok'] ?? null) !== true || ($result['phase'] ?? null) !== $phase) {
        throw new RuntimeException('Invalid FPM check receipt');
    }
    if ($phase !== 'preflight') {
        $entry = $plan['checks'][$phase];
        $flag = $entry['action'] === 'load' ? 'loaded' : 'compiled';
        if (($result['action'] ?? null) !== $entry['action'] || ($result[$flag] ?? null) !== true
            || ($result['sha256'] ?? null) !== $entry['sha256']) throw new RuntimeException('FPM validation mismatch');
    }
    return $result;
}

function cy_php_validation_plan(array $files, string $stage, string $root, array $loads): array
{
    $checks = [];
    foreach ($files as $i => $file) {
        if (!str_ends_with($file['path'], '.php')) continue;
        $checks['staged-' . $i] = ['path' => $stage . '/payload/' . $file['path'],
            'sha256' => $file['newSha256'], 'action' => 'compile'];
        $checks['live-' . $i] = ['path' => $root . $file['path'], 'sha256' => $file['newSha256'],
            'action' => isset($loads[$file['path']]) ? 'load' : 'compile',
            ...($loads[$file['path']] ?? [])];
    }
    return ['schema' => 'cy.php-validation.v1', 'checks' => $checks];
}

function cy_php_validate_staged(array $files, string $probe, string $socket, ?callable $transport = null): array
{
    $receipts = [cy_php_validation_request($probe, 'preflight', $socket, $transport)];
    foreach ($files as $i => $file) {
        if (str_ends_with($file['path'], '.php')) {
            // Each call is a fresh FastCGI request, never a same-request loop
            // over includes/compiles. Run all of these before any publication.
            $receipts[] = cy_php_validation_request($probe, 'staged-' . $i, $socket, $transport);
        }
    }
    return $receipts;
}
