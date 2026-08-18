<?php
declare(strict_types=1);

// range.php - PUBLIC, read-only page of raw events for HISTORY MODE replay.
//
// This is what the replay consumes: given a position (a seq or a timestamp) it
// returns a bounded, fixed-size page of events and cursors for paging in BOTH
// directions, so the client can scroll smoothly forward and backward through the
// day without re-sending what it already has.
//
// Parameters (all optional):
//   after=<seq>   return events with seq strictly GREATER than this (page forward)
//   before=<seq>  return events with seq strictly LESS than this (page backward)
//   ts=<datetime> anchor by time: resolve to the first event at/after ts, then
//                 page forward from just before it (so that event is included)
//   limit=<n>     page size, default 200, capped server-side at 500
//   kinds=a,b,c   optional whitelist filter (e.g. text,mode,postcard_in) to trim
//                 the firehose (power/host/vitals) for a lean handwriting replay
//
// Ordering is ALWAYS ascending by seq, whichever direction you paged, so the
// client appends/prepends without re-sorting. Page size is capped regardless of
// what is requested, so this endpoint can never be asked to overload the DB.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';

const RANGE_DEFAULT_LIMIT = 200;
const RANGE_MAX_LIMIT = 500;

header('Cache-Control: public, max-age=15');

try {
    $db = captive_db();

    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : RANGE_DEFAULT_LIMIT;
    if ($limit < 1) {
        $limit = RANGE_DEFAULT_LIMIT;
    }
    if ($limit > RANGE_MAX_LIMIT) {
        $limit = RANGE_MAX_LIMIT;
    }

    // optional kind whitelist
    $kinds = [];
    if (isset($_GET['kinds']) && $_GET['kinds'] !== '') {
        foreach (explode(',', (string)$_GET['kinds']) as $k) {
            $k = trim($k);
            // event kinds are [a-z_], max 24 chars (schema); ignore anything else.
            if ($k !== '' && strlen($k) <= 24 && preg_match('/^[a-z_]+$/', $k)) {
                $kinds[$k] = true;
            }
        }
        $kinds = array_keys($kinds);
    }

    $before = isset($_GET['before']) ? (int)$_GET['before'] : null;

    // Resolve a ts anchor into an `after` boundary (first event at/after ts, minus
    // one so that first event is included in the forward page).
    $after = isset($_GET['after']) ? (int)$_GET['after'] : null;
    if ($after === null && $before === null && isset($_GET['ts']) && $_GET['ts'] !== '') {
        $stmt = $db->prepare('SELECT MIN(seq) FROM events WHERE ts >= :ts');
        $stmt->bindValue(':ts', (string)$_GET['ts']);
        $stmt->execute();
        $anchor = $stmt->fetchColumn();
        // If nothing is at/after ts we are past the end: page from the max seq
        // (an empty forward page with a usable backward cursor).
        $after = $anchor !== false && $anchor !== null ? ((int)$anchor - 1) : PHP_INT_MAX;
    }

    // Build the WHERE with a stable seq predicate + optional kind filter.
    $conds = [];
    $params = [];
    $backward = ($before !== null);

    if ($backward) {
        $conds[] = 'seq < :before';
        $params[':before'] = [$before, PDO::PARAM_INT];
    } else {
        if ($after === null) {
            $after = 0; // no position given: start of history
        }
        $conds[] = 'seq > :after';
        $params[':after'] = [$after, PDO::PARAM_INT];
    }

    if ($kinds) {
        $in = [];
        foreach ($kinds as $i => $k) {
            $ph = ':k' . $i;
            $in[] = $ph;
            $params[$ph] = [$k, PDO::PARAM_STR];
        }
        $conds[] = 'kind IN (' . implode(', ', $in) . ')';
    }

    $where = implode(' AND ', $conds);
    // Fetch one extra to detect whether more matching events exist past the page.
    $fetch = $limit + 1;
    // Backward pages must select the LAST `limit` events before the cursor, so
    // order DESC then reverse to ascending for the client.
    $order = $backward ? 'DESC' : 'ASC';

    $sql = "SELECT seq, ts, kind, payload FROM events WHERE $where ORDER BY seq $order LIMIT :fetch";
    $stmt = $db->prepare($sql);
    foreach ($params as $ph => [$val, $type]) {
        $stmt->bindValue($ph, $val, $type);
    }
    $stmt->bindValue(':fetch', $fetch, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    $hasMore = count($rows) > $limit;
    if ($hasMore) {
        $rows = array_slice($rows, 0, $limit);
    }
    if ($backward) {
        $rows = array_reverse($rows); // back to ascending
    }

    $events = array_map(static function (array $row): array {
        return [
            'seq' => (int)$row['seq'],
            'ts' => $row['ts'],
            'kind' => $row['kind'],
            'payload' => json_decode($row['payload'], true),
        ];
    }, $rows);

    $firstSeq = $events ? $events[0]['seq'] : null;
    $lastSeq = $events ? $events[count($events) - 1]['seq'] : null;
    $head = (int)$db->query('SELECT COALESCE(MAX(seq), 0) FROM events')->fetchColumn();

    // Direction-aware "is there more" flags. For the direction we did NOT page,
    // there is more iff the page is non-empty and not already at the edge.
    if ($backward) {
        $hasMoreBackward = $hasMore;
        $hasMoreForward = $lastSeq !== null && $lastSeq < $head;
    } else {
        $hasMoreForward = $hasMore;
        $hasMoreBackward = $firstSeq !== null && $firstSeq > 1;
    }

    captive_json_response([
        'ok' => true,
        'now' => $head,
        'page' => [
            'size' => count($events),
            'limit' => $limit,
            'first_seq' => $firstSeq,
            'last_seq' => $lastSeq,
        ],
        // Feed next/prev straight back as after=/before= to keep scrolling.
        'cursors' => [
            'next' => $lastSeq,   // pass as ?after=<next>
            'prev' => $firstSeq,  // pass as ?before=<prev>
            'has_more_forward' => $hasMoreForward,
            'has_more_backward' => $hasMoreBackward,
        ],
        'events' => $events,
    ]);
} catch (Throwable $e) {
    captive_error_response('internal error', 500);
}
