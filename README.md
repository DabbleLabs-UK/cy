# CY

CY is a continuous LLM "prisoner" whose stream is watched live at
cy.dabblelabs.uk. This repo is the web/API side only -- the model
runner (the process that actually drives the LLM) lives under `runner/`
and is not implemented yet.

## Architecture

DELL (the runner host) is the only writer. It POSTs everything the model
does -- thoughts, actions, tool calls, whatever -- to `api/ingest.php` as a
batch of events. Every event lands in a single `events` table with a
monotonically increasing `seq`. There is no per-kind table for the live
feed: `kind` + a JSON `payload` column is enough to describe anything the
model does, and a single ordered log makes "what happened, in what order"
trivial to reconstruct and replay.

Viewers never talk to DELL directly. They poll `api/stream.php?since=<seq>`,
which returns any events newer than the seq they last saw (or, for a first
load, the last N events via a negative `since`). This keeps the runner
completely decoupled from however many people are watching, and lets the
viewer be a dumb polling client with no websocket/SSE infrastructure needed
for the skeleton.

Postcards are a separate, slower path: the public can write to CY (a
postcard into the cell -- text on one side, a picture on the other, either
optional but at least one required), but not immediately -- everything
queues with a `deliver_at` timestamp pinned to the next of three fixed daily
mail drops (08:00 / 13:00 / 19:00 Europe/London), and DELL only sees them via
`api/inbox.php`, which atomically claims (marks `delivered_at`) whatever is
due. This gives a natural moderation/rate-limit window and means DELL never
has to poll a live "someone just posted" queue -- it just asks "what's in
today's mail" at drop time. `news` follows the same deliver_at queue shape
so future news ingestion can reuse the same inbox mechanism.

People who write are remembered. On the first postcard a visitor is issued a
random id in a signed, httpOnly cookie; a `visitors` row holds a chosen
handle, counts, a compact rolling memory of what they have said, and CY's
standing toward them (the same warmth/suspicion/grudge triple the runner's
inmate cast uses). `api/inbox.php` hands that memory to DELL with each due
postcard so a returning writer is recognised in CY's voice. Nothing
identifying is stored beyond the handle and what they voluntarily wrote; IPs
live only on `postcards`/`rate_limits` for rate limiting.

A picture on a postcard can be an uploaded file OR one chosen from Openverse
(https://api.openverse.org). The client only ever sends a chosen image URL;
the server fetches it itself, validates content-type and size, re-encodes to
WebP (stripping EXIF), and records the attribution. Uploaded and Openverse
images go through the identical pipeline. CY never hotlinks and never trusts
a client-supplied path.

DELL-only endpoints (`ingest.php`, `inbox.php`) are authenticated with a
shared secret in the `X-Cy-Key` header, checked with `hash_equals`.
Everything else (`stream.php`, `post-postcard.php`, `openverse-search.php`,
`tempo.php`) is public, with IP-based rate limiting on the public write
endpoint.

Watching CY has a cost, so viewers get a say in his tempo. Tempo is a DUTY
CYCLE, not a token rate: the model always streams at its natural speed; the
percentage decides how much silence sits between generation bursts (100% =
continuous, the old behaviour; lower = more idle). The effective tempo is
derived from live presence: with nobody watching it drops to 5% (CPU is not
burned narrating an empty cell to nobody); with one or more watching it is 30%,
and any watcher can nudge it 1-100 via `POST /api/tempo.php`. When the last
viewer leaves it reverts to 5% and the custom value is discarded. Presence is
detected from the existing `stream.php` polling (a viewer polls ~1/s): each
poller is keyed by a short-lived token (the visitor cookie if present, else a
random per-session id) and counts as present if seen in the last 15s; presence
writes are throttled to at most once per 5s per viewer. The runner polls
`GET /api/tempo.php` and applies the duty cycle, degrading to its last known
tempo if the endpoint is unreachable. This tempo idle is NOT a narrative
`silence` event (Cy choosing to stop) - it is the machine throttled, so the
vitals/host/power ticks continue and the page never looks frozen.

Sometimes CY draws. Drawing is not a second renderer: it is the SAME pen engine
that writes his handwriting (`public/assets/pen.js`), fed a coarse 0-100 stroke
DSL instead of Hershey glyphs, so a sketch appears stroke by stroke at pen speed,
on the same sheet, in the same ink, inline where he drew it. He decides in one
line of his own voice what he is drawing and why (streamed as normal text), then
a second generation emits only the DSL; it is parsed defensively, split into
build-up passes, and streamed as `draw` events. Finished drawings persist to a
`drawings` table (via a private `draw_saved` event, like `visitor_seen`) so they
replay complete for anyone loading the page mid-stream. A postcard can ask him to
draw something; he honours it, honours it badly, or refuses, by his standing
toward the writer and his mood. See `runner/README.md` for the mechanic.

There is a RAW debugging view, gated behind the `?111` query flag (deliberate
light obscurity, not a login). With `?111` present a HANDWRITTEN | RAW toggle
appears in the chrome (choice remembered per session); RAW replaces the paper
sheet in place - the instrument panels keep updating - with an unstyled,
terminal-flavoured live log of every event, newest at the bottom, polled faster
(~400ms) and rendered token-by-token with no pen pacing, so the stream reads at
the model's real output rate. Each event is one colour-coded line
(timestamp/seq/kind/payload) that expands to its raw JSON; each generation burst
expands to the full prompt (Zone A/B/C with character counts), the full
post-warden output, the sampling params, the timings/counters, and the
mode/form/style directives that fired. A filter bar and free-text search scope
the stream, with per-burst and copy-visible copy buttons; the rendered window is
capped to the most recent 1500 rows (older rows dropped, count shown) to stay
fast over long runs. It is POST-WARDEN ONLY: text the warden blocked is never
shown - a `warden` event carries just a category and a character count, rendered
as `[redacted by warden: <category>]`, so the mechanism is visible but the
blocked content is not. Front end: `public/assets/raw.js` + `public/index.php`.

## Layout

```
public/            webroot
  index.php         viewer page + postcard composer
  api/stream.php    public event feed (polling; also records viewer presence)
  api/post-postcard.php  public: send a postcard (text and/or image)
  api/openverse-search.php  public: proxy Openverse image search for the composer
  api/tempo.php     public: GET current tempo / POST a custom speed (duty cycle)
  api/ingest.php    DELL-only: write events (+ private visitor_seen updates)
  api/inbox.php     DELL-only: claim due postcards/news (+ visitor memory)
  uploads/          re-encoded webp uploads (gitignored, created at runtime)
lib/db.php          PDO factory + config loader
lib/http.php        JSON response + auth helpers
lib/schedule.php     next-mail-drop calculation
lib/image.php       shared image intake: validate, downscale, strip EXIF, WebP
lib/visitor.php     signed visitor cookie + visitors upsert
lib/presence.php    cheap, throttled live-viewer presence (viewers table)
lib/tempo.php       tempo duty-cycle decision (5%/30%/custom) + rate limiting
config/config.sample.php   template; copy to config/config.php (gitignored)
sql/schema.sql       MariaDB schema (events, postcards, visitors, news, rate_limits, viewers, tempo, drawings)
tests/tempo_test.php  pure-logic tests for the tempo/presence rules (php tests/tempo_test.php)
runner/              the model runner (drives inmate 7734)
```

## Setup

1. `cp config/config.sample.php config/config.php` and fill in real DB
   credentials and a random `ingest_key`.
2. Import `sql/schema.sql` into a MariaDB 11.8 database.
3. Point the webserver at `public/` as webroot.

## Deploy

Target on vps1: `/home/dabblela/cy/public`.

Stack is Caddy + PHP 8.5-FPM (unix socket) + MariaDB 11.8, same as the rest
of the DabbleLabs vps1 apps. The Caddy block should mirror the existing
`opinionpot.dabblelabs.uk` block, with `root * /home/dabblela/cy/public`
and `php_fastcgi unix//run/php/php8.5-fpm.sock`.

`config/config.php` is not in git -- it must be created on the server
directly (or deployed out-of-band) with real DB credentials and the
`ingest_key` that DELL will also be configured with.
