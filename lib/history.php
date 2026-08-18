<?php
declare(strict_types=1);

// history.php - the day-index rollup engine (HISTORY MODE, stage 1).
//
// Reads the append-only `events` log and maintains two aggregate tables
// (history_days, history_hours) plus a watermark (history_cursor). It is:
//
//   - INCREMENTAL: history_rollup() only processes events with seq above the
//     watermark, then advances it. Safe and cheap to run on a cron.
//   - RE-RUNNABLE: running it again with no new events is a no-op.
//   - REBUILDABLE: history_backfill() truncates the index, resets the watermark
//     to 0, and rebuilds the whole thing from the existing event history.
//
// It NEVER writes to or deletes from `events`. The event log is the project's
// entire history; this layer is strictly derived and read-only against it.
//
// DOMINANT-MOOD REDUCTION (documented, so stage 2 can trust it):
//   Every `vitals` event carries the nine mental axes (0..1). For a window we keep
//   a running sum and peak of each axis across all its vitals samples, so mean =
//   sum/count. The window's "dominant mood" is the EMOTIONAL axis with the highest
//   mean - i.e. the feeling that ran strongest on average across the window.
//   `lucidity` is recorded (mean+peak) but excluded from the dominant pick: it is a
//   clarity axis, not an emotional colour, and would otherwise dominate every band.
//   Each emotional axis maps to a fixed tint (HISTORY_MOOD_TINTS) used by the spine.

require_once __DIR__ . '/db.php';

// All nine mental axes carried on a `vitals` payload. Recorded (mean+peak) for
// every window as the "notable axes".
const HISTORY_MENTAL_AXES = [
    'anxiety', 'stress', 'despair', 'hope', 'lucidity',
    'agitation', 'dissociation', 'anger', 'longing',
];

// The subset eligible to be a window's dominant mood (lucidity excluded - see head).
const HISTORY_EMOTIONAL_AXES = [
    'anxiety', 'stress', 'despair', 'hope',
    'agitation', 'dissociation', 'anger', 'longing',
];

// Tint per mood, for the spine bands. Muted, prison-palette; one hex per axis.
const HISTORY_MOOD_TINTS = [
    'anxiety'      => '#9aa63d',
    'stress'       => '#c8622d',
    'despair'      => '#3b4a63',
    'hope'         => '#d9a441',
    'agitation'    => '#d1442f',
    'dissociation' => '#6b6076',
    'anger'        => '#a52a2a',
    'longing'      => '#7a5a6d',
    'lucidity'     => '#7fbfc7',
];

// Neutral tint when a window has no vitals samples to colour it.
const HISTORY_TINT_NONE = '#4a4a52';

// How many events to fold per transaction. Bounds memory and lock duration on a
// full backfill of a large log.
const HISTORY_BATCH = 4000;

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

// Split an events.ts string ("YYYY-MM-DD HH:MM:SS.mmm", the runner's wall-clock
// London time) into [date, hour] by substring - no timezone reinterpretation, so
// a band lines up exactly with the clock the writing happened on.
function history_bucket(string $ts): array
{
    $date = substr($ts, 0, 10);
    $hour = (int)substr($ts, 11, 2);
    if ($hour < 0 || $hour > 23) {
        $hour = 0;
    }
    return [$date, $hour];
}

// A fresh per-window accumulator delta (built up in memory for one batch, then
// merged into the DB rows).
function history_empty_delta(): array
{
    return [
        'seq_min' => null, 'seq_max' => null,
        'ts_min' => null, 'ts_max' => null,
        'char_count' => 0, 'burst_count' => 0, 'silence_seconds' => 0, 'n_vitals' => 0,
        'postcards_in' => 0, 'postcards_out' => 0, 'drawings' => 0,
        'warden_notices' => 0, 'aborts' => 0, 'mode_changes' => 0, 'day_rollovers' => 0,
        'sum' => [], 'peak' => [],
    ];
}

// Fold one event into a delta. Pure accounting; identical for the day and hour
// buckets, so both get the same numbers from a single pass.
function history_fold(array &$d, int $seq, string $ts, string $kind, $payload): void
{
    if ($d['seq_min'] === null || $seq < $d['seq_min']) $d['seq_min'] = $seq;
    if ($d['seq_max'] === null || $seq > $d['seq_max']) $d['seq_max'] = $seq;
    if ($d['ts_min'] === null || $ts < $d['ts_min']) $d['ts_min'] = $ts;
    if ($d['ts_max'] === null || $ts > $d['ts_max']) $d['ts_max'] = $ts;

    $p = is_array($payload) ? $payload : [];

    switch ($kind) {
        case 'text':
            // volume of text he produced; character count is the agreed measure.
            if (isset($p['s']) && is_string($p['s'])) {
                $d['char_count'] += mb_strlen($p['s'], 'UTF-8');
            }
            break;

        case 'gen':
            // a completed generation = one burst.
            $d['burst_count']++;
            break;

        case 'silence':
            $d['silence_seconds'] += (int)($p['seconds'] ?? 0);
            break;

        case 'vitals':
            $m = $p['mental'] ?? null;
            if (is_array($m)) {
                $d['n_vitals']++;
                foreach (HISTORY_MENTAL_AXES as $axis) {
                    if (isset($m[$axis]) && is_numeric($m[$axis])) {
                        $v = (float)$m[$axis];
                        $d['sum'][$axis] = ($d['sum'][$axis] ?? 0.0) + $v;
                        if (!isset($d['peak'][$axis]) || $v > $d['peak'][$axis]) {
                            $d['peak'][$axis] = $v;
                        }
                    }
                }
            }
            break;

        case 'postcard_in':
            $d['postcards_in']++;
            break;

        case 'postcard_out':
            $d['postcards_out']++;
            break;

        case 'draw':
            // Count a drawing once, on its terminal build-up pass, so passes that
            // span batch boundaries never double-count. Two pass shapes exist:
            // handwriting-engine draws carry pass:{i,n}; dream draws carry seq/total.
            if (isset($p['pass']) && is_array($p['pass'])) {
                if ((int)($p['pass']['i'] ?? 0) === (int)($p['pass']['n'] ?? 0) - 1) {
                    $d['drawings']++;
                }
            } elseif (isset($p['seq'], $p['total'])) {
                if ((int)$p['seq'] === (int)$p['total']) {
                    $d['drawings']++;
                }
            }
            break;

        case 'warden':
            // warden interventions: content blocks (kind=warden) - see below for
            // the announcement variant folded via the `event` case.
            $d['warden_notices']++;
            break;

        case 'abort':
            $d['aborts']++;
            break;

        case 'mode':
            $d['mode_changes']++;
            break;

        case 'day':
            $d['day_rollovers']++;
            break;

        case 'event':
            // A warden announcement rides in as event{name:'warden'}; count it as a
            // warden intervention too so both censorship and announcement land on
            // the spine as one "warden" marker.
            if (($p['name'] ?? null) === 'warden') {
                $d['warden_notices']++;
            }
            break;
    }
}

// ---------------------------------------------------------------------------
// Mood reduction
// ---------------------------------------------------------------------------

// From an accumulator {nv, sum, peak} produce the presentation shape:
//   ['dominant'=>axis|null, 'tint'=>hex, 'score'=>mean, 'axes'=>{axis:{mean,peak}}]
function history_reduce_mood(array $acc): array
{
    $nv = (int)($acc['nv'] ?? 0);
    $sum = $acc['sum'] ?? [];
    $peak = $acc['peak'] ?? [];

    $axes = [];
    foreach (HISTORY_MENTAL_AXES as $axis) {
        $mean = $nv > 0 ? ((float)($sum[$axis] ?? 0.0)) / $nv : 0.0;
        $axes[$axis] = [
            'mean' => round($mean, 3),
            'peak' => round((float)($peak[$axis] ?? 0.0), 3),
        ];
    }

    $dominant = null;
    $score = null;
    if ($nv > 0) {
        $best = -1.0;
        foreach (HISTORY_EMOTIONAL_AXES as $axis) {
            $mean = $axes[$axis]['mean'];
            if ($mean > $best) {
                $best = $mean;
                $dominant = $axis;
                $score = $mean;
            }
        }
    }

    $tint = $dominant !== null ? (HISTORY_MOOD_TINTS[$dominant] ?? HISTORY_TINT_NONE) : HISTORY_TINT_NONE;

    return ['dominant' => $dominant, 'tint' => $tint, 'score' => $score, 'axes' => $axes];
}

// ---------------------------------------------------------------------------
// Merge a batch of deltas into the index tables
// ---------------------------------------------------------------------------

// Merge one delta into an existing (or fresh) DB row array, returning the new row
// values ready to UPSERT. Additive for counters, min/max for ranges, and the JSON
// `acc` carries the running sums/peaks forward so later batches keep aggregating.
function history_merge_row(?array $existing, array $d): array
{
    $acc = ['nv' => 0, 'sum' => [], 'peak' => []];
    if ($existing !== null && !empty($existing['acc'])) {
        $decoded = json_decode($existing['acc'], true);
        if (is_array($decoded)) {
            $acc['nv'] = (int)($decoded['nv'] ?? 0);
            $acc['sum'] = is_array($decoded['sum'] ?? null) ? $decoded['sum'] : [];
            $acc['peak'] = is_array($decoded['peak'] ?? null) ? $decoded['peak'] : [];
        }
    }

    $acc['nv'] += $d['n_vitals'];
    foreach (HISTORY_MENTAL_AXES as $axis) {
        if (isset($d['sum'][$axis])) {
            $acc['sum'][$axis] = ($acc['sum'][$axis] ?? 0.0) + $d['sum'][$axis];
        }
        if (isset($d['peak'][$axis])) {
            $acc['peak'][$axis] = isset($acc['peak'][$axis])
                ? max((float)$acc['peak'][$axis], (float)$d['peak'][$axis])
                : (float)$d['peak'][$axis];
        }
    }

    $addCounters = [
        'char_count', 'burst_count', 'silence_seconds', 'n_vitals',
        'postcards_in', 'postcards_out', 'drawings',
        'warden_notices', 'aborts', 'mode_changes', 'day_rollovers',
    ];
    $row = [];
    foreach ($addCounters as $c) {
        $row[$c] = (int)($existing[$c] ?? 0) + (int)$d[$c];
    }

    $row['seq_min'] = history_min_val($existing['seq_min'] ?? null, $d['seq_min']);
    $row['seq_max'] = history_max_val($existing['seq_max'] ?? null, $d['seq_max']);
    $row['ts_min']  = history_min_val($existing['ts_min'] ?? null, $d['ts_min']);
    $row['ts_max']  = history_max_val($existing['ts_max'] ?? null, $d['ts_max']);

    $mood = history_reduce_mood($acc);
    $row['dominant_mood'] = $mood['dominant'];
    $row['mood_score'] = $mood['score'];
    $row['acc'] = json_encode($acc, JSON_UNESCAPED_SLASHES);
    $row['axes'] = json_encode($mood['axes'], JSON_UNESCAPED_SLASHES);

    return $row;
}

function history_min_val($a, $b)
{
    if ($a === null) return $b;
    if ($b === null) return $a;
    return $a <= $b ? $a : $b;
}

function history_max_val($a, $b)
{
    if ($a === null) return $b;
    if ($b === null) return $a;
    return $a >= $b ? $a : $b;
}

// UPSERT a merged row into `history_days` (keyed by day) or `history_hours`
// (keyed by day+hour). Column list is shared bar the key(s).
function history_upsert(PDO $db, string $table, array $key, array $row): void
{
    $cols = [
        'seq_min', 'seq_max', 'ts_min', 'ts_max',
        'char_count', 'burst_count', 'silence_seconds', 'n_vitals',
        'postcards_in', 'postcards_out', 'drawings',
        'warden_notices', 'aborts', 'mode_changes', 'day_rollovers',
        'dominant_mood', 'mood_score', 'acc', 'axes',
    ];
    $allCols = array_merge(array_keys($key), $cols);
    $placeholders = implode(', ', array_map(static fn($c) => ':' . $c, $allCols));
    $updates = implode(', ', array_map(static fn($c) => "$c = VALUES($c)", $cols));
    $sql = "INSERT INTO $table (" . implode(', ', $allCols) . ") VALUES ($placeholders) "
         . "ON DUPLICATE KEY UPDATE $updates";
    $stmt = $db->prepare($sql);

    foreach ($key as $k => $v) {
        $stmt->bindValue(':' . $k, $v);
    }
    foreach ($cols as $c) {
        $v = $row[$c];
        if ($v === null) {
            $stmt->bindValue(':' . $c, null, PDO::PARAM_NULL);
        } elseif ($c === 'mood_score') {
            $stmt->bindValue(':' . $c, (float)$v);
        } else {
            $stmt->bindValue(':' . $c, $v);
        }
    }
    $stmt->execute();
}

// ---------------------------------------------------------------------------
// The rollup itself
// ---------------------------------------------------------------------------

// Ensure the watermark row exists and return the current built_through_seq.
function history_cursor(PDO $db): int
{
    $db->exec('INSERT IGNORE INTO history_cursor (id, built_through_seq, updated_at) VALUES (1, 0, NOW())');
    return (int)$db->query('SELECT built_through_seq FROM history_cursor WHERE id = 1')->fetchColumn();
}

// Process one bounded batch of events (lo, hi] into the index, atomically, and
// advance the watermark to hi. Returns the number of events folded.
function history_rollup_batch(PDO $db, int $lo, int $hi): int
{
    $stmt = $db->prepare(
        'SELECT seq, ts, kind, payload FROM events WHERE seq > :lo AND seq <= :hi ORDER BY seq ASC'
    );
    $stmt->bindValue(':lo', $lo, PDO::PARAM_INT);
    $stmt->bindValue(':hi', $hi, PDO::PARAM_INT);
    $stmt->execute();

    $days = [];   // date => delta
    $hours = [];  // "date|hour" => delta (carries date+hour)
    $processed = 0;

    while ($e = $stmt->fetch()) {
        $seq = (int)$e['seq'];
        $ts = (string)$e['ts'];
        $kind = (string)$e['kind'];
        $payload = json_decode((string)$e['payload'], true);
        [$date, $hour] = history_bucket($ts);

        if (!isset($days[$date])) $days[$date] = history_empty_delta();
        history_fold($days[$date], $seq, $ts, $kind, $payload);

        $hk = $date . '|' . $hour;
        if (!isset($hours[$hk])) {
            $hours[$hk] = history_empty_delta();
            $hours[$hk]['_date'] = $date;
            $hours[$hk]['_hour'] = $hour;
        }
        history_fold($hours[$hk], $seq, $ts, $kind, $payload);
        $processed++;
    }

    $db->beginTransaction();
    try {
        foreach ($days as $date => $delta) {
            $existing = history_fetch_row($db, 'history_days', ['day' => $date]);
            $row = history_merge_row($existing, $delta);
            history_upsert($db, 'history_days', ['day' => $date], $row);
        }
        foreach ($hours as $delta) {
            $key = ['day' => $delta['_date'], 'hour' => $delta['_hour']];
            $existing = history_fetch_row($db, 'history_hours', $key);
            $row = history_merge_row($existing, $delta);
            history_upsert($db, 'history_hours', $key, $row);
        }
        $upd = $db->prepare('UPDATE history_cursor SET built_through_seq = :hi, updated_at = NOW() WHERE id = 1');
        $upd->bindValue(':hi', $hi, PDO::PARAM_INT);
        $upd->execute();
        $db->commit();
    } catch (Throwable $ex) {
        $db->rollBack();
        throw $ex;
    }

    return $processed;
}

// Fetch a single existing index row (or null) for merging.
function history_fetch_row(PDO $db, string $table, array $key): ?array
{
    $where = implode(' AND ', array_map(static fn($k) => "$k = :$k", array_keys($key)));
    $stmt = $db->prepare("SELECT * FROM $table WHERE $where");
    foreach ($key as $k => $v) {
        $stmt->bindValue(':' . $k, $v);
    }
    $stmt->execute();
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

// Incrementally roll up everything not yet folded. Returns a small stats summary.
function history_rollup(PDO $db, int $batch = HISTORY_BATCH): array
{
    $head = (int)$db->query('SELECT COALESCE(MAX(seq), 0) FROM events')->fetchColumn();
    $cursor = history_cursor($db);
    $from = $cursor;
    $processed = 0;

    while ($cursor < $head) {
        $hi = min($cursor + $batch, $head);
        $processed += history_rollup_batch($db, $cursor, $hi);
        $cursor = $hi;
    }

    return [
        'from_seq' => $from,
        'to_seq' => $head,
        'processed' => $processed,
        'already_current' => $from >= $head,
    ];
}

// Full rebuild: wipe the index, reset the watermark to 0, and roll up the whole
// existing log. `events` is never touched. Safe to run repeatedly.
function history_backfill(PDO $db, int $batch = HISTORY_BATCH): array
{
    $db->exec('TRUNCATE TABLE history_hours');
    $db->exec('TRUNCATE TABLE history_days');
    $db->exec('INSERT INTO history_cursor (id, built_through_seq, updated_at) VALUES (1, 0, NOW()) '
        . 'ON DUPLICATE KEY UPDATE built_through_seq = 0, updated_at = NOW()');
    return history_rollup($db, $batch);
}

// ---------------------------------------------------------------------------
// Read side (consumed by public/api/history.php)
// ---------------------------------------------------------------------------

// Build the compact day index for the spine: one entry per day, each with its
// hourly profile, mood tint and event markers. Aggregate only - never raw events.
function history_day_index(PDO $db): array
{
    $dayRows = $db->query(
        'SELECT * FROM history_days ORDER BY day ASC'
    )->fetchAll();

    $hourRows = $db->query(
        'SELECT * FROM history_hours ORDER BY day ASC, hour ASC'
    )->fetchAll();

    // group hours by day
    $hoursByDay = [];
    foreach ($hourRows as $h) {
        $hoursByDay[$h['day']][] = $h;
    }

    $days = [];
    foreach ($dayRows as $d) {
        $day = $d['day'];
        $hours = [];
        foreach ($hoursByDay[$day] ?? [] as $h) {
            $hours[] = history_shape_hour($h);
        }
        $days[] = [
            'date' => $day,
            'seq' => [$d['seq_min'] !== null ? (int)$d['seq_min'] : null, $d['seq_max'] !== null ? (int)$d['seq_max'] : null],
            'ts' => [$d['ts_min'], $d['ts_max']],
            'chars' => (int)$d['char_count'],
            'bursts' => (int)$d['burst_count'],
            'silence' => (int)$d['silence_seconds'],
            'mood' => [
                'dominant' => $d['dominant_mood'],
                'tint' => $d['dominant_mood'] !== null ? (HISTORY_MOOD_TINTS[$d['dominant_mood']] ?? HISTORY_TINT_NONE) : HISTORY_TINT_NONE,
                'score' => $d['mood_score'] !== null ? round((float)$d['mood_score'], 3) : null,
            ],
            'markers' => history_markers($d),
            'hours' => $hours,
        ];
    }

    return $days;
}

// One hour, in the tight per-band shape the spine consumes (short keys: h=hour,
// c=chars, b=bursts, s=silence, t=tint, m=nonzero markers).
function history_shape_hour(array $h): array
{
    $dom = $h['dominant_mood'];
    $out = [
        'h' => (int)$h['hour'],
        'c' => (int)$h['char_count'],
        'b' => (int)$h['burst_count'],
        's' => (int)$h['silence_seconds'],
        't' => $dom !== null ? (HISTORY_MOOD_TINTS[$dom] ?? HISTORY_TINT_NONE) : HISTORY_TINT_NONE,
    ];
    if ($dom !== null) {
        $out['dom'] = $dom;
    }
    $markers = history_markers($h);
    if ($markers) {
        $out['m'] = $markers;
    }
    return $out;
}

// Non-zero notable-event counts only (keeps the payload small over a phone link).
function history_markers(array $r): array
{
    $keys = [
        'postcards_in' => 'pin',
        'postcards_out' => 'pout',
        'drawings' => 'draw',
        'warden_notices' => 'warden',
        'aborts' => 'abort',
        'mode_changes' => 'mode',
        'day_rollovers' => 'day',
    ];
    $out = [];
    foreach ($keys as $col => $short) {
        $v = (int)($r[$col] ?? 0);
        if ($v > 0) {
            $out[$short] = $v;
        }
    }
    return $out;
}
