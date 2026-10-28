<?php
declare(strict_types=1);
// Frozen defect mechanism from the stopped rollout, not a deployment tool.
$path = $argv[1] ?? getenv('OLD_LIBRARY');
var_dump(opcache_compile_file($path));
var_dump(function_exists('captive_memory_claim_surfacing'));
require $path;
