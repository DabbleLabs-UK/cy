<?php
declare(strict_types=1);

require __DIR__ . '/../lib/db.php';
require __DIR__ . '/../lib/http.php';
require __DIR__ . '/../lib/admin.php';
require __DIR__ . '/../lib/tempo.php';
require __DIR__ . '/../lib/implementation_registry.php';

// Point the viewer at the fake replay feed with ?stream=test so the renderer
// can be exercised with no database present.
$useTest = isset($_GET['stream']) && $_GET['stream'] === 'test';
$streamEndpoint = $useTest ? 'test-stream.php' : 'api/stream.php';

// The operator controls (pause/resume + the RAW debugging view) unlock for an
// ADMIN. Admin is decided server-side (lib/admin.php): EITHER this browser is on
// the same network as DELL - detected automatically from the public IP DELL
// ingests from, no token to type - OR the ?111 fallback flag is present (for the
// owner off-network, e.g. on mobile data). Only then does the RAW option appear in
// the view switch, the operator pause control render, and raw.js load; otherwise
// the page is the ordinary paper sheet and raw.js is never even fetched.
$isAdmin = false;
try {
    $isAdmin = captive_is_admin(captive_db());
} catch (Throwable $e) {
    // DB unreachable: still render the page, honouring the ?111 fallback alone.
    $isAdmin = array_key_exists('111', $_GET);
}
$rawEnabled = $isAdmin; // RAW view and the operator gear menu unlock together on admin

// DAY N pill: day 1 is the intake day itself (see lib/tempo.php). Computed fresh
// on every load so the number is right from first paint; falls back to day 1 if
// the DB is unreachable, same defensive pattern as $isAdmin above.
try {
    $day = captive_incarceration_day(captive_db());
} catch (Throwable $e) {
    $day = 1;
}
$today = (new DateTimeImmutable('now', new DateTimeZone('Europe/London')))->format('Y-m-d');
$implementationRegistry = captive_implementation_registry();

// The view switch (handwritten / plain / raw) is a LOCAL async-select in app.js
// that remembers the session's choice. ?view= is an optional deep-link that forces
// the STARTING view on load; app.js then remembers it like any other choice. RAW
// is honoured only for an admin (it is absent from the control otherwise).
$viewOverride = null;
if (isset($_GET['view'])) {
    $v = $_GET['view'];
    if ($v === 'handwritten' || $v === 'plain' || ($v === 'raw' && $rawEnabled)) {
        $viewOverride = $v;
    }
}

// Cache-busting: append the asset's own modification time as ?v=, so every
// deploy serves fresh JS/CSS and browsers never run a stale cached copy on top
// of newly-deployed files. Automatic - no manual version bumping.
function cy_asset(string $rel): string
{
    $full = __DIR__ . '/' . $rel;
    $v = @filemtime($full) ?: 0;
    return $rel . '?v=' . $v;
}

// cy_asset() only cache-busts the entry-point <script src="...?v="> tags. Every
// entry point (app.js) then statically `import`s further local modules
// (./pen.js, ../components/async-select/async-select.js, ...) with no query
// string of their own - the browser resolves those against the importing
// module's own URL, so they sit at a bare, never-changing URL and can be
// served stale from cache forever regardless of the entry point's ?v=.
//
// Fix: emit a JS import map (root-relative key -> same path + ?v=<mtime>) so
// every local `import`/`import()` specifier is transparently rewritten to a
// versioned URL, however deep the import chain goes. This needs no changes to
// the import statements themselves and covers new imports automatically.
// A .js file that has a same-named .css sibling (the shadow-DOM
// components, which each `new URL('./x.css', import.meta.url)` their own
// stylesheet) takes the newer of the two mtimes, so editing just the CSS
// still bumps the JS's versioned URL and, through import.meta.url, the CSS
// URL derived from it.
function cy_import_map(): string
{
    $roots = ['assets', 'components'];
    $imports = [];
    foreach ($roots as $root) {
        $base = __DIR__ . '/' . $root;
        if (!is_dir($base)) {
            continue;
        }
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS)
        );
        foreach ($it as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'js') {
                continue;
            }
            $full = $file->getPathname();
            $v = @filemtime($full) ?: 0;
            $cssSibling = substr($full, 0, -3) . '.css';
            if (is_file($cssSibling)) {
                $v = max($v, @filemtime($cssSibling) ?: 0);
            }
            $rel = str_replace('\\', '/', substr($full, strlen(__DIR__) + 1));
            $key = '/' . $rel;
            $imports[$key] = $key . '?v=' . $v;
        }
    }
    return json_encode(['imports' => $imports], JSON_UNESCAPED_SLASHES);
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>CY &middot; inmate 7734, HMP ThinkPad</title>
<meta name="description" content="Watch inmate 7734 of HMP ThinkPad write, in real time, by hand.">
<!-- Favicons: rounded stencil "CY" mark. Cache-busted via cy_asset() like the
     stylesheets, so a re-deployed icon is never masked by a stale cached copy. -->
<link rel="icon" type="image/png" sizes="32x32" href="<?= htmlspecialchars(cy_asset('assets/favicon-32.png'), ENT_QUOTES) ?>">
<link rel="icon" type="image/png" sizes="16x16" href="<?= htmlspecialchars(cy_asset('assets/favicon-16.png'), ENT_QUOTES) ?>">
<link rel="icon" type="image/x-icon" href="<?= htmlspecialchars(cy_asset('assets/favicon.ico'), ENT_QUOTES) ?>">
<link rel="apple-touch-icon" sizes="180x180" href="<?= htmlspecialchars(cy_asset('assets/apple-touch-icon.png'), ENT_QUOTES) ?>">
<link rel="stylesheet" href="<?= htmlspecialchars(cy_asset('assets/style.css'), ENT_QUOTES) ?>">
<link rel="stylesheet" href="<?= htmlspecialchars(cy_asset('assets/timetravel.css'), ENT_QUOTES) ?>">
<link rel="stylesheet" href="<?= htmlspecialchars(cy_asset('postcard-layout.css'), ENT_QUOTES) ?>">
<link rel="stylesheet" href="<?= htmlspecialchars(cy_asset('shell-layout.css'), ENT_QUOTES) ?>">
<script>
window.CY = {
  stream: <?= json_encode($streamEndpoint, JSON_UNESCAPED_SLASHES) ?>,
  postPostcard: 'api/post-postcard.php',
  postcardArchive: 'api/postcard-archive.php',
  openverseSearch: 'api/openverse-search.php',
  tempo: 'api/tempo.php',
  // HISTORY MODE: the aggregate day index the calendar dialog draws itself from,
  // and the raw-event range endpoint it touches ONLY to resolve a chosen moment's seq.
  history: 'api/history.php',
  range: 'api/range.php',
  somaHistory: 'api/soma-history.php',
  threatLearning: <?= $isAdmin ? "'api/threat-learning.php'" : 'null' ?>,
  defensiveContext: <?= $isAdmin ? "'api/defensive-context.php'" : 'null' ?>,
  learnedControllability: <?= $isAdmin ? "'api/action-outcome-contingency.php'" : 'null' ?>,
  feeding: <?= $isAdmin ? "'api/feeding.php'" : 'null' ?>,
  somatic: <?= $isAdmin ? "'api/somatic.php'" : 'null' ?>,
  environmentEvent: <?= $rawEnabled ? "'api/environment-event.php'" : 'null' ?>,
  implementationRegistry: <?= json_encode($implementationRegistry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>,
  // Hershey glyph data app.js fetches (not a JS import, so the import map below
  // does not cover it) with `cache: 'force-cache'` - versioned the same way so
  // an edit to the glyph set cannot be masked by that hard caching.
  hershey: <?= json_encode(cy_asset('assets/hershey-cursive.json'), JSON_UNESCAPED_SLASHES) ?>,
  raw: <?= $rawEnabled ? 'true' : 'false' ?>,
  // Server-computed day count (see lib/tempo.php), so app.js has the correct
  // baseline to increment from on a live day rollover without trusting the
  // runner's own counter.
  day: <?= json_encode($day) ?>,
  // Calendar boundary used by the initial full-day feed. Kept server-authored so
  // a visitor in another timezone still sees Cy's Europe/London prison day.
  today: <?= json_encode($today) ?>,
  // Optional starting view from ?view= (handwritten|plain|raw), else null. The
  // view switch is a local async-select in app.js that otherwise remembers the
  // session's choice; this just lets a deep-link pick where it opens.
  viewOverride: <?= $viewOverride !== null ? json_encode($viewOverride, JSON_UNESCAPED_SLASHES) : 'null' ?>,
  // Operator control endpoint (pause/resume + model provider) - only wired in
  // admin mode. null for an ordinary visitor, so no gear appears and it is never
  // called.
  // When admin came from same-network detection the plain URL is enough (admin.php
  // re-checks the network server-side); when it came from ?111 we carry the flag
  // through so admin.php still recognises it off-network.
  admin: <?= $isAdmin ? json_encode('api/admin.php' . (array_key_exists('111', $_GET) ? '?111' : ''), JSON_UNESCAPED_SLASHES) : 'null' ?>,
  // PUBLIC regime control endpoint - always wired, for everyone. The gear menu
  // renders for all visitors but only its Regime group is public; a public regime
  // set is a short self-releasing lease (api/regime.php), not the owner's sticky set.
  regime: <?= json_encode('api/regime.php', JSON_UNESCAPED_SLASHES) ?>
};
</script>
<!-- Must precede every module script: rewrites every local `import`/`import()`
     specifier (however deep the chain - pen.js, the shadow-DOM components, ...)
     to a cache-busted URL. See cy_import_map() above. -->
<script type="importmap"><?= cy_import_map() ?></script>
</head>
<body<?= $useTest ? ' data-test="1"' : '' ?>>

<header id="topbar">
  <!-- Corner logo: bleeds to the top-left viewport edge, its bottom meeting the
       nav divider line (see .brand-logo in style.css). It overlays the reserved
       left padding of #topbar rather than flowing as an inline nav item. -->
  <img class="brand-logo" src="<?= htmlspecialchars(cy_asset('assets/logo-negative.png'), ENT_QUOTES) ?>" width="205" height="200" alt="CY">
  <div class="brand">
    <span class="brand-sub">inmate 7734 &middot; HMP ThinkPad</span>
  </div>
  <div class="topmeta">
    <!-- The inference LED, the view switch, the public model indicator, and (admin
         only) the operator gear menu are inserted here by app.js, to the left of
         these pills. The gear menu is NOT part of the fiction: it pauses/resumes the
         LLM (so idle CPU/memory/draw can be read) and switches the model provider.
         Both actions settle only on the runner's real state off the event stream. -->
    <span id="day" class="pill">DAY <?= $day ?></span>
    <span id="mode" class="pill" data-mode="journal">JOURNAL</span>
    <span id="status" class="pill status">connecting</span>
    <span id="watchers" class="pill watchers-pill" aria-label="Viewer count unavailable">-- WATCHING</span>
  </div>
</header>

<div id="topbar-spacer" aria-hidden="true"></div>

<div id="ticker" class="ticker"></div>

<main class="layout">

  <aside class="col col-brain">
    <div class="panel">
      <div class="panel-title">SOMA / FUNCTIONAL ANALOGY</div>
      <div id="brain"></div>
    </div>
  </aside>

  <section class="col col-paper">
    <div id="paper" class="paper"></div>
    <!-- The handwritten surface is a chronological composition: writing segments,
         event markers and postcard objects all share this one scrolling column. -->
    <?php if ($rawEnabled): ?>
    <!-- RAW debugging view: built and driven by raw.js, hidden until selected. It
         replaces the paper sheet in place (the instrument panels stay). -->
    <div id="raw" class="raw" hidden></div>
    <?php endif; ?>
    <!-- PLAIN reading view: built and driven by plain.js, hidden until the view
         switch selects it (available to everyone). Fed the event stream by app.js
         (not its own poll loop), so switching to it is instant. -->
    <div id="plain" class="plain" hidden></div>
  </section>

  <aside class="col col-side">
    <details class="panel panel-collapsible">
      <summary class="panel-title panel-toggle">HMP ThinkPad &middot; Host</summary>
      <div id="host"></div>
    </details>

    <details class="panel panel-collapsible">
      <summary class="panel-title panel-toggle">THE METER &middot; ELECTRICITY</summary>
      <div id="power"></div>
    </details>

    <details class="panel panel-collapsible">
      <summary class="panel-title panel-toggle">TEMPO &middot; DUTY CYCLE</summary>
      <div id="tempo"></div>
    </details>

    <div class="panel">
      <div class="panel-title">SEND CY A POSTCARD</div>
      <div class="fan-mail-rule">
        <strong>THE FAN MAIL BAG</strong>
        <span>If Cy's reply tray is full, the prison still keeps your postcard in the public archive. It may be chosen for him later.</span>
      </div>
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
              <div class="pc-pic-title">ADD A PICTURE</div>
              <div class="pc-pic-hint">drop an image here</div>
            </div>
            <div class="pc-pic-preview" id="pc-pic-preview" hidden>
              <img id="pc-pic-img" alt="chosen picture">
              <button type="button" class="pc-pic-clear" id="pc-pic-clear" title="remove picture">&times;</button>
              <div class="pc-pic-src" id="pc-pic-src"></div>
            </div>
            <input id="pc-file" name="image" type="file" accept="image/jpeg,image/png,image/webp" hidden>
            <div class="pc-picture-picker" aria-label="Choose a picture source">
              <button type="button" class="pc-browse" id="pc-browse">Choose a file...</button>
              <div class="pc-pic-or">OR SEARCH OPENVERSE</div>
              <div class="pc-ov-row">
                <input id="pc-ov-q" type="text" maxlength="100" placeholder="what picture?">
                <button type="button" id="pc-ov-go">Search</button>
              </div>
              <div id="pc-ov-status" class="pc-ov-status" aria-live="polite"></div>
              <div id="pc-ov-grid" class="pc-ov-grid"></div>
            </div>
          </div>

          <div class="pc-card-actions pc-card-footer">
            <span id="pc-count" class="counter">0 / 900</span>
            <button type="submit" class="pc-send">Post it</button>
          </div>
        </div>

        <p class="form-hint">Text, a picture, or both. A receipt will say whether it reached his reply tray or the fan mail bag.</p>
        <p id="pc-note" class="form-note" aria-live="polite"></p>
      </form>
    </div>

    <div class="panel">
      <div class="panel-heading-row">
        <div class="panel-title">THE MAILBAG</div>
        <button type="button" id="postcard-archive-open" class="panel-heading-action">VIEW ARCHIVE</button>
      </div>
      <div id="mail" class="mailbag"></div>
    </div>
  </aside>

</main>

<dialog id="postcard-archive" class="postcard-archive" aria-labelledby="postcard-archive-title">
  <div class="pcar-shell">
    <header class="pcar-head">
      <div>
        <div id="postcard-archive-title" class="pcar-title">POSTCARD ARCHIVE</div>
        <p class="pcar-intro">Historical postcards and Cy's replies. Fan mail is kept here, but a reply is never promised.</p>
      </div>
      <button type="button" id="postcard-archive-close" class="pcar-close" aria-label="Close postcard archive">&times;</button>
    </header>
    <nav id="postcard-archive-filters" class="pcar-filters" aria-label="Filter postcard archive">
      <button type="button" class="active" data-archive-filter="all" aria-pressed="true">ALL</button>
      <button type="button" data-archive-filter="replied" aria-pressed="false">REPLIED</button>
      <button type="button" data-archive-filter="waiting" aria-pressed="false">WAITING</button>
      <button type="button" data-archive-filter="fan_mail" aria-pressed="false">FAN MAIL</button>
    </nav>
    <div class="pcar-scroll">
      <div id="postcard-archive-status" class="pcar-load-status" role="status" aria-live="polite"></div>
      <div id="postcard-archive-list" class="pcar-list"></div>
      <button type="button" id="postcard-archive-more" class="pcar-more" hidden>LOAD OLDER</button>
    </div>
  </div>
</dialog>

<script type="module" src="<?= htmlspecialchars(cy_asset('shell-layout.js'), ENT_QUOTES) ?>"></script>
<script type="module" src="<?= htmlspecialchars(cy_asset('assets/app.js'), ENT_QUOTES) ?>"></script>
<?php if ($rawEnabled): ?>
<script type="module" src="<?= htmlspecialchars(cy_asset('assets/raw.js'), ENT_QUOTES) ?>"></script>
<?php endif; ?>
<!-- Loaded after app.js so window.__cyPlain is registered before app.js dispatches
     the first-load backlog. Always loaded now (the view switch reveals it); the
     component itself is registered by app.js's own import. -->
<script type="module" src="<?= htmlspecialchars(cy_asset('assets/plain.js'), ENT_QUOTES) ?>"></script>
<!-- HISTORY MODE navigation: the tinted month-calendar dialog. Self-boots and
     registers window.__cyTimeTravel, which the live pill opens. Loaded after app.js
     so the global is present by the time the pill is wired (same pattern as plain.js). -->
<script type="module" src="<?= htmlspecialchars(cy_asset('assets/timetravel.js'), ENT_QUOTES) ?>"></script>
</body>
</html>
