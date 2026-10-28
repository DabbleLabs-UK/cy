# Journal memory lead-time rollout: stopped before production

Workstream state: **ABANDON/REASSESS**. No automatic repair, retry or evidence
audit is scheduled. Owner direction is required before any further work.

Candidate: `09b77356130d79f443b53ff74fa42f4557e76407` on
`fix/journal-memory-leadtime-20261028`.

Production remains `8363197d805e672ee59582ce0b1d0d88f14c3e48`.
An isolated local no-ff merge was prepared as
`3fd01dcc3f4462455a6ae762b5b753f84c43f146`; it was not pushed to the production
branch. Its first parent is production, second parent is the candidate, and its
complete tree equals the reviewed candidate (`6c99bc8961c5be4332e4f7c618006c9dc9e56c10`).
The unrelated primary checkout and candidate branch remain untouched.

## Validation and independent source review

- Mixed-queue regressions: 21/21, 4.382 seconds.
- Focused lead-time/liveness/status/formation-runtime tests: 152/152, 22.078 seconds.
- Full serial runner: 1,044/1,044, 207.418 seconds; no skips/cancellations.
- Additional identical-merge-tree lane/wiring/mixed-queue checks: 65/65.
- Eleven PHP scripts: 254 checks passed.
- Five isolated MariaDB/API groups passed, 136.959 seconds. Owned database,
  fixture PHP processes and temporary entries were verified stopped/empty.
- Changed JS/MJS/PHP syntax, JSON metadata and whitespace passed.
- Independent source review found no material feature defect. Actual claimed
  job binding controls the reservation, ordinary cancellation/admission remain
  isolated, and formation fairness, one-attempt accounting and completed-call
  pacing remain intact.

An initial sandbox database initializer could not start; the narrowly escalated
owned fixture run passed. No production database or real provider was used.

## Material package gate failure

Independent review of the exact prepared package found a rollout-operator hazard:
`fpm-check.php` calls `opcache_compile_file($path)` and then `require $path` for
the library in the same FPM request. A local PHP 8.4.23 with OPcache reproduction
against the exact candidate library returned successful compilation and function
availability, then fatally redeclared `captive_memory_is_journal_surfacing`.

The operator could therefore stop after installing the compatible library but
before publishing the API. Production uses PHP 8.5.12; no production experiment
was performed to determine whether its behavior differs. This unresolved gate
is sufficient to stop publication. The operator was not patched or retried.

All 15 package members matched their declared hashes and all nine unique payload
files matched the merged source. The intended seven runtime files and two
metadata files were the complete payload, with API-before-runner ordering.

Package manifest SHA-256:
`1a794804687034f9f0e4680909e7185d0c3cfd10f3446c730cd0ff1231d55d5e`.
Archive SHA-256:
`ce77ccaf4064735d2bb68b75ffab741d54720e70b125b5fe568e1523e536b421`.
This package is **NOT approved for execution**.

The existing deployed registry has 1,266 CRLF line endings. Its exact old hash
`f6bc198e955e1e798d6b4157d8b4da50219ad8eff147f150c5dec04e2afeae31`
and normalized source hash
`ffadc1fe9e1fc394b5069da89f2b4242e873ec28bd4cf7b57358f81cbf2c1629`
were independently retained; this was a formatting-only precondition, not source
drift. No deployed bytes were changed.

## Production remained unchanged

Read-only baseline at 14:21:58.512 UTC on 28 October 2026 found one runner PID6464,
empty source/delivery spools, healthy Ollama 0.34.1 and shared arbiter/listeners,
and CY/Feddit HTTP200. Persistence at 14:22:01.178 UTC reported 165 successful
state writes, zero failed saves, no fallback recovery and current stream/vitals.
Canonical memory counts remained 24 memories, 69 sources, 178 tags and 69 revisions.
These are preflight health observations, not evidence of this candidate running.

After the stop, read-only checks reconfirmed:

- Remote production still points to `8363197`; feature still points to `09b7735`.
- Neither host has a staging directory for this package.
- The new runner module and PHP helper are absent from active production.
- No new FPM probe or restart request exists.
- Existing runtime hashes remain the original deployed hashes:

| Host/path | Unchanged SHA-256 |
| --- | --- |
| DELL runner/client.js | 42aecac90d4d2e2649339c7a02ad9d70e171aa35597c89ad0001bf6fa8c3ae11 |
| DELL runner/memory-runtime.js | b8fd5ff757368e0f34e959550e7569db78d281f3e60c568f4d846aec213ad3f5 |
| DELL runner/run.js | 54c6031f75771cb049dc88fb5ebcc8537576baa9682375619314d0547644ea71 |
| VPS3 lib/autobiographical_memory.php | 05bf3f74f3c49c707ac59d73d8ec2b2bcbbc4f963abf5640a3d250144d8abfe5 |
| VPS3 public/api/memory.php | 42166facfc9c852cd4c3f7fcb5079f466b31cb4e8fdabd8a914c41e1e1671d99 |

No deployment/evidence cutoff exists. No journal, recall, queue claim, memory
formation, provider inference, world event or movement was forced. No natural
post-deployment behavior can be attributed to this unshipped candidate.

## Reassessment

The material finding is in rollout tooling, not the feature's runtime. Source,
deterministic behavior and payload identity remain clean, so the evidence does
not itself justify abandoning the entire lead-time candidate. Nevertheless this
rollout is blocked and will not resume automatically. A separate explicit owner
decision is required: authorize an operator-only correction and fresh review,
or abandon the candidate. No timing, scheduling, retrieval, TTL, fingerprint,
preference or enrichment tuning is justified by this finding.

If a later explicitly authorized rollout succeeds, the agreed terminal state
remains DEPLOYED - PASSIVE NATURAL OBSERVATION ONLY. Rare or absent enrichment
alone does not reopen engineering, and no follow-up audit is scheduled here.
