<?php
declare(strict_types=1);

// Point the viewer at the fake replay feed with ?stream=test so the renderer
// can be exercised with no database present.
$useTest = isset($_GET['stream']) && $_GET['stream'] === 'test';
$streamEndpoint = $useTest ? 'test-stream.php' : 'api/stream.php';
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>CY &middot; inmate 7734, HMP ThinkPad</title>
<meta name="description" content="Watch inmate 7734 of HMP ThinkPad write, in real time, by hand.">
<link rel="stylesheet" href="assets/style.css">
<script>
window.CY = {
  stream: <?= json_encode($streamEndpoint, JSON_UNESCAPED_SLASHES) ?>,
  postLetter: 'api/post-letter.php',
  postImage: 'api/post-image.php'
};
</script>
</head>
<body<?= $useTest ? ' data-test="1"' : '' ?>>

<header id="topbar">
  <div class="brand">
    <span class="brand-mark">CY</span>
    <span class="brand-sub">inmate 7734 &middot; HMP ThinkPad</span>
  </div>
  <div class="topmeta">
    <span id="day" class="pill">DAY --</span>
    <span id="mode" class="pill" data-mode="journal">JOURNAL</span>
    <span id="status" class="pill status">connecting</span>
  </div>
</header>

<div id="ticker" class="ticker"></div>

<main class="layout">

  <aside class="col col-brain">
    <div class="panel">
      <div class="panel-title">CORTICAL READOUT</div>
      <div id="brain"></div>
    </div>
  </aside>

  <section class="col col-paper">
    <div id="paper" class="paper"></div>
  </section>

  <aside class="col col-side">
    <div class="panel">
      <div id="host"></div>
    </div>

    <div class="panel">
      <div class="panel-title">SEND A POSTCARD</div>
      <form id="letter-form" class="cell-form" autocomplete="off">
        <input id="letter-from" name="from" type="text" maxlength="40" placeholder="your name" required>
        <textarea id="letter-body" name="body" maxlength="900" rows="4" placeholder="write to 7734..." required></textarea>
        <div class="form-row">
          <span id="letter-count" class="counter">0 / 900</span>
          <button type="submit">Post letter</button>
        </div>
        <p class="form-hint">Mail is only delivered at 08:00, 13:00 and 19:00 UK time.</p>
        <p id="letter-note" class="form-note"></p>
      </form>
    </div>

    <div class="panel">
      <div class="panel-title">SEND AN IMAGE</div>
      <form id="image-form" class="cell-form" autocomplete="off">
        <input id="image-file" name="image" type="file" accept="image/jpeg,image/png,image/webp" required>
        <div class="form-row">
          <span class="form-hint">JPG / PNG / WEBP, max 3MB</span>
          <button type="submit">Send image</button>
        </div>
        <p id="image-note" class="form-note"></p>
      </form>
    </div>

    <div class="panel">
      <div class="panel-title">THE MAILBAG</div>
      <div id="mail" class="mailbag"></div>
    </div>
  </aside>

</main>

<script type="module" src="assets/app.js"></script>
</body>
</html>
