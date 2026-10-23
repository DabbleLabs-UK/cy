# Fixed meal-choice real-model rehearsal

Runtime candidate: `5087e53`. This directory adds rehearsal tooling/evidence only.

Exactly 20 predeclared synthetic opportunities, no repairs/replacements/retries.
Four existing meal types cross sparse/empty/partly-full/full context; two cases
add a supported synthetic forearm abrasion and two repeat earlier inputs exactly.
No food preferences, dieting motives, ingredients or refusal reasons are supplied.

The fullness groups are explicit hypothetical **synthetic current gut-state
checkpoints**, not a claim that natural scheduled meals generate these states.
The fixture initializes the existing satiety substrate with canonical prior
intake, declares its current stomach contents, and uses the unchanged actual
Soma projection. No parameter, formula, threshold or sensation mapping changes.
Subjective hunger is not modeled and is not invented for an 'empty' case.

The harness imports actual `decideMeal`, `mealModelCall`, `options`, provider
`rawGenerate`, `InferenceCoordinator`, shared lease/profile, timeout and canonical
intake/Soma helpers. It does not launch the main loop. Live Tempo scheduling,
publication, production accounting and observation interruptions are excluded;
synthetic clock/checkpoints and offline effects are deliberate isolation seams.
This tests the production request/model/parser/lifecycle, not an end-to-end live
meal or the deployed orchestration main loop.

Read-only authority checks confirmed active character provider `ollama`, model
`hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M`, Windows-local
Ollama 0.34.1, model manifest digest
`c6ec899cdf5f8e3f55350f7fc28735be2f77556c011f71a5bf6402556aba1cc8`, and the shared
3072-context/4-thread arbiter profile. No inference goes to DeepSeek. The model
and arbiter are reached from native Windows, not WSL loopback. Rehearsal requests
take/release ordinary fair shared leases; CY and Feddit remain running normally.
There is no pause, maintenance hold, server start, model unload, restart or deploy.

Offline preparation is `node rehearse.mjs --prepare <new-output-directory>`.
Real execution requires the explicit `--execute-20-actual-configured-model` flag.
The destination must not already exist, so an interrupted run cannot be silently
resumed/replaced. A durable send ledger is appended before each model call.
Per-opportunity bound is 600 seconds including queue access; release cleanup is
bounded to five seconds. The overall admission deadline is two hours; a final
case admitted just before that deadline may finish up to 605 seconds later.
There is no extension or replacement opportunity. Results are retained after
every case. This wrapper limit does not alter model input or production policy.

`prepared/requests.json` freezes every request, schema, sampler and exact supported
body context before inference. `prepared/failure-semantics.json` contains seven
offline failure probes: malformed, third action, no result, provider failure,
timeout, cancellation and stale response. All must yield unknown consumption.

The completed fixed run and conservative assessment are in `RESULTS.md`.
`evidence/` preserves raw model/provider metadata, lifecycle checkpoints,
canonical consequences and the send ledger. There were exactly 20 model calls,
all valid eat; mechanical validity does not demonstrate context sensitivity.

The source archive SHA-256 is
`2296b7c3969ea8e104c75626629324ad301ed0613ef29179476cdca048319357`.
The initial isolated offline check found a missing read-only implementation
registry dependency, before any inference. Supplementary tracked registry/model
specifications were transferred separately with SHA-256
`6666c7cefc206b9976af5d725b10f0fe6416f95d01af2f62b5428b29ecdab722`.
The complete package then passed all five offline harness checks on DELL. These
are source-controlled specifications, not production configuration or secrets.
SFTP/SCP setup attempts transferred no model requests; the working existing SSH
stdin route performed exclusive artifact creation and exact archive hash checks.
