<?php
declare(strict_types=1);

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/schedule.php';

const CAPTIVE_MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const CAPTIVE_MAX_DIMENSION = 1200;

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        captive_error_response('method not allowed', 405);
    }

    if (!isset($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
        captive_error_response('image upload required', 422);
    }

    $file = $_FILES['image'];
    if ($file['size'] > CAPTIVE_MAX_UPLOAD_BYTES) {
        captive_error_response('image too large (max 3MB)', 422);
    }

    $info = @getimagesize($file['tmp_name']);
    if ($info === false) {
        captive_error_response('invalid image', 422);
    }

    $mime = $info['mime'];
    $allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!in_array($mime, $allowed, true)) {
        captive_error_response('unsupported image type', 422);
    }

    $db = captive_db();
    $ipBin = @inet_pton(captive_client_ip());
    if ($ipBin === false) {
        $ipBin = null;
    }

    $rateStmt = $db->prepare("SELECT COUNT(*) FROM rate_limits WHERE ip = :ip AND action = 'image' AND created_at > (NOW() - INTERVAL 10 MINUTE)");
    $rateStmt->bindValue(':ip', $ipBin, PDO::PARAM_LOB);
    $rateStmt->execute();
    if ((int)$rateStmt->fetchColumn() >= 3) {
        captive_error_response('rate limit exceeded, try again later', 429);
    }

    $source = match ($mime) {
        'image/jpeg' => imagecreatefromjpeg($file['tmp_name']),
        'image/png' => imagecreatefrompng($file['tmp_name']),
        'image/webp' => imagecreatefromwebp($file['tmp_name']),
        default => false,
    };
    if ($source === false) {
        captive_error_response('could not read image', 422);
    }

    $origW = imagesx($source);
    $origH = imagesy($source);
    $longest = max($origW, $origH);
    if ($longest > CAPTIVE_MAX_DIMENSION) {
        $scale = CAPTIVE_MAX_DIMENSION / $longest;
        $newW = (int)round($origW * $scale);
        $newH = (int)round($origH * $scale);
    } else {
        $newW = $origW;
        $newH = $origH;
    }

    $resized = imagecreatetruecolor($newW, $newH);
    imagealphablending($resized, false);
    imagesavealpha($resized, true);
    imagecopyresampled($resized, $source, 0, 0, 0, 0, $newW, $newH, $origW, $origH);
    imagedestroy($source);

    $year = date('Y');
    $month = date('m');
    $dir = __DIR__ . "/../uploads/$year/$month";
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        imagedestroy($resized);
        captive_error_response('storage unavailable', 500);
    }

    $filename = bin2hex(random_bytes(16)) . '.webp';
    $fullPath = "$dir/$filename";

    if (!imagewebp($resized, $fullPath, 85)) {
        imagedestroy($resized);
        captive_error_response('could not save image', 500);
    }
    imagedestroy($resized);

    $relativePath = "uploads/$year/$month/$filename";
    $deliverAt = captive_next_deliver_at();

    $db->beginTransaction();

    $insert = $db->prepare('INSERT INTO images (path, w, h, posted_at, deliver_at) VALUES (:path, :w, :h, NOW(), :deliver_at)');
    $insert->bindValue(':path', $relativePath, PDO::PARAM_STR);
    $insert->bindValue(':w', $newW, PDO::PARAM_INT);
    $insert->bindValue(':h', $newH, PDO::PARAM_INT);
    $insert->bindValue(':deliver_at', $deliverAt, PDO::PARAM_STR);
    $insert->execute();

    $rateInsert = $db->prepare("INSERT INTO rate_limits (ip, action, created_at) VALUES (:ip, 'image', NOW())");
    $rateInsert->bindValue(':ip', $ipBin, PDO::PARAM_LOB);
    $rateInsert->execute();

    $db->commit();

    captive_json_response(['ok' => true, 'deliver_at' => $deliverAt]);
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    captive_error_response('internal error', 500);
}
