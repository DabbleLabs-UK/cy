<?php
declare(strict_types=1);

// inbox.php - runner-only: atomically claim whatever mail is due at this drop.
//
// Postcards (the merged letter+image feed) and news are marked delivered_at=NOW
// under a row lock so the same item is never handed out twice. Each due postcard
// carries its sender's visitor memory (handle, counts, standing, notes) so the
// runner can recognise a returning writer in Cy's voice. That memory is for the
// runner only and is never echoed into the public event stream.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';

try {
    captive_require_ingest_key();

    $db = captive_db();
    $db->beginTransaction();

    $postcards = $db->query(
        'SELECT p.id, p.visitor_id, p.from_name, p.body, p.image_path, p.image_source,
                p.image_attrib, p.caption, p.posted_at,
                (SELECT MAX(pp.posted_at) FROM postcards pp
                   WHERE pp.visitor_id = p.visitor_id AND pp.id < p.id) AS prev_posted_at,
                v.handle AS v_handle, v.visit_count AS v_visit_count,
                v.postcard_count AS v_postcard_count, v.warmth AS v_warmth,
                v.suspicion AS v_suspicion, v.grudge AS v_grudge, v.notes AS v_notes,
                v.first_seen AS v_first_seen, v.last_seen AS v_last_seen
         FROM postcards p
         LEFT JOIN visitors v ON v.visitor_id = p.visitor_id
         WHERE p.deliver_at <= NOW() AND p.delivered_at IS NULL AND p.blocked = 0
         FOR UPDATE'
    )->fetchAll();

    if ($postcards) {
        $ids = array_column($postcards, 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $db->prepare("UPDATE postcards SET delivered_at = NOW() WHERE id IN ($placeholders)")->execute($ids);
    }

    $news = $db->query('SELECT id, source, headline, summary, url FROM news WHERE deliver_at <= NOW() AND delivered_at IS NULL FOR UPDATE')->fetchAll();
    if ($news) {
        $ids = array_column($news, 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $db->prepare("UPDATE news SET delivered_at = NOW() WHERE id IN ($placeholders)")->execute($ids);
    }

    $db->commit();

    // Reshape each postcard: flat fields for the runner + a nested visitor memory.
    $out = array_map(static function (array $p): array {
        $visitor = null;
        if ($p['visitor_id'] !== null) {
            $visitor = [
                'visitor_id' => $p['visitor_id'],
                'handle' => $p['v_handle'],
                'visit_count' => $p['v_visit_count'] !== null ? (int)$p['v_visit_count'] : null,
                'postcard_count' => $p['v_postcard_count'] !== null ? (int)$p['v_postcard_count'] : null,
                'warmth' => $p['v_warmth'] !== null ? (float)$p['v_warmth'] : null,
                'suspicion' => $p['v_suspicion'] !== null ? (float)$p['v_suspicion'] : null,
                'grudge' => $p['v_grudge'] !== null ? (float)$p['v_grudge'] : null,
                'notes' => $p['v_notes'],
                'first_seen' => $p['v_first_seen'],
                'last_seen' => $p['v_last_seen'],
                'prev_posted_at' => $p['prev_posted_at'],
            ];
        }
        return [
            'id' => (int)$p['id'],
            'visitor_id' => $p['visitor_id'],
            'from_name' => $p['from_name'],
            'body' => $p['body'],
            'image_path' => $p['image_path'],
            'image_source' => $p['image_source'],
            'image_attrib' => $p['image_attrib'],
            'caption' => $p['caption'],
            'visitor' => $visitor,
        ];
    }, $postcards);

    captive_json_response(['postcards' => $out, 'news' => $news]);
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    captive_error_response('internal error', 500);
}
