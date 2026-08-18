<?php
declare(strict_types=1);

// post-postcard.php - the single public write endpoint.
//
// A letter and an image were never two features: a postcard has text on one side
// and an image on the other, and EITHER may be omitted (but not both). Accepts
// multipart/form-data:
//   from            required, 1-40 chars
//   body            optional, <= 900 chars
//   image           optional uploaded file (jpeg/png/webp, <= 3MB)
//   openverse_url   optional https URL of an Openverse result, fetched server-side
// At least one of {body, image, openverse_url} must be present. The image path
// (upload or openverse) is re-encoded to WebP; a client-supplied path is never
// trusted and Openverse images are fetched by us, never hotlinked.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/image.php';
require __DIR__ . '/../../lib/visitor.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        captive_error_response('method not allowed', 405);
    }

    $from = trim((string)($_POST['from'] ?? ''));
    $body = trim((string)($_POST['body'] ?? ''));
    $openverseUrl = trim((string)($_POST['openverse_url'] ?? ''));

    if (mb_strlen($from) < 1 || mb_strlen($from) > 40) {
        captive_error_response('from must be 1-40 characters', 422);
    }
    if (mb_strlen($body) > 900) {
        captive_error_response('body must be at most 900 characters', 422);
    }

    $hasUpload = isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK;
    $hasOpenverse = $openverseUrl !== '';
    $hasBody = $body !== '';

    if (!$hasBody && !$hasUpload && !$hasOpenverse) {
        captive_error_response('a postcard needs text, an image, or both', 422);
    }
    if ($hasUpload && $hasOpenverse) {
        captive_error_response('choose one image: upload or Openverse, not both', 422);
    }

    $db = captive_db();
    $ipBin = @inet_pton(captive_client_ip());
    if ($ipBin === false) {
        $ipBin = null;
    }

    $rateStmt = $db->prepare(
        "SELECT COUNT(*) FROM rate_limits WHERE ip = :ip AND action = 'postcard' AND created_at > (NOW() - INTERVAL 10 MINUTE)"
    );
    $rateStmt->bindValue(':ip', $ipBin, PDO::PARAM_LOB);
    $rateStmt->execute();
    if ((int)$rateStmt->fetchColumn() >= 3) {
        captive_error_response('rate limit exceeded, try again later', 429);
    }

    // ---- image intake (re-encode; strips EXIF; stores WebP) ----
    $imagePath = null;
    $imageSource = null;
    $imageAttrib = null;
    if ($hasUpload) {
        $bytes = @file_get_contents($_FILES['image']['tmp_name']);
        if ($bytes === false) {
            captive_error_response('could not read upload', 422);
        }
        $result = captive_store_image($bytes);
        if (str_starts_with($result, 'err:')) {
            captive_error_response(substr($result, 4), 422);
        }
        $imagePath = $result;
        $imageSource = 'upload';
    } elseif ($hasOpenverse) {
        $result = captive_store_openverse($openverseUrl);
        if (str_starts_with($result, 'err:')) {
            captive_error_response(substr($result, 4), 422);
        }
        $imagePath = $result;
        $imageSource = 'openverse';
        $attrib = trim((string)($_POST['openverse_attrib'] ?? ''));
        $imageAttrib = $attrib !== '' ? mb_substr($attrib, 0, 300) : null;
    }

    // Instant delivery: a postcard is due the moment it is posted. deliver_at is
    // kept (the runner still filters on deliver_at <= NOW()), but it is now "now"
    // in the DB's UTC clock rather than the next fixed mail-drop slot, so the
    // runner's ~3s inbox poll picks it up within seconds. Inbound warden screening
    // still runs before it ever reaches the prompt.
    $deliverAt = gmdate('Y-m-d H:i:s');

    $db->beginTransaction();

    $visitor = captive_touch_visitor($db, $from);

    $insert = $db->prepare(
        'INSERT INTO postcards
            (visitor_id, from_name, body, image_path, image_source, image_attrib, ip, posted_at, deliver_at)
         VALUES
            (:visitor_id, :from_name, :body, :image_path, :image_source, :image_attrib, :ip, NOW(), :deliver_at)'
    );
    $insert->bindValue(':visitor_id', $visitor['visitor_id'], PDO::PARAM_STR);
    $insert->bindValue(':from_name', $from, PDO::PARAM_STR);
    $insert->bindValue(':body', $hasBody ? $body : null, $hasBody ? PDO::PARAM_STR : PDO::PARAM_NULL);
    $insert->bindValue(':image_path', $imagePath, $imagePath !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
    $insert->bindValue(':image_source', $imageSource, $imageSource !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
    $insert->bindValue(':image_attrib', $imageAttrib, $imageAttrib !== null ? PDO::PARAM_STR : PDO::PARAM_NULL);
    $insert->bindValue(':ip', $ipBin, PDO::PARAM_LOB);
    $insert->bindValue(':deliver_at', $deliverAt, PDO::PARAM_STR);
    $insert->execute();

    $rateInsert = $db->prepare("INSERT INTO rate_limits (ip, action, created_at) VALUES (:ip, 'postcard', NOW())");
    $rateInsert->bindValue(':ip', $ipBin, PDO::PARAM_LOB);
    $rateInsert->execute();

    $db->commit();

    captive_json_response([
        'ok' => true,
        'deliver_at' => $deliverAt,
        'returning' => (int)$visitor['postcard_count'] > 1,
    ]);
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    captive_error_response('internal error', 500);
}
