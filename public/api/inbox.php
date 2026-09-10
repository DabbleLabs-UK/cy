<?php
declare(strict_types=1);

// inbox.php - runner-only: atomically claim one reply plus fan-mail receipts.
//
// The bounded reply tray hands Dell one item at a time. Fresh mail is selected
// newest-first while anything waiting 15 minutes ages into oldest-first priority,
// preventing starvation. Fan mail is separately handed to the runner only for
// screening and public archiving; it does not enter the LLM reply queue unless it
// is later promoted. Each reply postcard
// carries its sender's visitor memory (handle, counts, standing, notes) so the
// runner can recognise a returning writer in Cy's voice. That memory is for the
// runner only and is never echoed into the public event stream.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/postcard_queue.php';

try {
    captive_require_ingest_key();

    $db = captive_db();
    $db->beginTransaction();

    captive_postcard_queue_lock($db);
    captive_postcard_expire_stale_claims($db);
    $postcards = [];
    if (captive_postcard_can_claim_next(captive_postcard_inflight_replies($db))) {
        // If the tray is completely quiet, use the free place for the oldest fan-mail
        // item. The every-N-replies promotion in ingest.php handles sustained traffic.
        if (captive_postcard_active_replies($db) === 0 && captive_postcard_promote_oldest($db)) {
            $db->exec(
                'UPDATE postcard_queue_state
                 SET completed_since_promotion = 0, updated_at = NOW()
                 WHERE id = 1'
            );
        }

        $postcards = $db->query(
            'SELECT p.id, p.visitor_id, p.from_name, p.body, p.image_path, p.image_source,
                    p.image_attrib, p.caption, p.posted_at, p.mail_class,
                    (p.promoted_at IS NOT NULL) AS promoted,
                    (SELECT MAX(pp.posted_at) FROM postcards pp
                       WHERE pp.visitor_id = p.visitor_id AND pp.id < p.id) AS prev_posted_at,
                    v.handle AS v_handle, v.visit_count AS v_visit_count,
                    v.postcard_count AS v_postcard_count, v.warmth AS v_warmth,
                    v.suspicion AS v_suspicion, v.grudge AS v_grudge, v.notes AS v_notes,
                    v.first_seen AS v_first_seen, v.last_seen AS v_last_seen
             FROM postcards p
             LEFT JOIN visitors v ON v.visitor_id = p.visitor_id
             WHERE p.mail_class = \'reply\' AND p.deliver_at <= NOW()
                   AND p.delivered_at IS NULL AND p.replied_at IS NULL AND p.blocked = 0
             ORDER BY
                (p.posted_at <= (NOW() - INTERVAL 15 MINUTE)) DESC,
                CASE WHEN p.posted_at <= (NOW() - INTERVAL 15 MINUTE) THEN p.posted_at END ASC,
                CASE WHEN p.posted_at > (NOW() - INTERVAL 15 MINUTE) THEN p.posted_at END DESC,
                p.id DESC
             LIMIT 1
             FOR UPDATE'
        )->fetchAll();
    }

    if ($postcards) {
        $ids = array_column($postcards, 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $db->prepare("UPDATE postcards SET delivered_at = NOW() WHERE id IN ($placeholders)")->execute($ids);
    }

    // Fan-mail collection is capability-gated. An older Dell runner ignores the
    // fan_mail response field, so handing it rows would mark them delivered and
    // silently lose their public archive event. Updated runners opt in with
    // ?fan_mail=1 and then screen/emit these without enqueuing a model reply.
    $fanMail = [];
    if (captive_postcard_fan_mail_supported($_GET)) {
        $fanMail = $db->query(
            "SELECT id, from_name, body, image_path, image_source, image_attrib, caption, posted_at, mail_class
             FROM postcards
             WHERE mail_class IN ('fan', 'fan_final') AND deliver_at <= NOW()
                   AND delivered_at IS NULL AND replied_at IS NULL AND blocked = 0
             ORDER BY posted_at ASC, id ASC
             LIMIT 25
             FOR UPDATE"
        )->fetchAll();
        if ($fanMail) {
            $ids = array_column($fanMail, 'id');
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $db->prepare("UPDATE postcards SET delivered_at = NOW() WHERE id IN ($placeholders)")->execute($ids);
        }
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
            'promoted' => (bool)$p['promoted'],
            'visitor' => $visitor,
        ];
    }, $postcards);

    $fanOut = array_map(static function (array $p): array {
        return [
            'id' => (int)$p['id'],
            'from_name' => $p['from_name'],
            'body' => $p['body'],
            'image_path' => $p['image_path'],
            'image_source' => $p['image_source'],
            'image_attrib' => $p['image_attrib'],
            'caption' => $p['caption'],
            'posted_at' => $p['posted_at'],
            'mail_class' => $p['mail_class'],
        ];
    }, $fanMail);

    captive_json_response(['postcards' => $out, 'fan_mail' => $fanOut, 'news' => $news]);
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    captive_error_response('internal error', 500);
}
