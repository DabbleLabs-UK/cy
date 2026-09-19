<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$migration = file_get_contents($root . '/sql/018_bounded_soma_telemetry.sql');
$schema = file_get_contents($root . '/sql/schema.sql');
$ingest = file_get_contents($root . '/public/api/ingest.php');
$feeding = file_get_contents($root . '/public/api/feeding.php');
$latestMigration = file_get_contents($root . '/sql/019_latest_live_vitals.sql');
$stream = file_get_contents($root . '/public/api/stream.php');

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
if (!is_string($latestMigration)
    || !str_contains($latestMigration, 'CREATE TABLE IF NOT EXISTS live_vitals_latest')) {
    throw new RuntimeException('migration 019 must create the latest-only live vitals table');
}
if (!is_string($schema) || !str_contains($schema, 'CREATE TABLE live_vitals_latest')) {
    throw new RuntimeException('fresh schema must include the latest-only live vitals table');
}
if (!str_contains($ingest, 'VITALS_HISTORY_INTERVAL_MS = 60000')
    || !str_contains($ingest, 'INSERT INTO live_vitals_latest')
    || !str_contains($ingest, "if (\$kind === 'vitals')")) {
    throw new RuntimeException('live vitals must be upserted and history limited to one sample per minute');
}
if (!is_string($stream)
    || !str_contains($stream, "'live_vitals' => \$liveVitals")
    || !str_contains($stream, 'captive_latest_vitals_row')) {
    throw new RuntimeException('public stream must carry the current latest-only vitals reading');
}

echo "soma storage routing: ok\n";
