<?php
declare(strict_types=1);

// Copy this file to config/config.php and fill in real values.
// config/config.php is gitignored -- never commit real credentials.

return [
    'db' => [
        'host' => '127.0.0.1',
        'name' => 'cy',
        'user' => 'cy',
        'pass' => 'CHANGE_ME',
        'charset' => 'utf8mb4',
    ],

    // Shared secret DELL sends as the X-Cy-Key header on ingest.php / inbox.php.
    // Generate a long random value, e.g. bin2hex(random_bytes(32)).
    'ingest_key' => 'CHANGE_ME_LONG_RANDOM_KEY',

    // Secret used to sign the httpOnly visitor cookie (HMAC). Rotating this
    // invalidates all existing visitor cookies (people become strangers again).
    // Generate a long random value, e.g. bin2hex(random_bytes(32)).
    'cookie_secret' => 'CHANGE_ME_LONG_RANDOM_KEY_2',

    // Optional. Path to the `node` binary used by public/replay/api.php to run
    // the Soma replay workbench (see lib/replay_workbench.php and
    // docs/dev-admin-ui-hosting.md). Defaults to 'node', which only works if
    // PHP-FPM's own PATH includes it - PHP-FPM pools often run with a much
    // narrower PATH than an interactive shell, so on a fresh vps3 deploy this
    // very likely needs to be an absolute path, e.g. '/usr/bin/node' (check
    // with `which node` as the same user/pool PHP-FPM runs as). Admin-only and
    // synthetic-fixture-only - never touches production data.
    'replay_node_bin' => 'node',
];
