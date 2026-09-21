<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$migration = file_get_contents($root . '/sql/018_bounded_soma_telemetry.sql');
$schema = file_get_contents($root . '/sql/schema.sql');
$ingest = file_get_contents($root . '/public/api/ingest.php');
$feeding = file_get_contents($root . '/public/api/feeding.php');
$latestMigration = file_get_contents($root . '/sql/019_latest_live_vitals.sql');
$compactMigration = file_get_contents($root . '/sql/020_compact_vitals_history.sql');
$anxietyIndexMigration = file_get_contents($root . '/sql/021_environment_events_anxiety_index.sql');
$stream = file_get_contents($root . '/public/api/stream.php');
require_once $root . '/lib/soma-history.php';

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
if (!is_string($compactMigration)
    || !str_contains($compactMigration, 'CREATE TABLE IF NOT EXISTS vitals_history')
    || !str_contains($compactMigration, 'schema_version')
    || !str_contains($compactMigration, 'payload')) {
    throw new RuntimeException('migration 020 must create compact historical vitals');
}
if (!str_contains($schema, 'CREATE TABLE vitals_history')) {
    throw new RuntimeException('fresh schema must include compact historical vitals');
}
if (!str_contains($ingest, 'VITALS_HISTORY_INTERVAL_MS = 60000')
    || !str_contains($ingest, 'INSERT INTO live_vitals_latest')
    || !str_contains($ingest, 'INSERT INTO vitals_history')
    || !str_contains($ingest, 'captive_compact_vitals_history_json')
    || !str_contains($ingest, "if (\$kind === 'vitals')")) {
    throw new RuntimeException('rich live vitals must be upserted and compact history sampled once per minute');
}
$vitalsBlockStart = strpos($ingest, "if (\$kind === 'vitals')");
$genericInsertStart = strpos($ingest, "\$insert->bindValue(':ts'", $vitalsBlockStart ?: 0);
$vitalsBlock = $vitalsBlockStart !== false && $genericInsertStart !== false
    ? substr($ingest, $vitalsBlockStart, $genericInsertStart - $vitalsBlockStart)
    : '';
if (!str_contains($vitalsBlock, 'continue;')) {
    throw new RuntimeException('rich vitals must always bypass the append-only events insert');
}
if (!is_string($stream)
    || !str_contains($stream, "'live_vitals' => \$liveVitals")
    || !str_contains($stream, 'captive_latest_vitals_row')) {
    throw new RuntimeException('public stream must carry the current latest-only vitals reading');
}

// Migration 021: environment_events.record can average hundreds of KB/row, so
// the operational-Anxiety transition query must read the small generated/
// indexed projection, never JSON_EXTRACT the raw record inline (that inline
// form is exactly what made a 7-day transition query take ~20-27s despite the
// table holding only ~2,500 rows).
if (!is_string($anxietyIndexMigration)
    || !str_contains($anxietyIndexMigration, 'ADD COLUMN operational_anxiety_status')
    || !str_contains($anxietyIndexMigration, 'GENERATED ALWAYS AS')
    || !str_contains($anxietyIndexMigration, 'ADD INDEX idx_environment_anxiety (occurred_at, operational_anxiety_status)')) {
    throw new RuntimeException('migration 021 must add the generated/indexed Anxiety-status projection');
}
// Regression guard: VIRTUAL was tried first and measured to reproducibly
// return NULL for every row when read back through this exact covering
// index on this MariaDB version (11.8.9) - only STORED returns the correct
// persisted value from an index-only scan. Do not revert this to VIRTUAL
// even though it would otherwise be the cheaper migration to apply.
if (!str_contains($anxietyIndexMigration, ') STORED') || str_contains($anxietyIndexMigration, ') VIRTUAL')) {
    throw new RuntimeException('migration 021 generated column must be STORED, not VIRTUAL - VIRTUAL silently returns NULL through this covering index on this MariaDB version');
}
if (!str_contains($schema, 'operational_anxiety_status')
    || !str_contains($schema, 'idx_environment_anxiety')) {
    throw new RuntimeException('fresh schema must include the generated/indexed Anxiety-status projection');
}
if (!str_contains($schema, ') STORED,') || str_contains($schema, ') VIRTUAL,')) {
    throw new RuntimeException('fresh schema generated column must be STORED, not VIRTUAL - see migration 021');
}
$transitionQuery = captive_operational_anxiety_transition_query();
if (!str_contains($transitionQuery, 'FROM environment_events FORCE INDEX (idx_environment_anxiety)')
    || !str_contains($transitionQuery, 'operational_anxiety_status AS value')
    || !str_contains($transitionQuery, 'operational_anxiety_status IS NOT NULL')) {
    throw new RuntimeException('Anxiety transition query must read the generated column via its covering index');
}
if (str_contains($transitionQuery, 'JSON_EXTRACT(record') || str_contains($transitionQuery, 'JSON_UNQUOTE')) {
    throw new RuntimeException('Anxiety transition query must not JSON_EXTRACT the raw record column inline');
}
$historyEndpoint = file_get_contents($root . '/public/api/soma-history.php');
if (!is_string($historyEndpoint)
    || !str_contains($historyEndpoint, 'captive_operational_anxiety_transition_query()')
    || str_contains($historyEndpoint, "JSON_EXTRACT(record, '\$.current_defensive_context.operationalAnxiety.status')")) {
    throw new RuntimeException('soma-history.php must call the shared indexed transition query, not inline JSON_EXTRACT');
}

echo "soma storage routing: ok\n";
