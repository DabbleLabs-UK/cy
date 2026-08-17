# CAPTIVE runner

The process that actually drives inmate 7734. It runs continuously on DELL (a
Dell OptiPlex), streams tokens from a local ollama model, modulates voice and
sampling from a vitals state engine, screens output through a warden, and posts
everything as an event stream to the CAPTIVE API.

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
| `apiBase`   | base URL of the CAPTIVE web app (POST target for ingest/inbox) |
| `ingestKey` | shared secret sent as the `X-Captive-Key` header               |
| `model`     | ollama model tag (do not change - it is benchmarked)           |
| `ollamaUrl` | ollama base URL, e.g. `http://127.0.0.1:11434`                 |
| `dryRun`    | `true` = no network; write events to `state/events.jsonl`      |
| `tickMs`    | vitals tick interval (ms); the design assumes 5000             |
| `threads`   | ollama `num_thread` (benchmarked at 2)                         |

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
{ "letters": [ { "id": 1, "from_name": "mum", "body": "thinking of you son. stay strong. wrote you a proper letter, coming soon." } ], "images": [], "news": [] }
```

Within 60s the runner picks it up, aborts the current thought mid-word, and
writes a reply in letter mode. (It still needs a live ollama to generate.)

## What it emits

All events are `{ ts, kind, payload }`. `ts` is a MariaDB `DATETIME(3)` string.

| kind     | payload                                                            |
|----------|-------------------------------------------------------------------|
| `text`   | `{ s, mode }` - a screened chunk of prose (`mode`: journal/letter/sleep) |
| `vitals` | `{ physical, mental, hr, brain, mode, asleep, day }` every 5s      |
| `host`   | `{ cpu, memPct, memMB, gpu:null }` every 10s                       |
| `abort`  | `{ cause }` - a thought cut off (letter interrupt or warden block) |
| `mode`   | `{ from, to, cause }` - a mode transition                          |
| `event`  | `{ name, ... }` - a scripted ambient event (meal, lights_out, ...) |
| `day`    | `{ n, date }` - day rollover (Europe/London)                      |

`brain` is a map of nine region activations (0..1): amygdala, acc, insula,
hippocampus, dlpfc, broca, v1, locusCoeruleus, dmn, thalamus.

## Pieces

- `vitals.js` - state engine: drift, event deltas, heart rate, brain regions.
- `prompt.js` - system prompt, vitals-driven style directive and sampling.
- `warden.js` - sentence buffering + outbound/inbound content screen.
- `client.js` - batched POST to `api/ingest.php`, inbox poll, disk-queue retry.
- `run.js` - the loop: generation, ticks, scheduler, letter interrupts, signals.

`state/` (gitignored) holds runtime files: `vitals.json`, `context.jsonl`,
`events.jsonl` (dryRun), `queue.jsonl` (offline retry), `blocked.log`.

## The runner never crashes the stream

Network failures queue events to `state/queue.jsonl` and retry with backoff.
ollama being down is logged and retried. Warden blocks become in-world lost
thoughts (`abort` events), never hard errors. The generation loop is wrapped so
one bad generation does not take the process down.
