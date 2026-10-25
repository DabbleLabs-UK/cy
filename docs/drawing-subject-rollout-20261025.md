# Drawing subject boundary: production rollout

## Authority and review

Candidate `fix/drawing-subject-boundary-20261025` at
`46d567147de962cd99275b9587492455c6cdaad2` was clean and remote-matched.
Production remained `227b294ef411fa2b9e7125fb44f63420c71050c6` without conflicting
drawing/journal changes. The authorized no-ff merge is
`8c788901b01ace7bea70046682f00fadadcf4ff5`, with those commits as first/second
parents. Its complete tree equals the tested candidate tree
`90173c09f05fab3aa0a7596f2cf1587cfafb5919`. The remote production ref was verified
at the merge. The primary checkout and unrelated unpublished work were preserved.

Final independent committed-diff review: looks-good, no material findings.
Both live drawing callers use the new private native-schema subject call. No
running-commentary system, long journal tail, ONE_SUBJECT or recent-expression
tail enters that call. Existing broker filtering retains state, recent relevant
context and eligible memory with provenance. Complete subjects must fit six
words/60 characters; no extraction, truncation or fallback can salvage diary
prose. The original journal, chooser, cadence, Tempo, shared admission and DSL
machinery remain unchanged except private-subject wiring and truthful empty
failure accounting. The final cancellation fence follows awaited spending and
lease cleanup. The old missing-strokes wording is not used for subject failure.

Tests execute actual function bodies and prove failed/interrupted intent cannot
publish text, append continuation, observe output as expression memory, reach
strokes or count as a published waking expression. Valid intent proceeds to the
existing DSL/artifact path. No repair/replacement or additional inference call
was introduced. This establishes safety, not real-model subject usefulness.

## Validation rerun

| Validation | Result | Time |
| --- | --- | --- |
| New drawing-boundary regressions | 38/38 | 3.543s |
| Combined focused suites | 106/106 | 3.300s |
| Full candidate runner suite | 746/746 | 30.202s |
| Full merge-result runner suite | 746/746 | 28.168s |

No failures, cancellations or skips. Changed JavaScript syntax, data-handling
and model-spec JSON, and whitespace checks passed. No model rehearsal was required
or run. No application/source correction was added during final review.

Parent-workspace log SHA-256:

```
drawing-rollout-new-tests.log
56c5e8790dcf92be5f625e19789d01b879795abce6b3b6f4cea562029bb4dafb
drawing-rollout-focused.log
c6d52d80734e4f035b0f1a0085de667f8c43965aad6a7bda44fbba7b976abf1e
drawing-rollout-full.log
ebc4bb9c0ea427ac4a690a8d72c9484f2dc6c8bc6254ae63afb39994d33bfbc7
drawing-rollout-merged-full.log
ef2627c65e368239c3d3813ef3b323d00abc9398ad420d2b309efb6b6b5e0d33
```

## Narrow publication and verified backup

Only three changed runner runtime files were deployed to `C:\dev\cy` on DELL.
There were no server/public assets, production configuration or migration changes.
Data-handling documentation remains tracked source; tests/docs were not deployed
as runtime dependencies. Shared prompt/warden, context broker and expressive
chooser hashes were checked unchanged before and after installation.

Private backup:
`C:\dev\cy\runner\state\deploy-backup-drawing-subject-8c78890`.
All 914 saved files were read-back/hash verified, including both checkpoint
manifests and every referenced immutable section, original runtime files,
available spool/context/bookkeeping/power and legacy fallbacks. JSON, section
hashes, byte lengths and decoded logical sizes passed. The new module was absent
before deployment. Never restore captured state over subsequent natural work.

The git-archived three-file package was hash-verified before extraction, with
archive entries restricted to the approved paths. Installation order was new
dependency, drawing module, then caller. Package SHA-256:
`146e940ec9b384346774ba928b7b7181b9a5fc8dfbb3f9d18b08ee3d67a58fa6`.
The scoped backup/hash operator SHA-256 was
`e9cf67920429f817a22e2f4dab9cae3fc31ceeba11d73de61b9505d472b9a1f6`.
It did not start the runner, load recovery writers or invoke inference.

Installed at `2026-10-25T20:34:26.533Z`:

| File | Exact deployed SHA-256 |
| --- | --- |
| runner/run.js | 370890396c070f484338ddf23d8de56baabc5c6d61cc5badbe078a4326b4b775 |
| runner/draw.js | dd660dbbc0c3508538f93fa7cd89d7ff68fee6033a053b87899edd2014120e1e |
| runner/drawing-subject.js | 2b6b7ee53e8a997c63e47fbeb518eb8ad01b5825087670ecf5288c32aa2428dc |

The Windows archive contains CRLF checkout bytes. Normalizing only CRLF to LF
gives the exact merged Git-blob SHA-256 values, respectively:

```
25bbdfb6f843eb7b9303500196c9bc3f2d1a10c11f24155298bf933ace01420e
f7604b9e0c872d98b8fd7c2ad134f49566fb721a6202b33b204c9de34d643f8a
c92139e6b3720827cc38575ce83777103674b59c45e42c76e6d9f6a0380a1dd2
```

## Guarded restart and health

The existing guarded helper was requested exactly once with deployment reason
`deploy:drawing-subject-8c78890`. Watchdog stopped old runner PID2996 at
20:35:02.838Z, acknowledged the request and the normal supervisor restarted it.
New application startup: `2026-10-25T20:35:24.288Z`, exactly one runner PID5308.

- Recovery produced valid checkpoint generations `1792960522838-5308-0` and
  `1792960524623-5308-1`; no recovery error observed.
- Mirror synchronized: 12 objects, nine threads, zero adopt/publish divergence.
- Stream advanced from 2986013 to 2986055, with fresh world/vitals timestamps.
- Delivery queue and memory-source spool empty; pending instrumental work empty.
- CY and Feddit HTTPS each returned 200.
- Feddit worker PID14512 and shared arbiter PID13868 unchanged. Normal resource
  contention remains mediated: observed Feddit holding the lease with CY queued,
  not simultaneous heavy execution. No lease expiries were reported.
- Ollama API 0.34.1; loopback listeners 11434/11435 healthy, no 11535 listener.
  Shared profile remains 3072 context/four threads. Restart request cleared.
- Deployed hashes and unchanged shared dependencies reverified.

## Natural evidence and stop boundary

Conservative natural-evidence cutoff after successful health checks:
**25 October 2026 20:36:05.259 GMT / UTC**.

For later natural draws, existing private `drawing-subject` diagnostics distinguish
before/during-subject interruption, accepted/invalid/context/provider outcomes and
downstream DSL failure. Existing inference attempt/timing records show whether
`drawing-base`/detail/shade started; ordinary delivered `draw`/`draw_saved` and
canonical artifacts establish actual publication, not a subject-accepted marker.
Private preparation has no public prose/continuation path. A later evidence audit
should correlate those records, not interpret a journal as proof of a drawing.

No draw, journal, search, synthetic event or model inference was forced. No
post-cutoff behavioral tuning or waiting for a drawing was performed. CY is left
alone; subject quality remains an empirical question for natural selections.
