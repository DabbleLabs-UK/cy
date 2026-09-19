<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$migration = file_get_contents($root . '/sql/018_bounded_soma_telemetry.sql');
$schema = file_get_contents($root . '/sql/schema.sql');
$ingest = file_get_contents($root . '/public/api/ingest.php');
$feeding = file_get_contents($root . '/public/api/feeding.php');

if (!is_string($migration) || !str_contains($migration, 'CREATE TABLE IF NOT EXISTS soma_diagnostic_latest')) {
    throw new RuntimeException('migration 018 must create the latest-only diagnostic table');
}
if (!is_string($schema) || !str_contains($schema, 'CREATE TABLE soma_diagnostic_latest')) {
    throw new RuntimeException('fresh schema must include the latest-only diagnostic table');
}
if (!is_string($ingest)
    || !str_contains($ingest, "if (\$kind === 'soma_diagnostic')")
    || !str_contains($ingest, 'ON DUPLICATE KEY UPDATE')
    || !str_contains($ingest, 'continue;')) {
    throw new RuntimeException('Soma diagnostics must be privately upserted and excluded from events');
}
if (!is_string($feeding)
    || !str_contains($feeding, 'FROM soma_diagnostic_latest')
    || !str_contains($feeding, 'physiologicalSatietyInspection')) {
    throw new RuntimeException('owner feeding inspection must consume the latest diagnostic snapshot');
}

echo "soma storage routing: ok\n";
