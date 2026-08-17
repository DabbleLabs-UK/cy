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

To feed a test letter in dryRun, drop a file like this at
`runner/state/inbox.json`:

```json
{ "letters": [ { "id": 1, "from_name": "mum", "body": "thinking of you son. stay strong. wrote you a proper letter, coming soon." } ], "images": [], "news": [], "warden": [] }
```

Within 60s the runner picks it up, aborts the current thought mid-word, and
writes a reply in letter mode. (It still needs a live ollama to generate.)

A `warden` item is an authored announcement from Warden Florian; it interrupts
like a letter and CY reacts to it in the stream:

```json
{ "letters": [], "images": [], "news": [], "warden": [ { "id": 1, "text": "NOTICE. Association is suspended until further review. By order, Warden Florian." } ] }
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
| `event`  | `{ name, amp, ... }` - an ambient event (meal, cold_tea, social, warden, ...) |
| `day`    | `{ n, date }` - day rollover (Europe/London)                      |

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
- **Warden Florian** - authored `warden` inbox items are read and reacted to in
  the stream; they land `{anxiety+0.2, anger+0.15, lucidity+0.1}` times amp.
- **The meter** (`power.js`) - estimates Dell OptiPlex draw from CPU load,
  integrates to kWh and cost at the tariff, persists cumulatively to
  `state/power.json`, and periodically tells CY what he costs (Warden pays).

## Pieces

- `vitals.js` - state engine: drift, derived states, amplification, event deltas.
- `cast.js` - the other inmates: relations map, social events, grudge directive.
- `power.js` - electricity meter: CPU-derived watts, kWh/cost, cost injection.
- `prompt.js` - system prompt, style directive, sampling, contextual injections.
- `warden.js` - sentence buffering + outbound/inbound content screen.
- `client.js` - batched POST to `api/ingest.php`, inbox poll, disk-queue retry.
- `run.js` - the loop: generation, ticks, scheduler, letter/notice interrupts.
- `selftest.js` - deterministic checks for the above (no ollama needed).
- `livesample.js` - drives two real generations to sample CY's prose.

`state/` (gitignored) holds runtime files: `vitals.json`, `power.json`,
`context.jsonl`, `events.jsonl` (dryRun), `queue.jsonl` (offline retry),
`blocked.log`, `prompts.log` (when `logPrompts`).

## The runner never crashes the stream

Network failures queue events to `state/queue.jsonl` and retry with backoff.
ollama being down is logged and retried. Warden blocks become in-world lost
thoughts (`abort` events), never hard errors. The generation loop is wrapped so
one bad generation does not take the process down.
