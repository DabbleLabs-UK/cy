# One-candidate maintainability experiment: obsolete prose publisher

## Candidate and decision

Base production: `ac182f17fad0c1c2941fb4b936c2b53d1f4dea09`.

Remove only `legacyStreamGenerate` and its attached documentation from
`runner/run.js`. Classification: UNREACHABLE and SUPERSEDED, not merely old or
disabled. No neighbouring function, import, state, configuration or test is
removed. Five assertions are added to the existing character-output wiring test.

This was a complete competing publisher immediately above the authoritative
one. It opened a provider stream, primed an opening, screened refusals/repeats,
emitted chunks and recorded spend. An agent searching for generation/publication
could reasonably wonder whether this was a supported fallback and edit the wrong
implementation. The prefix `legacy` suggests age, but does not establish safety.

## Reachability and replacement proof

1. Before deletion the identifier occurs exactly once in tracked source: its
   declaration, nested inside private `main`. It has no call, alias, registration,
   export, property assignment or reference passed to another function.
2. Git commit `b514b16f8dfb383e36d251dbba7e84bf89abb24f` (13 September,
   "Block assistant framing from Cy prose") renamed the original generator to
   this private name and added a new `streamGenerate` that first collects and
   validates a complete candidate. All four existing caller paths retained the
   new name. Current postcard, warden, drawing-intent and journal calls still
   use that replacement, including postcard provider fallback.
3. The supported executable guard calls only `main`. The supervisor starts
   `node runner\\run.js`; hidden and maintenance launchers converge on that
   supervisor. Watchdog/restart/recovery do not select a generator. Configuration
   selects providers, not this implementation. There is no generator fallback
   registration or state-version branch referring to the obsolete name.
4. JavaScript dynamism was checked explicitly: no direct `eval`, generated
   function, VM evaluation or source-string dispatcher can access this private
   binding. Dynamic imports in the runner load named Node filesystem modules,
   not a generator by configuration. A module loaded dynamically cannot access
   another function's private lexical binding. The runner's actual module
   namespace exports nine supported helpers, neither generator nor `main`.
   JSON persistence cannot serialize this unreferenced closure into a callable
   restart path. Arbitrary debugger/source rewriting is not a supported runtime.
5. Deployed DELL `run.js` matched the base LF-normalized SHA-256
   `3682887668401a706d48cc581f7a94924059dbb0e6af91dea7fd28cc24fc65b2`.
   It contained one obsolete identifier and one modern definition. This is not
   a source-only assumption about an unrelated runtime copy.
6. The entire remaining runtime file is byte-identical after LF normalization
   to the base file with just that exact 201-line block excised. The modern
   function, all callers and all recovery/configuration code are unchanged.

Important non-deletions: `setInfer` is passed as `onPhase: setInfer` to the live
inference coordinator, even though a call-only search looks obsolete. The live
generator still uses `onChunk`, NDJSON transport, stripping, refusal/repeat
checks, diagnostics and spend accounting. These helpers remain byte-identical.

## Predeclared measurements

Raw observations: `evidence/obsolete-stream-20261023/{before,after,warm-control}.json`.
The external measurement script and exact commands are preserved in
`evidence/obsolete-stream-20261023/measurement.md`. It was outside the measured
repository and unchanged between runs. Node v22.14.0; ripgrep 15.2.0; Windows.

All bytes/physical lines are LF-normalized UTF-8, including comments/blank lines,
not a claim about executable statement count. The fixed five-file inspection
set is `run.js`, `character-output.js`, `provider.js`, `warden.js` and
`inference-coordinator.js`. It is a reproducible source-context proxy/upper bound,
not a claim that an agent must read every byte or that Codex consumed these
tokens. The heuristic token proxy is `ceil(UTF-8 bytes / 4)`, not an actual model
tokenizer measurement or hidden-context observation.

| Observable | Before | After | Change |
| --- | ---: | ---: | ---: |
| Plausible prose-generator definitions | 2 | 1 | -1 obsolete alternative |
| Obsolete alternatives requiring exclusion | 1 | 0 | eliminated |
| Definition-search hits / files | 2 / 1 | 1 / 1 | one implementation, same file |
| Generator-name search hits in run.js | 12 | 11 | -1 |
| Obsolete identifier in application source | 1 | 0 | -1 |
| Generator-block inspection lines | 520 | 319 | -201 |
| Generator-block inspection bytes | 23,685 | 13,695 | -9,990 |
| Generator-block token proxy | 5,922 | 3,424 | -2,498 |
| Fixed inspection files | 5 | 5 | unchanged |
| Fixed inspection lines | 7,633 | 7,432 | -201 |
| Fixed inspection bytes | 367,251 | 357,261 | -9,990 (2.72%) |
| Fixed inspection token proxy | 91,813 | 89,316 | -2,497 |
| Tracked source files | 379 | 379 | no file deleted |
| Tracked source physical lines | 94,070 | 93,874 | -196 net |
| Tracked source bytes | 4,524,015 | 4,514,402 | -9,613 net |
| All tracked files, including audit/evidence | 524 | 529 | +5 audit files |
| All tracked bytes, including audit/evidence | 12,513,712 | 12,554,503 | archive overhead, not source growth |
| Top-level non-test runner files | 82 | 82 | unchanged |
| Top-level non-test runner lines | 32,705 | 32,504 | -201 |
| Top-level non-test runner bytes | 1,498,954 | 1,488,964 | -9,990 |
| Imports/config branches/call sites removed | 0 / 0 / 0 | 0 / 0 / 0 | none needed |
| Test files collected | 131 | 131 | unchanged |
| Focused results | 46/46 | 46/46 | existing coverage retained |
| Full runner results | 613/613 | 613/613 | existing coverage retained |

Application searches deliberately exclude test fixtures and historical/audit
documentation as plausible runtime implementations. This document necessarily
mentions the deleted name; a completely unscoped text search is not promised to
have fewer historical/documentation hits. The recorded commands/output make
that distinction explicit. Source counts include test code; the five new test
lines explain the difference between gross removal and net reduction.

The useful gain is not a large repository-size reduction: total source shrank
only about 0.21%, and there are not fewer files in the inspection set. It is one
less complete, misleading implementation to read and prove irrelevant. The
focused generator-block proxy shrank by 38.7% in lines and 42.2% in bytes.
Retaining the reproducible audit adds about 40 KB to the complete repository;
this is not repository compression. Those clearly labelled archival files do
not introduce another plausible runtime implementation.

## Test/syntax timing method

Exactly the same syntax command ran nine times per phase, the same ten-file
focused command five times, and the same ordered 131-file full-runner command
three times. Test execution was sequential between phases, with concurrency 2
inside the suite and the same workspace TEMP/TMP. There is no build step or
configured linter for this plain Node runner; syntax and test collection are
reported instead of inventing a build improvement.

Initial before full-run samples were 55.621, 45.586 and 28.563 seconds. After
samples were 28.935, 29.039 and 29.501 seconds. The original source had already
reached the after range before deletion. A clean, existing tree-identical old
worktree was therefore rerun as a warm control using all the same commands.

| Median wall time | Initial before | After | Unchanged old-source warm control |
| --- | ---: | ---: | ---: |
| Syntax check, 9 runs | 205.1 ms | 87.8 ms | 113.9 ms |
| Focused tests, 5 runs | 3.652 s | 2.032 s | 2.152 s |
| Full runner, 3 runs | 45.586 s | 29.039 s | 30.303 s |

The warm-control full-run range was 28.678-30.309 seconds, overlapping the
after range 28.935-29.501. Most apparent speedup is reproducible without deleting
anything. The smaller observed syntax times may include less parsing, but these
measurements do not isolate that from file/process/cache effects and the absolute
cost is small. No meaningful production/build throughput improvement is claimed.

The host was not isolated from ordinary desktop/background load, ordering was
not randomized and process startup/cache effects are material. Timings cannot
establish an inference speedup or meaningful production throughput improvement.
Navigation ambiguity, exact source reduction and unchanged behavior are the
supported conclusions.

## Validation and intentionally retained candidates

Existing tests still cover whole-candidate validation, one repair then silence,
postcard routing/accounting, repeats, cancellation and dream isolation. The
added wiring assertions guard a single live generator, absence of the obsolete
alternative and preservation of callback-based inference-phase reporting.

The old Soma selection/retrieval helpers were not removed: explicit supported
audit/compatibility diagnostics still expose them. `lib/schedule.php` was not
removed: it is deliberately retained as historical/reference material. Old
satiety/state migrations and checkpoint recovery were not touched: their
supported-state need cannot be dismissed merely because current state is newer.

Only `runner/run.js` is a changed deployment runtime file. Deployment requires
the normal reviewed no-ff workflow and guarded restart; no provider call or
forced world/journal/postcard event is needed for this behavior-preserving change.
