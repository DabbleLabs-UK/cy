<?php
declare(strict_types=1);

require __DIR__ . '/../lib/db.php';
require __DIR__ . '/../lib/http.php';
require __DIR__ . '/../lib/admin.php';

// Point the viewer at the fake replay feed with ?stream=test so the renderer
// can be exercised with no database present.
$useTest = isset($_GET['stream']) && $_GET['stream'] === 'test';
$streamEndpoint = $useTest ? 'test-stream.php' : 'api/stream.php';

// The operator controls (pause/resume + the RAW debugging view) unlock for an
// ADMIN. Admin is decided server-side (lib/admin.php): EITHER this browser is on
// the same network as DELL - detected automatically from the public IP DELL
// ingests from, no token to type - OR the ?111 fallback flag is present (for the
// owner off-network, e.g. on mobile data). Only then do the pause control and the
// HANDWRITTEN | RAW toggle render and raw.js load; otherwise the page is the
// ordinary paper sheet and raw.js is never even fetched.
$isAdmin = false;
try {
    $isAdmin = captive_is_admin(captive_db());
} catch (Throwable $e) {
    // DB unreachable: still render the page, honouring the ?111 fallback alone.
    $isAdmin = array_key_exists('111', $_GET);
}
$rawEnabled = $isAdmin; // RAW view and the pause control unlock together on admin

// Cache-busting: append the asset's own modification time as ?v=, so every
// deploy serves fresh JS/CSS and browsers never run a stale cached copy on top
// of newly-deployed files. Automatic - no manual version bumping.
function cy_asset(string $rel): string
{
    $full = __DIR__ . '/' . $rel;
    $v = @filemtime($full) ?: 0;
    return $rel . '?v=' . $v;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>CY &middot; inmate 7734, HMP ThinkPad</title>
<meta name="description" content="Watch inmate 7734 of HMP ThinkPad write, in real time, by hand.">
<link rel="stylesheet" href="<?= htmlspecialchars(cy_asset('assets/style.css'), ENT_QUOTES) ?>">
<script>
window.CY = {
  stream: <?= json_encode($streamEndpoint, JSON_UNESCAPED_SLASHES) ?>,
  postPostcard: 'api/post-postcard.php',
  openverseSearch: 'api/openverse-search.php',
  tempo: 'api/tempo.php',
  raw: <?= $rawEnabled ? 'true' : 'false' ?>,
  // Operator pause/resume endpoint - only wired in admin mode. null for an
  // ordinary visitor, so no control appears and the endpoint is never called.
  // When admin came from same-network detection the plain URL is enough (admin.php
  // re-checks the network server-side); when it came from ?111 we carry the flag
  // through so admin.php still recognises it off-network.
  admin: <?= $isAdmin ? json_encode('api/admin.php' . (array_key_exists('111', $_GET) ? '?111' : ''), JSON_UNESCAPED_SLASHES) : 'null' ?>
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
<?php if ($rawEnabled): ?>
    <!-- Operator pause/resume. Admin-only (?111). NOT part of the fiction: this is
         a real control that stops the LLM so idle CPU/memory/draw can be read. -->
    <button id="admin-pause" class="admin-btn" type="button"
            title="Operator control: stop or resume the LLM (not part of the fiction). Paused = no generation, so CPU and the meter's DRAW fall toward idle.">PAUSE</button>
<?php endif; ?>
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
    <!-- Postcard replies: distinct card objects that appear over the sheet, are
         written on live, then settle into place while the journal resumes beneath. -->
    <div id="postcards" class="postcards"></div>
    <?php if ($rawEnabled): ?>
    <!-- RAW debugging view: built and driven by raw.js, hidden until selected. It
         replaces the paper sheet in place (the instrument panels stay). -->
    <div id="raw" class="raw" hidden></div>
    <?php endif; ?>
  </section>

  <aside class="col col-side">
    <div class="panel">
      <div id="host"></div>
    </div>

    <div class="panel">
      <div class="panel-title">THE METER &middot; ELECTRICITY</div>
      <div id="power"></div>
    </div>

    <div class="panel">
      <div class="panel-title">TEMPO &middot; DUTY CYCLE</div>
      <div id="tempo"></div>
    </div>

    <div class="panel">
      <div class="panel-title">SEND CY A POSTCARD</div>
      <form id="postcard-form" class="postcard-form" autocomplete="off">

        <div class="postcard">
          <!-- message side -->
          <div class="pc-side pc-msg">
            <textarea id="pc-body" name="body" maxlength="900" rows="6" placeholder="write to 7734... (or send just a picture)"></textarea>
            <div class="pc-stamp-line">
              <input id="pc-from" name="from" type="text" maxlength="40" placeholder="your name" required>
            </div>
          </div>

          <!-- divide -->
          <div class="pc-divide" aria-hidden="true"></div>

          <!-- picture side -->
          <div class="pc-side pc-pic" id="pc-drop">
            <div class="pc-pic-empty" id="pc-pic-empty">
              <div class="pc-pic-hint">drag a picture here</div>
              <div class="pc-pic-or">or</div>
              <button type="button" class="pc-browse" id="pc-browse">Browse&hellip;</button>
              <div class="pc-pic-or">or search below</div>
            </div>
            <div class="pc-pic-preview" id="pc-pic-preview" hidden>
              <img id="pc-pic-img" alt="chosen picture">
              <button type="button" class="pc-pic-clear" id="pc-pic-clear" title="remove picture">&times;</button>
              <div class="pc-pic-src" id="pc-pic-src"></div>
            </div>
            <input id="pc-file" name="image" type="file" accept="image/jpeg,image/png,image/webp" hidden>
          </div>
        </div>

        <!-- openverse search -->
        <div class="pc-ov">
          <div class="pc-ov-row">
            <input id="pc-ov-q" type="text" maxlength="100" placeholder="search Openverse for a picture...">
            <button type="button" id="pc-ov-go">Search</button>
          </div>
          <div id="pc-ov-status" class="pc-ov-status"></div>
          <div id="pc-ov-grid" class="pc-ov-grid"></div>
        </div>

        <div class="form-row">
          <span id="pc-count" class="counter">0 / 900</span>
          <button type="submit" class="pc-send">Post it</button>
        </div>
        <p class="form-hint">He gets it straight away. Text, a picture, or both.</p>
        <p id="pc-note" class="form-note"></p>
      </form>
    </div>

    <div class="panel">
      <div class="panel-title">THE MAILBAG</div>
      <div id="mail" class="mailbag"></div>
    </div>
  </aside>

</main>

<script type="module" src="<?= htmlspecialchars(cy_asset('assets/app.js'), ENT_QUOTES) ?>"></script>
<?php if ($rawEnabled): ?>
<script type="module" src="<?= htmlspecialchars(cy_asset('assets/raw.js'), ENT_QUOTES) ?>"></script>
<?php endif; ?>
</body>
</html>
