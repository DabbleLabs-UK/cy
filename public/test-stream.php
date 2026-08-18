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
    // the electricity meter and the viewer-tempo control, on their own cadences
    if ($seq % 10 === 0) {
        return ['power', fake_power($seq)];
    }
    if ($seq % 14 === 0) {
        return ['tempo', fake_tempo($seq)];
    }
    // generation telemetry after (fake) bursts, on its own cadence
    if ($seq % 13 === 0) {
        return ['gen', fake_gen($seq)];
    }

    // a postcard cycle: interrupt -> mode:letter -> postcard_in -> reply -> back
    $inCycle = $seq % 120;
    if ($inCycle === 40) {
        return ['abort', ['cause' => 'postcard']];
    }
    if ($inCycle === 41) {
        return ['mode', ['from' => 'journal', 'to' => 'letter', 'cause' => 'Mum']];
    }
    if ($inCycle === 42) {
        return ['postcard_in', [
            'id' => 1000 + intdiv($seq, 120),
            'from' => 'Mum',
            'body' => "Dear 7734, the garden is coming up nicely. We think of you every day. Eat something. Love, Mum.",
            'image' => null,
            'attrib' => null,
            'visit_count' => 3,
        ]];
    }
    if ($inCycle === 60) {
        return ['postcard_out', [
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

    // an occasional picture-postcard / news to colour the mailbag
    if ($seq % 210 === 0) {
        return ['postcard_in', [
            'id' => 3000 + intdiv($seq, 210),
            'from' => 'a stranger',
            'body' => null,
            'image' => '',
            'attrib' => 'a photograph of the sea, over-exposed',
            'visit_count' => 1,
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

    // derived composite states the CORTICAL READOUT renders as bars. Real runs
    // carry a full derived{} object; mirror its seven keys here so the panel can
    // be exercised.
    $derived = [
        'confusion' => round($osc(0.5, 0.1, 0.8), 3),
        'overwhelm' => round($osc(1.5, 0.15, 0.9), 3),
        'numbness' => round($osc(2.5, 0.1, 0.7), 3),
        'paranoia' => round($osc(3.5, 0.15, 0.85), 3),
        'fixation' => round($osc(4.5, 0.2, 0.9), 3),
        'resignation' => round($osc(5.5, 0.1, 0.75), 3),
        'brittleness' => round($osc(0.9, 0.2, 0.8), 3),
    ];

    return [
        'physical' => ['pain' => $pain, 'hunger' => $hunger, 'fatigue' => $fatigue],
        'mental' => [
            'anxiety' => $anxiety, 'stress' => $stress, 'despair' => $despair,
            'hope' => $hope, 'lucidity' => $lucidity, 'agitation' => $agitation,
            'dissociation' => $dissociation,
        ],
        'derived' => $derived,
        'hr' => $hr,
        'brain' => $brain,
        'mode' => 'journal',
        'asleep' => false,
        'day' => 1 + intdiv($seq, 300),
    ];
}

// A fake electricity-meter snapshot: a slowly climbing running total with a
// live watts draw, priced at the same 0.245 GBP/kWh tariff the runner uses.
function fake_power(int $seq): array
{
    $t = $seq / 10.0;
    $watts = round(28 + 22 * (0.5 + 0.5 * sin($t / 4.0)), 1);
    $kwh = round(8.0 + $seq * 0.012, 6); // life-of-project cumulative kWh
    $cost = round($kwh * 0.245, 4);
    $cph = round(($watts / 1000) * 0.245, 4);
    return [
        'watts' => $watts,
        'kwh_total' => $kwh,
        'cost_total' => $cost,
        'cost_per_hour' => $cph,
        'uptime_s' => 20000 + $seq * 30,
    ];
}

// A fake tempo event: someone is watching (viewers 1), 30% duty cycle, with the
// pence/hour anchors the cost-of-watching line interpolates between.
function fake_tempo(int $seq): array
{
    return [
        'speed' => 30,
        'viewers' => 1,
        'custom' => false,
        'pph_idle' => 0.613,
        'pph_load' => 1.347,
    ];
}

function fake_host(int $seq): array
{
    $t = $seq / 15.0;
    $cpu = round(35 + 45 * (0.5 + 0.5 * sin($t / 3.0)), 1);
    $memPct = round(58 + 12 * (0.5 + 0.5 * sin($t / 7.0 + 1.0)), 1);
    $memMB = (int)round(($memPct / 100) * 16384);
    // CY: only ollama + this runner node - a slice of the whole-machine figure,
    // so the panel can show an HONEST system-vs-Cy split in test mode.
    $cyCpu = round(16 + 30 * (0.5 + 0.5 * sin($t / 3.0 + 0.6)), 1);
    return [
        'cpu' => $cpu,
        'memPct' => $memPct,
        'memMB' => $memMB,
        'memTotalMB' => 16384,
        'cyCpu' => $cyCpu,
        'cyMemMB' => 5400 + ($seq % 600),
        'nodeMB' => 68 + ($seq % 22),
        'ollamaProcs' => 1,
        'gpu' => null,
    ];
}

// A fake generation-telemetry snapshot. prompt_eval_count is mostly small (the
// cached prefix was reused) but every ~5th burst the KV cache is invalidated and
// the whole briefing is re-read - so the diagnostics panel shows both regimes.
function fake_gen(int $seq): array
{
    $burst = intdiv($seq, 13);
    $invalidated = ($burst % 5 === 0);
    $tokIn = $invalidated ? 2600 + ($seq % 400) : 12 + ($seq % 44);
    $tokOut = 60 + ($seq % 120);
    $promptTokS = round(180 + 90 * (0.5 + 0.5 * sin($seq / 9.0)), 1);
    $genTokS = round(7 + 3 * (0.5 + 0.5 * sin($seq / 11.0)), 2);
    $ttft = (int)round(($tokIn / max(1.0, $promptTokS)) * 1000) + 40;
    $total = (int)round(($tokOut / max(0.1, $genTokS)) * 1000 + $ttft);
    $mode = ($seq % 120 >= 42 && $seq % 120 < 70) ? 'letter' : 'journal';
    return [
        'tokens_in' => $tokIn,
        'tokens_out' => $tokOut,
        'prompt_tok_s' => $promptTokS,
        'gen_tok_s' => $genTokS,
        'ttft_ms' => $ttft,
        'total_ms' => $total,
        'load_ms' => 0,
        'mode' => $mode,
        'ctx_chars' => 3000 + ($seq % 1600),
        'duty' => 30,
        'threads' => 4,
        'model' => 'hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M',
        'num_ctx' => 3072,
        'inbox_ok' => true,
        'tempo_ok' => true,
        'last_error' => null,
    ];
}
