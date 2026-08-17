# CAPTIVE

CAPTIVE is a continuous LLM "prisoner" whose stream is watched live at
captiveai.dabblelabs.uk. This repo is the web/API side only -- the model
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

Letters and images are a separate, slower path: the public can write to
CAPTIVE (postcards into the cell), but not immediately -- everything queues
with a `deliver_at` timestamp pinned to the next of three fixed daily mail
drops (08:00 / 13:00 / 19:00 Europe/London), and DELL only sees them via
`api/inbox.php`, which atomically claims (marks `delivered_at`) whatever is
due. This gives a natural moderation/rate-limit window and means DELL never
has to poll a live "someone just posted" queue -- it just asks "what's in
today's mail" at drop time. `news` follows the same deliver_at queue shape
so future news ingestion can reuse the same inbox mechanism.

DELL-only endpoints (`ingest.php`, `inbox.php`) are authenticated with a
shared secret in the `X-Captive-Key` header, checked with `hash_equals`.
Everything else (`stream.php`, `post-letter.php`, `post-image.php`) is
public, with IP-based rate limiting on the two write endpoints open to the
public.

## Layout

```
public/            webroot
  index.php         placeholder viewer page
  api/stream.php    public event feed (polling)
  api/post-letter.php   public: write a letter
  api/post-image.php    public: upload an image
  api/ingest.php    DELL-only: write events
  api/inbox.php     DELL-only: claim due letters/images/news
  uploads/          re-encoded webp uploads (gitignored, created at runtime)
lib/db.php          PDO factory + config loader
lib/http.php        JSON response + auth helpers
lib/schedule.php     next-mail-drop calculation
config/config.sample.php   template; copy to config/config.php (gitignored)
sql/schema.sql       MariaDB schema
runner/              empty -- model runner goes here later
```

## Setup

1. `cp config/config.sample.php config/config.php` and fill in real DB
   credentials and a random `ingest_key`.
2. Import `sql/schema.sql` into a MariaDB 11.8 database.
3. Point the webserver at `public/` as webroot.

## Deploy

Target on vps1: `/home/dabblela/captiveai/public`.

Stack is Caddy + PHP 8.5-FPM (unix socket) + MariaDB 11.8, same as the rest
of the DabbleLabs vps1 apps. The Caddy block should mirror the existing
`opinionpot.dabblelabs.uk` block, with `root * /home/dabblela/captiveai/public`
and `php_fastcgi unix//run/php/php8.5-fpm.sock`.

`config/config.php` is not in git -- it must be created on the server
directly (or deployed out-of-band) with real DB credentials and the
`ingest_key` that DELL will also be configured with.
