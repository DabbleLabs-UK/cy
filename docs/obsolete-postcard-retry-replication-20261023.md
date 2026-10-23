# Dead-code navigation-burden replication: postcard retry accounting

## One candidate, outside generation

Base production: `4b15a37dd7d6298c92473dece08bcaff6ea3d0cb`.

Remove only `captive_postcard_failed_attempt` from `lib/postcard_queue.php`:
13 physical lines / 514 LF-normalized UTF-8 bytes, including its return-shape
comment and following blank line. No constant, live helper, call site, route,
configuration or migration is removed. The three assertions exercising only
that orphan calculator are replaced by one assertion requiring the live fenced
helper and absence of the obsolete alternative. Their actual lifecycle behavior
remains covered by the unchanged real-API integration test.

This is an actual but small disambiguation problem, not a large source reduction.
Searching for failed postcard attempts, terminal fan mail or the retry allowance
finds two calculations beside each other. The older helper accepts a single
completed-attempt count and calculates retry/terminal disposition; three tests
even describe it as the quality-failure implementation. The live helper instead
locks the queue/card, fences the claim generation, separates temporary and
quality failures, protects pending/ambiguous provider results and applies the
transition. The old unit assertions can therefore look authoritative while
testing neither the actual transition nor its guards.

## Reachability and historical proof

Classification: SUPERSEDED and unreachable from supported production paths;
not unreachable from its obsolete test-only calls before this change.

- `0dd6a1a` introduced the single-counter calculator. Commit
  `7484cecf6505931e5b2f32c2ad523de586b5b2b9` removed its sole runtime call
  and associated retry SQL from `public/api/ingest.php`. The whole deferred-card
  handler now calls `captive_postcard_defer` directly. That commit introduced
  the current claim-fenced, classified failure transition but left the old
  function/tests behind.
- Base tracked symbol search finds only its declaration and the three unit
  calls. No alias, registration, callback, import/config string or fragment-built
  caller exists. Runtime searches explicitly exclude tests/docs as competing
  implementations; evidence mentions are not claimed to vanish repository-wide.
- All queue-library consumers were inspected: inbox, ingest, postcard inference
  and submission. Deferred events use the fixed ingest branch; stale expiry
  calls the same live helper with `temporary`; late-settlement recovery uses
  its live blocker. The inference endpoint has fixed action dispatch, not
  request-selected function invocation. An older runner's event still enters
  the current fixed server branch; it cannot select the old PHP function.
- PHP variable calls, callback APIs, reflection/evaluation and function-name
  probes were searched across lib/public/scripts/config. The variable calls
  found are locally assigned closures, not an arbitrary helper dispatcher.
  No supported CLI, scheduler, migration, startup, recovery or feature flag
  reaches the old calculator. Configuration contains no such binding.
- `public/` is the webroot. Merely declaring a global function in `lib/` does
  not expose it as an HTTP action. Arbitrary new PHP/debugger injection is not
  a supported reachability path. Source rollback remains available in Git;
  this helper is not marked as intentional recovery/reference material.
- Deployed VPS queue source matched base SHA-256
  `677d75dde9b5b9c74f2e971f7885f0df5effd132fe66d18df9c4eeff777eea3f`.
  The deployed ingest/inbox/inference/submission consumers match the base and
  contain no reference to the old helper. The result is not based solely on an
  unrelated local checkout.
- After deletion, `lib/postcard_queue.php` is exactly the original file with
  that one slice removed; every other byte is unchanged after LF normalization.
  New SHA-256:
  `baf410d735b0aaf599903ab11df0a2a84842960ba2b724f6c0074cc31898f34e`.

Preserve shared constants and all other helpers, including old-arrival history
checks and null-generation compatibility. No postcard row, historical attempt,
publication, provider reservation or memory source is changed by this cleanup.

## Frozen measurements

Exact tooling, complete argument arrays, raw samples and source hashes are
archived in `evidence/obsolete-postcard-retry-20261023/`. The uncompressed JSON
originals also remain in the external measurement workspace. Gzip is archival
compression only; each original and compressed hash is recorded. No evidence
is deleted. Source measurements use LF-normalized UTF-8 and include comments
and blank lines, not executable-statement counts.

The inspection set is explicitly fixed at seven paths: queue library, ingest,
inbox, inference endpoint/library, queue unit tests and retry lifecycle API
integration tests. It is an inspection/context proxy, not a claim an agent
necessarily reads every byte. Token proxy = `ceil(UTF-8 bytes / 4)`, not a
tokenizer result or measured hidden Codex context.

| Observable | Before | After |
| --- | ---: | ---: |
| Plausible retry-accounting implementations | 2 | 1 |
| Obsolete alternatives requiring exclusion | 1 | 0 |
| Definition-search hits / files | 2 / 1 | 1 / 1 |
| Runtime retry-name hits / files | 4 / 2 | 3 / 2 |
| Old helper runtime hits / files | 1 / 1 | 0 / 0 |
| Terminal/allowance search hits / files | 7 / 1 | 5 / 1 |
| Retry-implementation slice lines | 32 | 19 |
| Retry-implementation slice bytes | 1,950 | 1,436 |
| Retry-implementation token proxy | 488 | 359 |
| Fixed inspection files | 7 | 7 |
| Fixed inspection lines | 1,734 | 1,716 |
| Fixed inspection bytes | 100,652 | 99,827 |
| Fixed inspection token proxy | 25,163 | 24,957 |
| Tracked source files | 379 | 379 |
| Tracked source physical lines | 93,874 | 93,856 |
| Tracked source bytes | 4,514,402 | 4,513,577 |
| PHP library files | 25 | 25 |
| PHP library lines / bytes | 6,172 / 298,540 | 6,159 / 298,026 |
| Imports/configuration branches/call sites removed | 0 / 0 / 0 | 0 / 0 / 0 |
| PHP suites collected | 28 | 28 |
| Queue unit assertions | 24 | 22 |
| Runner test files / TAP tests | 131 / 613 | 131 / 613 |

The net source reduction includes five fewer test lines / 311 fewer test bytes.
The source file count and required inspection-file count do not fall. Fixed
inspection bytes fall 0.82%; total source bytes fall only about 0.018%. The
narrow two-implementation slice falls 26.4% in bytes. Three dead-helper unit
assertions are not presented as lost live-behavior coverage: the actual guarded
API test is retained and executed before/after against owned disposable data.
Audit archives add repository bytes and files; this is not repository compression.

## Test and timing method

Windows; Node 22.14.0; PHP CLI 8.4.23. Syntax repeats 9 times, the same three
focused PHP suites 5 times, all 28 PHP suites 3 times and all 131 runner test
files 3 times with concurrency 2, in every phase. Commands and ordering are
identical. The warm control uses an unchanged clean checkout at the exact same
production base/tree, not an approximation. TEMP/TMP use the same owned workspace
directory. No build/linter is configured; PHP syntax and test collection are
reported instead. No provider/model request is made by these tests.

| Median wall time | Before | After | Unchanged warm control |
| --- | ---: | ---: | ---: |
| PHP syntax, 9 runs | 365.7 ms | 268.3 ms | 301.2 ms |
| Three focused PHP suites, 5 runs | 1.095 s | 0.812 s | 0.889 s |
| All 28 PHP suites, 3 runs | 10.286 s | 9.026 s | 9.686 s |
| Full runner, 3 runs | 63.718 s | 56.763 s | 55.700 s |

Every command passed in all phases. All nine full-runner repetitions passed
613/613 with zero failures. The unchanged warm control was faster than the
cleanup in the full-runner median. Its PHP-suite range (8.457-11.142 s) covers
both before and after medians. Its syntax range (248.5-433.2 ms) also covers
both medians. Startup/cache/background load was not isolated or randomized;
there is no meaningful demonstrated build/test or production speedup.

The unchanged actual HTTP/DB lifecycle integration also ran without skips both
before and after against two separately initialized, PID/directory-verified,
loopback-only MariaDB instances. Both passed (one broad scenario each, 33.812 s
and 33.409 s including Node overhead). It exercises interruption retries,
quality terminalization, claim expiry, stale fencing, paid-outcome ambiguity,
publication idempotency, late settlement and retained historical counters.
Only owned synthetic fixture services ran; both database processes were stopped.

The three compressed raw measurement records occupy 18,492 bytes; compression
round-trips and both compressed/uncompressed hashes are verified. Tooling and
proof documentation add further repository bytes, intentionally outweighing the
825-byte net source reduction. This audit cost is separate from runtime-source
navigation; no claim of total repository shrinkage is made.

## Interpretation and deliberately retained alternatives

This replicates a localized disambiguation mechanism in PHP retry accounting,
separate from the first experiment's JS prose publisher. It does not measure
actual agent task time, errors or hidden context consumption. One misleading
alternative and its misleading test authority disappear, but the context-volume
effect is far smaller than the first case. Two selected cases do not establish
a general magnitude or causal agent-productivity result.

The frontend bounded-history loader is a live fallback, so it remains. Legacy
Soma diagnostics are intentionally supported. `lib/schedule.php` is explicitly
retained reference/history. Migrations and null-claim compatibility remain.
An unreferenced visitor-description helper and old Soma history-query builder
were not pursued: weaker ambiguity/replacement proof, and this task allows
only one candidate. Generator code is untouched.
