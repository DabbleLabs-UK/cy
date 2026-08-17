<?php
declare(strict_types=1);

// image.php - shared image intake for postcards.
//
// Both an uploaded file and a server-fetched Openverse image go through the
// same pipeline: validate content type + size, decode, downscale so the longest
// edge is <= CY_MAX_DIMENSION, strip EXIF (a fresh truecolor canvas carries no
// metadata), and re-encode to WebP under public/uploads/YYYY/MM/. Never trust a
// client-supplied path; never hotlink - the bytes are always re-encoded locally.

const CY_MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const CY_MAX_DIMENSION = 1200;
const CY_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

// Re-encode raw image bytes to a stored WebP. Returns the relative web path
// (e.g. "uploads/2026/08/<hex>.webp") on success, or a string error code
// prefixed "err:" on failure so the caller can map it to a user message.
function captive_store_image(string $bytes): string
{
    if (strlen($bytes) > CY_MAX_UPLOAD_BYTES) {
        return 'err:image too large (max 3MB)';
    }

    $info = @getimagesizefromstring($bytes);
    if ($info === false) {
        return 'err:invalid image';
    }
    if (!in_array($info['mime'], CY_ALLOWED_MIME, true)) {
        return 'err:unsupported image type';
    }

    $source = @imagecreatefromstring($bytes);
    if ($source === false) {
        return 'err:could not read image';
    }

    $origW = imagesx($source);
    $origH = imagesy($source);
    $longest = max($origW, $origH);
    if ($longest > CY_MAX_DIMENSION) {
        $scale = CY_MAX_DIMENSION / $longest;
        $newW = (int)round($origW * $scale);
        $newH = (int)round($origH * $scale);
    } else {
        $newW = $origW;
        $newH = $origH;
    }

    // A brand-new truecolor canvas has no EXIF/metadata: the re-encode strips it.
    $resized = imagecreatetruecolor($newW, $newH);
    imagealphablending($resized, false);
    imagesavealpha($resized, true);
    imagecopyresampled($resized, $source, 0, 0, 0, 0, $newW, $newH, $origW, $origH);
    imagedestroy($source);

    $year = date('Y');
    $month = date('m');
    $dir = __DIR__ . "/../public/uploads/$year/$month";
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        imagedestroy($resized);
        return 'err:storage unavailable';
    }

    $filename = bin2hex(random_bytes(16)) . '.webp';
    $fullPath = "$dir/$filename";
    if (!imagewebp($resized, $fullPath, 85)) {
        imagedestroy($resized);
        return 'err:could not save image';
    }
    imagedestroy($resized);

    return "uploads/$year/$month/$filename";
}

// Fetch an Openverse image URL SERVER-SIDE and hand the bytes to the store
// pipeline. Only https openverse-served hosts are honoured; the content-type and
// size are validated from the response, not from anything the client claims.
// Returns the relative path on success or an "err:" string on failure.
function captive_store_openverse(string $url): string
{
    $parts = @parse_url($url);
    if ($parts === false || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
        return 'err:invalid image url';
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 4,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_USERAGENT => 'CY/1.0 (+https://cy.dabblelabs.uk)',
        // Cap the download so a hostile server cannot stream gigabytes at us.
        CURLOPT_BUFFERSIZE => 65536,
        CURLOPT_NOPROGRESS => false,
        CURLOPT_PROGRESSFUNCTION => static function ($ch, $dlTotal, $dlNow) {
            return $dlNow > CY_MAX_UPLOAD_BYTES ? 1 : 0; // non-zero aborts
        },
    ]);
    $bytes = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $ctype = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);

    if ($bytes === false || $status < 200 || $status >= 300) {
        return 'err:could not fetch image';
    }
    // Trust the decoded bytes over the header, but reject obvious non-images fast.
    if ($ctype !== '' && !preg_match('#^image/#i', $ctype)) {
        return 'err:url is not an image';
    }
    return captive_store_image($bytes);
}
