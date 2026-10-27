# Bounded yard greeting rollout

Reviewed candidate: `881c40db2fa6077646a6962be0c0b2ce984e040c`.
No-ff production merge: `8363197d805e672ee59582ce0b1d0d88f14c3e48`.
First parent: `0eeb5b6c654e54c807b9b29f0136a1e420fac450`.
The merged tree is `f92e5acbf40b539e9221a249b4830a7a41494e37`, identical to
the approved candidate. The unrelated original checkout was preserved; the
merge used an isolated integration worktree and was pushed to
`current/production-lineage` without force.

## Final review and validation

Independent source review found no material issue. The lifecycle remains
AVAILABLE -> OFFERED -> COMMITTED -> RESOLVED. Only existing qualifying inmate
conversation observations become greetings. Original outcome/cast draws,
cadence, quiet/company/officer/other-person avoidance behavior are preserved.
Cy chooses only respond/decline using the active character path, with at most
one call and no repair/replacement inference. Technical failures and unfinished
restart work are NO_DECISION / NOT_EXECUTED, never refusal.

Canonical point records establish no continuous NPC presence, waiting interval,
dialogue, topic or relationship consequence. Movement remains independent and
CELL-only journal/drawing gates are unchanged. Greeting, committed decision and
immutable outcome retain the reviewed checkpoint-before-consumer ordering;
stable delivery/projection receipts support replay without another decision.

The Social comparator change applies only when timestamps tie and a resolved
yard outcome must outrank its opening. It does not change non-yard tie order,
contact interpretation, relationship scores or current-presence semantics.

| Rerun | Result |
| --- | --- |
| State machine | 37/37, included in focused/full below |
| Actual runtime/checkpoint integration | 19/19, included below |
| Focused suite | 338/338, 220.675 seconds |
| Full serial runner | 979/979, 440.344 seconds; no skips/cancellations |
| Eight relevant PHP scripts | 8/8 |
| Isolated database/API groups | 4/4, 274.738 seconds; owned DB stopped |
| Changed JS/MJS syntax | 17/17 |
| Tracked JSON parsing | 100/100 |
| Whitespace | clean |
| Additional yard checks on identical merge tree | 56/56, 52.879 seconds |
| Additional full serial merged-worktree confirmation | 979/979, 169.299 seconds; no skips/cancellations |

All tests used deterministic offline fixtures and fake providers. The full
runner and API groups used narrow escalation for isolated loopback transports,
not production calls. The disposable MariaDB process had a unique owned data
directory and verified PID/data identity, and was stopped after the four groups.
There was no real model rehearsal or production activity forced by testing.

## Exact package and changed files

Package: `deploy-yard-turn-8363197`.
Manifest SHA-256:
`9154e11d01702dce0b59247753e68d499f605056a0cf53585fd745533d9ad917`.
Archive SHA-256:
`bf787e132c9b1d749f3d6569cf115e6d14d8844b3550f4319b9c9896c5a655a8`.

Independent package review verified all six payloads against Git, all eleven
archive members, 34 dependency/baseline hashes and the deployment allowlists.
Both hosts independently verified all staged member hashes. Runtime dependency
installation precedes run.js. No API, SQL, provider configuration, shared prompt
file, model setting, unrelated scheduler policy or other feature file was deployed.

| Host | Active path | Deployed SHA-256 |
| --- | --- | --- |
| DELL | runner/yard-contact-choice.js | 5abdf2050f316e27ce505b49a2c79282cc13f2647b9335b5d138f0a26a347c15 |
| DELL | runner/client.js | 42aecac90d4d2e2649339c7a02ad9d70e171aa35597c89ad0001bf6fa8c3ae11 |
| DELL | runner/grounded-prose-context.js | 1aed10676cd49b55d405a9965371817a98d9aa0bff3fb2976dfe581fd4ca302b |
| DELL | runner/social-contact-substrate.js | c520bf1a049e0896eacf69ed07c579496973e94cf7e346b13bc987a6eb957d7e |
| DELL | runner/run.js | 54c6031f75771cb049dc88fb5ebcc8537576baa9682375619314d0547644ea71 |
| DELL and VPS3 | docs/data-handling.json | 7719d270086ed0b62b999d5a281886e1137d87d32c7248fb14599eeb99c620bf |

The old deployed Social file had 275 CRLF endings: actual SHA-256
`f9704442eb10ec5f1ff03370e6be7d57f91c154be2f3bf4fdf5ae726d0d07df2`;
LF-normalized SHA-256 `fdf541c22f7afdbb5ef42a9aafdf1caa99a88f1aaac8aaf84662d05f65f854bb`
matches the production Git blob exactly. This was established read-only before
installation. Both the exact old-byte precondition and source-equivalence hash
were retained; the old bytes were backed up, not silently reinterpreted.

The verified 930-file private DELL backup includes both complete checkpoint
graphs, supporting state/spools and replaced runtime files, under
`C:/dev/cy/runner/state/deploy-backup-yard-turn-8363197`. Server metadata backup
is `/home/dabblela/cy-deploy-backups/yard-turn-8363197`. No backup/state was
restored and no historical journal/world/memory record was rewritten.
Server metadata installation completed at 22:24:24Z; DELL exact-byte readback
completed at 22:24:25.710Z on 27 October 2026.

## Guarded restart and initial health

One unchanged guarded `cy-restart` request was issued. The watchdog acted at
22:25:02.164Z, stopped only old runner PID17088 at 22:25:02.186Z and acknowledged
the request at 22:25:02.214Z. The existing supervisor launched replacement
PID6464 at 22:25:17.225Z. No second restart was requested.

Full-graph postflight at 22:25:45.110Z validated startup generations created at
22:25:23.768Z and 22:25:26.087Z. The new checkpointed yard lane was correctly
initialized with zero encounters. Satiety startup recovery replayed zero intake
records. Mirror comparison found 12 objects, nine threads and zero adoption or
publication needed. All sixteen meal episode phases and their complete hash
matched preflight. Queue/source spools were empty.

Health at 22:25:48.812Z verified exactly one runner PID6464, cleared restart
marker, unchanged worker/arbiter PID13868, expected 11434/11435 listeners and no
11535 listener, Ollama 0.34.1, both providers ready and CY/Feddit HTTP 200.
The arbiter retained its 3072-context/four-thread profile and three historical
Cy lease expiries. Ordinary Feddit work held the lease with a Cy request queued;
this is normal resource serialization, not overlapping local inference.

The SELECT-only observation at 22:25:50.972Z showed successful persistence,
zero failed saves, no fallback recovery and a stream head of 3067369 versus
preflight 3067166. Canonical memory/source/tag/revision counts and hashes
remained unchanged at 24/69/178/69. Existing queue retirement/service continued
normally; no queue was manually claimed, purged or altered.

The first complete healthy graph/hash/health/database observation defines the
natural-evidence cutoff:

**27 October 2026 22:25:50.972 GMT/UTC**
(`2026-10-27T22:25:50.972Z`).

Independent deployed-state review used fresh read-only SSH hash checks and
confirmed all six DELL files plus VPS3 metadata against the merge, with no
material finding in deployment or initial recovery/health. A separate review
of this evidence document found no factual discrepancy in the initial receipts.

## Ordinary checkpoint advancement and final verification

The existing write-behind policy coalesced ordinary ticks until its normal
ten-minute maximum; no save was forced. Generation `1793140530976-6464-2` was
created at 22:35:30.976Z and saved successfully at 22:35:32.683Z. Full checkpoint
graph/hash observation at 22:35:54.923Z validated this generation and its prior
startup generation, exact deployed file hashes and mirror convergence 0/0.
The yard ledger remained empty and all meal phases/hash were unchanged.

The SELECT-only observation at 22:35:57.159Z reported stateWriteCount 3,
failedSaveCount 0, lastError null and no fallback recovery. Stream head advanced
to 3067636, with current vitals at 22:35:51.691Z. All four canonical memory table
counts/hashes remained unchanged. Ordinary queue service continued, not manual
queue manipulation or a newly introduced memory action.

Final health at 22:35:59.909Z retained exactly one runner PID6464, unchanged
worker/arbiter PID13868, both expected listeners, cleared restart marker,
empty source/delivery spools and CY/Feddit HTTP 200. Arbiter Cy lease expiries
remained three. Server metadata and unchanged API dependency hashes verified
again at 22:36:01Z. No unexpected recovery/replay, duplicate yard projection or
unrelated durable-world mutation was identified.

## Natural evidence limit

The private yard lane was empty after restart. Read-only SQL at
22:26:30.451Z found zero canonical yard-greeting opening/resolution records and
zero post-cutoff public yard rows. No greeting, decision, movement, journal,
provider call or synthetic event was forced. A naturally occurring unrelated
expressive-choice request was interrupted by wing noise, followed by ordinary
journal work; this is not evidence of yard agency.

A final SELECT-only check at 22:36:01.208Z again found zero canonical greeting
openings/resolutions and zero public yard rows after cutoff. No opportunity
existed to inspect a natural Cy yard decision or judge response preferences.

Natural respond/decline behavior and the complete causal yard path remain
unproven. Deployment correctness is not a behavioral demonstration. The next
useful evidence is a genuinely qualifying observation during an actual future
yard visit; neither response proportions nor frequency were tuned.
