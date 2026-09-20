<?php
declare(strict_types=1);

// replay_workbench.php - thin admin-gated bridge from the PHP web app to the
// existing deterministic Node replay engine (runner/soma-replay-api-cli.mjs).
//
// The replay workbench replays only the six synthetic golden fixtures already
// checked into the repo (runner/soma-replay-fixtures.js) - no live model, no
// DELL/LENO compute, no production database, no network. That means it can
// run entirely on this box: PHP shells `node` out per admin request rather
// than a persistent Node service needing its own port, process manager or
// Caddy route. See docs/dev-admin-ui-hosting.md for the full convention this
// establishes for future CY admin/debug UIs.
//
// Every function here is called ONLY after the caller has already confirmed
// captive_is_admin($db) - these do not check admin themselves, matching every
// other admin-gated endpoint in public/api/*.php (the gate is the caller's
// job, enforced once, right after the DB connects).

// The Node CLI subprocess must produce its JSON body within this many
// seconds. The real replay computation is small in-memory work over six
// fixtures (well under a second locally); this ceiling exists only to turn a
// wedged/missing `node` into a bounded failure instead of a hung PHP-FPM
// worker.
const CY_REPLAY_NODE_TIMEOUT_SECONDS = 10;

require_once __DIR__ . '/db.php'; // for captive_config()

// Reads the Node binary path from config (see config/config.sample.php),
// falling back to bare 'node' (relies on PHP-FPM's own PATH - see the config
// comment for why an absolute path is usually needed on a real deploy). The
// replay bridge does not otherwise need DB credentials, so a missing/invalid
// config.php degrades to the 'node' default rather than blocking the bridge -
// this is the only config key this file reads.
function captive_replay_node_bin(): string
{
    try {
        $cfg = captive_config();
    } catch (Throwable $e) {
        return 'node';
    }
    $bin = $cfg['replay_node_bin'] ?? 'node';
    return is_string($bin) && $bin !== '' ? $bin : 'node';
}

// Runs runner/soma-replay-api-cli.mjs with $args and returns its raw stdout
// (a JSON string) on success. Throws RuntimeException with a message safe to
// show the admin (the CLI's own {"error": "..."} on failure, or a clear
// environment-level message) on any failure - never silently returns partial
// or wrong data.
function captive_replay_node(array $args): string
{
    $cliPath = __DIR__ . '/../runner/soma-replay-api-cli.mjs';
    if (!file_exists($cliPath)) {
        throw new RuntimeException('replay engine script is missing on this deploy: ' . $cliPath);
    }
    $cmd = array_merge([captive_replay_node_bin(), $cliPath], $args);
    $escaped = implode(' ', array_map('escapeshellarg', $cmd));
    $descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $process = @proc_open($escaped, $descriptors, $pipes);
    if (!\is_resource($process)) {
        throw new RuntimeException('replay engine could not be started - is node installed and on PHP-FPM\'s PATH? See replay_node_bin in config/config.php.');
    }
    stream_set_timeout($pipes[1], CY_REPLAY_NODE_TIMEOUT_SECONDS);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);
    if ($exitCode !== 0) {
        $message = trim($stderr) !== '' ? $stderr : 'replay engine failed with no error output';
        $decoded = json_decode($message, true);
        throw new RuntimeException(is_array($decoded) && isset($decoded['error']) ? (string)$decoded['error'] : $message);
    }
    return $stdout === false ? '' : $stdout;
}

// Reads a static workbench source file (runner/replay-viewer/$sourceRelativePath)
// and applies $replacements (exact-string search/replace pairs). Pure: no
// admin check, no header/exit, so it is directly unit-testable - the caller
// (public/replay/*.php) does the admin check and HTTP output.
function captive_replay_asset_content(string $sourceRelativePath, array $replacements = []): string
{
    $path = __DIR__ . '/../runner/replay-viewer/' . $sourceRelativePath;
    $content = @file_get_contents($path); // false checked explicitly below; a missing asset is an expected, handled case
    if ($content === false) {
        throw new RuntimeException('replay workbench asset is missing on this deploy: ' . $sourceRelativePath);
    }
    foreach ($replacements as $search => $replace) {
        $content = str_replace($search, $replace, $content);
    }
    return $content;
}
