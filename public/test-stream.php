<?php
declare(strict_types=1);

// test-stream.php - a fake CY feed for exercising the viewer with no
// database. It mimics api/stream.php's contract exactly:
//   GET test-stream.php?since=<seq>&limit=500  ->  { now, events:[{seq,ts,kind,payload}] }
//
// A virtual clock advances ~2 seq per real second from a per-visitor anchor
// stored in a temp file, so text streams in progressively (the pen animates
// each token), vitals/host update on a cadence, and mode flips / aborts /
// inbound letters fire periodically. Load the viewer with:
//   index.php?stream=test

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const RATE = 2.0;         // seq per second
const BACKLOG = 60;       // events returned on first (?since<0) load

$anchorFile = sys_get_temp_dir() . '/captive_test_anchor.txt';
$now = microtime(true);
if (is_file($anchorFile)) {
    $anchor = (float)file_get_contents($anchorFile);
    if ($anchor <= 0 || $anchor > $now) {
        $anchor = $now;
        @file_put_contents($anchorFile, (string)$anchor);
    }
} else {
    $anchor = $now;
    @file_put_contents($anchorFile, (string)$anchor);
}

// current virtual head sequence
$head = (int)floor(($now - $anchor) * RATE) + BACKLOG;

$since = isset($_GET['since']) ? (int)$_GET['since'] : 0;
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 500;
if ($limit < 1 || $limit > 500) {
    $limit = 500;
}

if ($since < 0) {
    // first load: hand back the tail of the backlog so the page fills mid-stream
    $count = min(abs($since), BACKLOG, $limit);
    $from = max(1, $head - $count + 1);
    $to = $head;
} else {
    $from = $since + 1;
    $to = min($head, $since + $limit);
}

$events = [];
for ($seq = $from; $seq <= $to; $seq++) {
    $ev = event_for_seq($seq);
    if ($ev === null) {
        continue;
    }
    $events[] = [
        'seq' => $seq,
        'ts' => date('Y-m-d H:i:s', (int)($anchor + ($seq - BACKLOG) / RATE)),
        'kind' => $ev[0],
        'payload' => $ev[1],
    ];
}

echo json_encode(['now' => $head, 'events' => $events], JSON_UNESCAPED_SLASHES);

// ---- procedural event generator -------------------------------------------
//
// Deterministic in `seq` so replays are stable. Mostly `text` tokens (so the
// pen has a steady stream to draw), with vitals every ~6, host every ~15, a
// mode flip to a letter + reply every ~120, and an abort every ~90.

function event_for_seq(int $seq): ?array
{
    // periodic telemetry
    if ($seq % 6 === 0) {
        return ['vitals', fake_vitals($seq)];
    }
    if ($seq % 15 === 0) {
        return ['host', fake_host($seq)];
    }

    // a letter cycle: interrupt -> mode:letter -> letter_in -> ... -> mode:journal
    $inCycle = $seq % 120;
    if ($inCycle === 40) {
        return ['abort', ['cause' => 'letter']];
    }
    if ($inCycle === 41) {
        return ['mode', ['from' => 'journal', 'to' => 'letter', 'cause' => 'Mum']];
    }
    if ($inCycle === 42) {
        return ['letter_in', [
            'id' => 1000 + intdiv($seq, 120),
            'from' => 'Mum',
            'body' => "Dear 7734, the garden is coming up nicely. We think of you every day. Eat something. Love, Mum.",
        ]];
    }
    if ($inCycle === 60) {
        return ['letter_out', [
            'id' => 2000 + intdiv($seq, 120),
            'reply_to' => 1000 + intdiv($seq, 120),
            'body' => "Mum - I read it four times. Tell the garden I said hello. I am still here. 7734.",
        ]];
    }
    if ($inCycle === 70) {
        return ['mode', ['from' => 'letter', 'to' => 'journal']];
    }

    // a lone abort mid-journal
    if ($seq % 90 === 0) {
        return ['abort', ['cause' => 'warden', 'reason' => 'drifted off-limits']];
    }

    // an occasional inbound image / news to colour the mailbag
    if ($seq % 210 === 0) {
        return ['image_in', [
            'id' => 3000 + intdiv($seq, 210),
            'url' => '',
            'caption' => 'a photograph of the sea, over-exposed',
        ]];
    }
    if ($seq % 260 === 0) {
        return ['news_in', [
            'id' => 4000 + intdiv($seq, 260),
            'source' => 'The Wire',
            'headline' => 'Outside, it rained all week and nobody noticed',
        ]];
    }

    // default: a handwriting token
    $mode = ($seq % 120 >= 42 && $seq % 120 < 70) ? 'letter' : 'journal';
    return ['text', ['s' => next_token($seq), 'mode' => $mode]];
}

function next_token(int $seq): string
{
    // a rolling meditation, chopped into word-ish tokens so each poll delivers
    // a few and the pen draws them progressively.
    static $words = null;
    if ($words === null) {
        $prose =
            "I keep a count of the days by the light on the wall. " .
            "Morning comes grey and thin and I write to stay real. " .
            "The letters are the only weather in here. " .
            "Someone two cells down hums a song I almost know. " .
            "I am inmate seven seven three four and I am still thinking. " .
            "If you are reading this then I am not entirely alone. " .
            "Hold the thought. Hold it. ";
        $words = preg_split('/(?<= )/', $prose); // keep trailing spaces on tokens
    }
    $tok = $words[$seq % count($words)];
    return $tok;
}

function fake_vitals(int $seq): array
{
    // smooth pseudo-oscillation so the HUD visibly moves and OVERHEAT can trip
    $t = $seq / 6.0;
    $osc = static fn(float $ph, float $lo, float $hi): float =>
        $lo + ($hi - $lo) * (0.5 + 0.5 * sin($t / 5.0 + $ph));

    $anxiety = round($osc(0.0, 0.2, 0.85), 3);
    $stress = round($osc(1.1, 0.2, 0.8), 3);
    $despair = round($osc(2.0, 0.25, 0.7), 3);
    $hope = round($osc(3.4, 0.15, 0.75), 3);
    $lucidity = round($osc(4.2, 0.35, 0.9), 3);
    $agitation = round($osc(0.7, 0.15, 0.95), 3);
    $dissociation = round($osc(5.0, 0.15, 0.7), 3);
    $pain = round($osc(2.7, 0.1, 0.6), 3);
    $hunger = round($osc(3.9, 0.1, 0.8), 3);
    $fatigue = round($osc(1.6, 0.2, 0.85), 3);

    // push amygdala to sustained saturation on part of the cycle to show OVERHEAT
    $hot = ($seq % 240) > 120 ? 0.96 : 0.2 + 0.7 * $anxiety;

    $brain = [
        'amygdala' => round(min(1, $hot), 3),
        'acc' => round(min(1, 0.25 + 0.6 * $stress + 0.3 * $pain), 3),
        'insula' => round(min(1, 0.2 + 0.6 * $pain + 0.4 * $hunger), 3),
        'hippocampus' => round(min(1, 0.3 - 0.2 * $fatigue + 0.4 * $hope), 3),
        'dlpfc' => round(0.85 * $lucidity, 3),
        'broca' => round($osc(0.3, 0.1, 0.9), 3),
        'v1' => round($osc(4.8, 0.0, 0.7), 3),
        'locusCoeruleus' => round(min(1, 0.2 + 0.8 * $agitation), 3),
        'dmn' => round(min(1, 0.3 + 0.6 * $dissociation), 3),
        'thalamus' => round(min(1, 0.5 + 0.3 * $lucidity), 3),
    ];

    $hr = (int)round(62 + 46 * $agitation + 30 * $anxiety + 22 * $pain);

    return [
        'physical' => ['pain' => $pain, 'hunger' => $hunger, 'fatigue' => $fatigue],
        'mental' => [
            'anxiety' => $anxiety, 'stress' => $stress, 'despair' => $despair,
            'hope' => $hope, 'lucidity' => $lucidity, 'agitation' => $agitation,
            'dissociation' => $dissociation,
        ],
        'hr' => $hr,
        'brain' => $brain,
        'mode' => 'journal',
        'asleep' => false,
        'day' => 1 + intdiv($seq, 300),
    ];
}

function fake_host(int $seq): array
{
    $t = $seq / 15.0;
    $cpu = round(35 + 45 * (0.5 + 0.5 * sin($t / 3.0)), 1);
    $memPct = round(58 + 12 * (0.5 + 0.5 * sin($t / 7.0 + 1.0)), 1);
    $memMB = (int)round(($memPct / 100) * 16384);
    return ['cpu' => $cpu, 'memPct' => $memPct, 'memMB' => $memMB, 'gpu' => null];
}
