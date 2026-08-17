<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';

try {
    captive_require_ingest_key();

    $db = captive_db();
    $db->beginTransaction();

    $letters = $db->query("SELECT id, from_name, body FROM letters WHERE deliver_at <= NOW() AND delivered_at IS NULL AND blocked = 0 FOR UPDATE")->fetchAll();
    if ($letters) {
        $ids = array_column($letters, 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $db->prepare("UPDATE letters SET delivered_at = NOW() WHERE id IN ($placeholders)")->execute($ids);
    }

    $images = $db->query("SELECT id, path, caption, w, h FROM images WHERE deliver_at <= NOW() AND delivered_at IS NULL AND blocked = 0 FOR UPDATE")->fetchAll();
    if ($images) {
        $ids = array_column($images, 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $db->prepare("UPDATE images SET delivered_at = NOW() WHERE id IN ($placeholders)")->execute($ids);
    }

    $news = $db->query("SELECT id, source, headline, summary, url FROM news WHERE deliver_at <= NOW() AND delivered_at IS NULL FOR UPDATE")->fetchAll();
    if ($news) {
        $ids = array_column($news, 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $db->prepare("UPDATE news SET delivered_at = NOW() WHERE id IN ($placeholders)")->execute($ids);
    }

    $db->commit();

    captive_json_response(['letters' => $letters, 'images' => $images, 'news' => $news]);
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    captive_error_response('internal error', 500);
}
