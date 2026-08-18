# CY runner

The process that actually drives inmate 7734. It runs continuously on DELL (a
Dell OptiPlex), streams tokens from a local ollama model, modulates voice and
sampling from a vitals state engine, screens output through a warden, and posts
everything as an event stream to the CY API.

Zero npm dependencies. Node 26+, ESM. Built-in `fetch`, `fs`, `timers`, `os`.

## Run

```bash
cp runner/config.sample.json runner/config.json   # then edit config.json
node runner/run.js
```

There is no build and no `npm install`. `node runner/run.js` is the whole thing.
If `config.json` is absent the runner falls back to `config.sample.json` (which
has `dryRun: true`), so a bare checkout runs offline out of the box.

Stop with Ctrl-C (SIGINT): the batch queue is flushed and vitals are persisted
before exit.

## Config (`config.json`)

| key         | meaning                                                        |
|-------------|----------------------------------------------------------------|
| `apiBase`   | base URL of the CY web app (POST target for ingest/inbox) |
| `ingestKey` | shared secret sent as the `X-Cy-Key` header               |
| `model`     | ollama model tag (do not change - it is benchmarked)           |
| `ollamaUrl` | ollama base URL, e.g. `http://127.0.0.1:11434`                 |
| `dryRun`    | `true` = no network; write events to `state/events.jsonl`      |
| `tickMs`    | vitals tick interval (ms); the design assumes 5000             |
| `threads`   | ollama `num_thread` (benchmarked at 2)                         |
| `costInjectEvery` | inject the electricity cost into the prompt every Nth generation (default 40; a whole-pound crossing also forces it) |
| `logPrompts`| `true` = mirror each built system prompt to `state/prompts.log` (debug) |
| `power`     | `{ idleWatts, loadWatts, tariff }` for the meter (defaults 25 / 55 / 0.245 GBP per kWh) |

The model runs with `num_ctx: 3072`, `num_thread: threads`, `keep_alive: -1`.

## Model

`hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q4_K_M`, served by
ollama, measured at ~3.4 tok/s on DELL. Do not swap the model - the vitals ->
sampling mapping and the token-rate ("broca") signal are tuned around it.

## dryRun

With `dryRun: true` the runner never touches the network:

- events are appended to `runner/state/events.jsonl` instead of being POSTed;
- the inbox is read from `runner/state/inbox.json` (if present) and consumed.

To feed a test postcard in dryRun, drop a file like this at
`runner/state/inbox.json`. A postcard has text and/or an image, and may carry a
`visitor` memory block so a returning writer is recognised:

```json
{ "postcards": [ { "id": 1, "from_name": "mum", "body": "thinking of you son. stay strong.", "image_path": null, "image_attrib": null, "visitor_id": "abc123", "visitor": { "visitor_id": "abc123", "handle": "mum", "visit_count": 4, "postcard_count": 7, "warmth": 0.72, "suspicion": 0.2, "grudge": 0.05, "notes": "garden coming up. told you to eat. asked about visits.", "prev_posted_at": "2026-08-10 13:00:00" } } ], "news": [], "warden": [] }
```

Within 60s the runner picks it up, aborts the current thought mid-word, and
writes a reply in postcard/letter mode. An image-only postcard sets `body` null
and `image_path` to the delivered picture's webroot-relative path. (It still
needs a live ollama to generate.)

A `warden` item is an authored announcement from Warden Florian; it interrupts
like a postcard and CY reacts to it in the stream:

```json
{ "postcards": [], "news": [], "warden": [ { "id": 1, "text": "NOTICE. Association is suspended until further review. By order, Warden Florian." } ] }
```

## What it emits

All events are `{ ts, kind, payload }`. `ts` is a MariaDB `DATETIME(3)` string.

| kind     | payload                                                            |
|----------|-------------------------------------------------------------------|
| `text`   | `{ s, mode }` - a screened chunk of prose (`mode`: journal/letter/warden/sleep) |
| `vitals` | `{ physical, mental, derived, hr, brain, mode, asleep, day, monotony, amp, relations }` every 5s |
| `host`   | `{ cpu, memPct, memMB, gpu:null }` every 10s                       |
| `power`  | `{ watts, kwh_total, cost_total, cost_per_hour, uptime_s }` every 30s |
| `abort`  | `{ cause }` - a thought cut off (letter/notice interrupt or warden block) |
| `mode`   | `{ from, to, cause }` - a mode transition                          |
| `event`  | `{ name, amp, ... }` - an ambient event (meal, cold_tea, social, officer, overheard, warden, ...) |
| `postcard_in`  | `{ id, from, body, image, attrib, visitor_id, visit_count }` - a delivered postcard (public subset; visitor memory stays private) |
| `postcard_out` | `{ id, reply_to, body }` - CY's reply to a postcard              |
| `visitor_seen` | `{ visitor_id, notes, warmth, suspicion, grudge }` - PRIVATE: a memory/standing write-back consumed by `ingest.php`, never inserted into the event log or streamed |
| `day`    | `{ n, date }` - day rollover (Europe/London)                      |
| `tempo`  | `{ speed, viewers, custom, pph_idle, pph_load }` - emitted when the viewer-driven tempo changes; the pence/hour anchors let the viewer show the cost of watching |
| `draw`   | `{ id, title, strokes, pass:{i,n,label}, mood }` - one build-up pass of a drawing; the same pen engine animates the stroke DSL glyph-for-glyph. Passes sharing `id` build the picture (under -> detail -> shade) |
| `draw_saved` | `{ id, ts, title, subject, strokes, mood, stroke_count, requested_by }` - PRIVATE: the finished-drawing record consumed by `ingest.php` into the `drawings` table, never streamed |

`brain` is a map of ten region activations (0..1). `derived` is the seven
composite states (confusion, overwhelm, numbness, paranoia, fixation,
resignation, brittleness). `relations` is the cast grudge map (per inmate:
warmth/suspicion/grudge). `amp = 1 + 2.5*monotony` scales every event delta.

## Mechanics

- **Amplification** - `monotony` (0..1) creeps up every empty tick and drops on
  any input. Event deltas are multiplied by `amp = 1 + 2.5*monotony`, so after a
  long dead stretch a trivial slight (cold tea, no eggs) lands like a bereavement,
  and can be flagged as the thing that defines the day.
- **The cast** (`cast.js`) - eight other inmates (Root, Reg, Bill, Mark, Nick,
  Fisher, Ping, Daemon) as deterministic state + prompt text, not separate LLMs.
  A relations map (warmth/suspicion/grudge) is nudged by ambient social events
  (scaled by amp); a grudge over 0.7 puts a named directive in the prompt.
- **The officers** (`cast.js`) - a separate group (Mr Locke, Mr Keyes, Miss
  Bailey, Mr Proctor, Mr Sweep, Miss Trace) with SURNAMES AND TITLES - a
  deliberate class marker against the inmates' bare first names. Same standing
  triple; nudged by officer events (order, write-up, refusal, search, lock-up,
  kindness) that act through the machinery of the place.
- **Overheard** (`cast.js`) - things CY only half hears through the door: an
  inmate shouting, two officers talking. He may MISHEAR them into something about
  himself; the mishear chance rises with low lucidity and high paranoia.
- **Visitors** (`cast.js`) - people who write are remembered (DB-backed) using
  the SAME relations mechanism. A returning writer's handle, count, time-since,
  a condensed memory and CY's standing are woven into the reply prompt; after the
  reply a cheap compressed note + standing nudge are written back via a private
  `visitor_seen` event (no second model call).
- **Warden Florian** - authored `warden` inbox items are read and reacted to in
  the stream; they land `{anxiety+0.2, anger+0.15, lucidity+0.1}` times amp.
- **The meter** (`power.js`) - estimates Dell OptiPlex draw from CPU load,
  integrates to kWh and cost at the tariff, persists cumulatively to
  `state/power.json`, and periodically tells CY what he costs (Warden pays).
- **Drawing** (`draw.js`) - occasionally (roughly one per 20-40 min waking,
  weighted by fixation/dissociation/longing, a fresh postcard image, or waiting)
  he draws instead of writing. Two stages: he decides in ONE line of his own
  voice what he is drawing and why (streamed as normal text), then a second
  generation emits ONLY a coarse 0-100 stroke DSL (`P/L/D/C/A/H/T`). The DSL is
  parsed defensively (bad lines skipped, coords clamped, 120-stroke cap, <3
  strokes discarded), split into build-up passes (rough shapes -> detail ->
  shading), and emitted as `draw` events the SAME pen engine animates stroke by
  stroke - no second renderer. A postcard can ASK him to draw something (keyword
  match, no LLM); he honours it, honours it badly, or refuses and draws his own,
  weighted by standing + mood. Mood shapes the marks (anger heavier, despair
  fainter/sparser). Finished drawings persist to the `drawings` table via a
  private `draw_saved` event.
- **Tempo** (`tempo.js`) - a viewer-driven DUTY CYCLE. The client polls
  `GET /api/tempo.php` (~12s) for the current speed (5% nobody watching, 30%
  someone watching, or a viewer's custom 1-100); after each waking burst the loop
  idles `burst * (100/speed - 1)` ms (clamped to 2 min) so lower speeds insert
  proportional silence. It is the machine throttled, NOT a narrative `silence`,
  so no silence event is emitted and the vitals/host/power ticks keep going. If
  the endpoint is unreachable the last known tempo is kept (never stalls or runs
  flat out). In dryRun the tempo is read from an optional `state/tempo.json`.

## Pieces

- `vitals.js` - state engine: drift, derived states, amplification, event deltas.
- `cast.js` - inmates + officers + visitor memory: relations map, social/officer
  events, overheard remarks, grudge directive, visitor recognition.
- `power.js` - electricity meter: CPU-derived watts, kWh/cost, cost injection.
- `prompt.js` - system prompt, style directive, sampling, contextual injections.
- `warden.js` - sentence buffering + outbound/inbound content screen.
- `client.js` - batched POST to `api/ingest.php`, inbox poll, tempo poll, disk-queue retry.
- `tempo.js` - duty-cycle timing: `tempoIdleMs(burstMs, speed)` and speed clamping.
- `draw.js` - drawing: DSL parse/caps, build-up passes, frequency + request
  weighting, and the two-stage prompt text. Renders through `pen.js` (which owns
  the pure DSL-stroke -> SVG-path geometry, shared so tests can validate it).
- `run.js` - the loop: generation, ticks, scheduler, postcard/notice interrupts.
- `selftest.js` - deterministic checks for the above (no ollama needed).
- `livesample.js` - drives two real generations to sample CY's prose.
- `drawtest.js` - drives two real DRAWINGS against ollama, printing the raw DSL
  and confirming the parser/geometry, with NO writes to the site (in-memory
  dryRun config; never touches `config.json`).

`state/` (gitignored) holds runtime files: `vitals.json`, `power.json`,
`context.jsonl`, `events.jsonl` (dryRun), `queue.jsonl` (offline retry),
`blocked.log`, `prompts.log` (when `logPrompts`).

## The runner never crashes the stream

Network failures queue events to `state/queue.jsonl` and retry with backoff.
ollama being down is logged and retried. Warden blocks become in-world lost
thoughts (`abort` events), never hard errors. The generation loop is wrapped so
one bad generation does not take the process down.
