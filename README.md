# CY

CY is a continuous LLM "prisoner" whose stream is watched live at
cy.dabblelabs.uk. This repo contains both the web/API side and the model
runner under `runner/`.

## Architecture

DELL (the runner host) is the only writer. It POSTs everything the model
does -- thoughts, actions, tool calls, whatever -- to `api/ingest.php` as a
batch of events. Every event lands in a single `events` table with a
monotonically increasing `seq`. There is no per-kind table for the live
feed: `kind` + a JSON `payload` column is enough to describe anything the
model does, and a single ordered log makes "what happened, in what order"
trivial to reconstruct and replay.

The current inner-state architecture separates LIVE grounded substrates,
PROVISIONAL visitor-facing metrics, disabled legacy heuristics and subjective
character behaviour through `config/implementation-registry.json`. The older
weighted event-memory matcher in `runner/soma.js` remains compatibility and
diagnostic code only and is not part of live prompt or action selection.

Longer-term continuity uses the provenanced autobiographical-memory system
documented in `docs/autobiographical-memory.md`. MariaDB stores versioned
subjective EPISODIC, PERSON, MOTIF, UNRESOLVED_THREAD and SEMANTIC records with
explicit provenance and privacy scope. Deterministic privacy-filtered retrieval
offers at most ten candidates to a small model-mediated surfacing call, which may
insert zero to three memories into a dedicated prompt block. World events remain
authoritative; autobiography cannot rewrite them. No biological memory or
hippocampal activation model is claimed.

The live pre-language boundary is `runner/soma-cycle.js`. Autonomous journal,
postcard and warden generation all cross it after their new lived input has been
observed. The resulting action and compact natural-language directive enter Zone
C together. `runner/experienced-state.js` v2 is the canonical 0-100 layer for
anxiety, arousal, pain, hunger, fatigue, loneliness, anger and rumination. Each
value is a resting tendency plus persistent, named causal contributors from body
clocks, observed events, appraisal, memory, social contact and bounded self-output
feedback. The body record stores actual eaten, partial, missed and refused meal
outcomes; the last food time and portion; sleep periods and interruptions; and
supportive or rejecting social contact. Hunger changes from the recorded meal,
fatigue changes across recorded waking and sleep time, and ordinary company can
lower social need. Recovering event impulses pass through a soft ceiling, so
ordinary repeated events cannot permanently pin values at 100. Old imported
physical values and migration contributors are discarded. The old overlapping
physical and mental values are compatibility mirrors of this state rather than a
competing simulation. Other legacy composites remain labelled placeholders.

`runner/environment.js` supplies structured outcomes for the daily prison world.
Breakfast, lunch and tea can be eaten, partly eaten, missed or refused. Shower,
association, yard and phone periods can provide relief, ordinary company,
supportive contact, rejection, cancellation or discomfort. Night noise records a
sleep interruption. These structured facts feed grounded prompt context and the
approved expressive chooser. Structured current context is also used as a search
query for the separate autobiographical-memory retriever; the older weighted
event matcher does not compete for live recall.

Generated prose remains isolated from grounded Soma evidence. Bounded batches may
be offered to autobiographical memory formation as CY_EXPRESSION sources, where
they are explicitly subjective and provenance-bearing. They can support character
continuity but cannot create world facts, threat-learning trials, bodily events,
social episodes or other grounded state.

`runner/soma-runtime.js` is the failure boundary. A load or computation failure
is logged once, emits a public `soma_unavailable` event, removes Soma context and
uses a fixed neutral generation profile so Cy continues without falling back to
the legacy mood engine. Vitals snapshots and `api/soma.php` then report Soma as
unavailable instead of manufacturing a replacement state. An invalid persisted
vitals file is preserved once as `vitals.json.invalid.bak` for diagnosis.

The left panel leads with the eight experienced states. Selecting one shows its
current value, resting tendency, trend, exact active causal contributors, and a
real stored 1H, 24H or 7D graph. The brain-shaped rendering is derived from the
same values and is explicitly a functional analogy, not a biological measurement.
Appraisal, drives, prediction, memory, attention, action and learned associations
are retained under collapsed `SOMA DIAGNOSTICS`; older heartbeat, mood, composite,
amplification, brain-region and relationship figures remain under collapsed
`PLANNED STATS` so implementation status is unambiguous.

The central chronology is a composition of writing bursts, drawings, postcards,
prison events and exact silence spans. Ruled paper appears only on journal-entry
cards; other handwriting uses unruled stock and event records use unlined strips.
All live handwriting shares one chronological animation lane. When a newer visible
item arrives, older queued ink completes immediately so only the final journal,
drawing, or postcard at the bottom of the feed can keep moving.
It is vertically scrollable to the start of its selected day; it never mixes
dates in one scroll surface. A
sticky day banner and a day-only month/date chooser open another date from its
start. Duration events show independently ageing start and end timestamps, while
point events show one timestamp.

Viewers never talk to DELL directly. They poll `api/stream.php?since=<seq>`,
which returns any events newer than the seq they last saw (or, for a first
load, the last N events via a negative `since`). This keeps the runner
completely decoupled from however many people are watching, and lets the
viewer be a dumb polling client with no websocket/SSE infrastructure needed
for the skeleton.

Postcards are accepted immediately. The first eight waiting or recently claimed
items occupy a bounded reply tray; overload remains accepted as durable fan mail instead of
being rejected. Dell claims one reply item at a time, newest-first while it is
fresh, but any item waiting 15 minutes ages into oldest-first priority. Fan mail
is screened and recorded in the public chronology without entering the model
prompt. Every fifth completed reply promotes the oldest archived fan item, and
an empty tray also promotes one, so heavy traffic cannot grow an unbounded model
queue and older accepted mail still has a path back in. The sender receives an
explicit reply-tray or fan-mail receipt; only reply-tray receipts show a waiting
spinner. The server never hands Dell a second postcard while a reply is in
progress. A runner claim abandoned for more than 30 minutes becomes retained
final fan mail rather than lingering or appearing as a fresh delivery again.
The postcard prompt explicitly overrides the private-journal no-reader rule:
Cy must begin by answering a direct question or reacting to one concrete detail
from that particular card before his reply is allowed to become associative.
Abuse rate limits remain separate from overload handling. `news` follows
the existing deliver_at queue shape and shares the runner inbox poll.

The mailbag links to a focused public postcard archive. It reads the same queue
rows without changing their behaviour, loads newest-first in bounded pages, and
filters them as replied, waiting or fan mail. Each reply is associated directly
from its authoritative `postcard_out.reply_to` event. Ordinary visitors only see
mail after the runner has screened and published its arrival; the signed visitor
cookie also lets a sender see their own newly waiting or screened-out postcard,
marked `YOUR POSTCARD`, without exposing the private visitor id. Promoted mail
retains a `CHOSEN FROM FAN MAIL` marker, and terminal fan mail is explicitly not
described as remaining in the active reply queue.

People who write can be remembered. On the first postcard a visitor is issued a
random ID in a signed HttpOnly cookie. Current-sender postcard memories use
SENDER_RECALLABLE scope and can be retrieved only when that exact pseudonymous
visitor is writing again. Model-facing candidates use temporary references and
never include the visitor ID. Public viewers see only explicitly public memory
summaries and the current browser's count of its own sender memories. The older
visitor compact notes and synthetic standing values remain legacy compatibility
data, not the new autobiographical source of truth. IPs live only on
`postcards`/`rate_limits` for rate limiting.

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
expands to the prompt diagnostics (Zone A/B/C with character counts), the full
post-warden output, the sampling params, the timings/counters, and the
selected Soma action and any legacy form/style fields. Private autobiographical
prompt text and exact recalled-memory IDs are redacted from the public event
record; an owner-only server endpoint exposes the exact access trace. A filter bar and free-text search scope
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
  api/soma.php      public latest persisted runner Soma snapshot
  api/soma-history.php  public downsampled 1H/24H/7D experienced-state history
  api/memory.php     public summaries + DELL-only memory query/CRUD operations
  api/memory-inspection.php owner-only exact candidate/selection access traces
  api/post-postcard.php  public: send a postcard (text and/or image)
  api/postcard-archive.php public: paged postcard/reply history with status filter
  api/openverse-search.php  public: proxy Openverse image search for the composer
  api/tempo.php     public: GET current tempo / POST a custom speed (duty cycle)
  api/ingest.php    DELL-only: write events (+ private visitor_seen updates)
  api/inbox.php     DELL-only: claim due postcards/news (+ visitor memory)
  uploads/          re-encoded webp uploads (gitignored, created at runtime)
lib/db.php          PDO factory + config loader
lib/http.php        JSON response + auth helpers
lib/schedule.php     next-mail-drop calculation
lib/image.php       shared image intake: validate, downscale, strip EXIF, WebP
lib/postcard_queue.php  bounded reply tray + fan-mail promotion rules
lib/postcard_archive.php archive filtering, status and reply association
lib/visitor.php     signed visitor cookie + visitors upsert
lib/presence.php    cheap, throttled live-viewer presence (viewers table)
lib/tempo.php       tempo duty-cycle decision (5%/30%/custom) + rate limiting
lib/soma-history.php  validates and downsamples stored Soma history without interpolation
lib/autobiographical_memory.php privacy, ranking, versioning and provenance persistence
config/config.sample.php   template; copy to config/config.php (gitignored)
sql/schema.sql       MariaDB schema (events, postcards, queue state, visitors, news, rate limits, viewers, tempo, drawings)
docs/autobiographical-memory.md memory architecture, limits and privacy boundaries
tests/postcard_queue_test.php  pure reply-tray admission checks
tests/tempo_test.php  pure-logic tests for the tempo/presence rules (php tests/tempo_test.php)
tests/soma_api_test.php  proves the browser API returns the runner snapshot unchanged
runner/              the model runner (drives inmate 7734)
```

## Setup

1. `cp config/config.sample.php config/config.php` and fill in real DB
   credentials and a random `ingest_key`.
2. Import `sql/schema.sql` into a MariaDB 11.8 database.
3. Point the webserver at `public/` as webroot.

## Deploy

Target on vps3: `/home/dabblela/cy/public`.

Stack is Caddy + PHP 8.5-FPM (unix socket) + MariaDB 11.8, same as the rest
of the DabbleLabs vps3 apps. The Caddy block should mirror the existing
`opinionpot.dabblelabs.uk` block, with `root * /home/dabblela/cy/public`
and `php_fastcgi unix//run/php/php8.5-fpm.sock`.

`config/config.php` is not in git -- it must be created on the server
directly (or deployed out-of-band) with real DB credentials and the
`ingest_key` that DELL will also be configured with.
