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
Everything else (`stream.php`, `post-postcard.php`, `openverse-search.php`)
is public, with IP-based rate limiting on the public write endpoint.

## Layout

```
public/            webroot
  index.php         viewer page + postcard composer
  api/stream.php    public event feed (polling)
  api/post-postcard.php  public: send a postcard (text and/or image)
  api/openverse-search.php  public: proxy Openverse image search for the composer
  api/ingest.php    DELL-only: write events (+ private visitor_seen updates)
  api/inbox.php     DELL-only: claim due postcards/news (+ visitor memory)
  uploads/          re-encoded webp uploads (gitignored, created at runtime)
lib/db.php          PDO factory + config loader
lib/http.php        JSON response + auth helpers
lib/schedule.php     next-mail-drop calculation
lib/image.php       shared image intake: validate, downscale, strip EXIF, WebP
lib/visitor.php     signed visitor cookie + visitors upsert
config/config.sample.php   template; copy to config/config.php (gitignored)
sql/schema.sql       MariaDB schema (events, postcards, visitors, news, rate_limits)
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
