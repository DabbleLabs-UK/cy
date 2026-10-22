# Character-facing bodily context: verified rollout

## Source and review

Review: CLEAN for the narrow application-to-character projection boundary.

- Base production: `339b62e2f33bacc78fe02e4ad486064940e11678`.
- Fix branch: `fix/character-soma-context-20261022`.
- Pushed feature commit: `9b07134a2a00c5c044dc9ed72ecb723c9543deb0`.
- Pushed no-ff production merge:
  `ac182f17fad0c1c2941fb4b936c2b53d1f4dea09`.
- Feature and merged trees match:
  `172a991855c8a4a4e8020a17b648878ddc5a69ba`.

The only runtime change is the model-facing formatter in
`runner/grounded-prose-context.js`. Its structured snapshot builder is unchanged,
verified directly against base production. All equations, state thresholds,
transition/calibration gates, persistence, history and public graph code remain
unchanged. A nominal-range check is a character-projection safety gate only,
not a new scientific threshold, scale clamp or change to public values.

The formatter omits KSS/scale numbers, Process S/C indices and intervals,
calibration/phase/residual explanations, gastric volume/distribution/display
normalisation and unavailable-model reasons. It also removes instructions that
enumerated that machinery while asking Cy not to mention it. Already-justified
sleepiness anchors and fullness bands remain possible bodily indications, not
certain feelings; unsupported fatigue/hunger/pain/comfort are not added. No
felt equivalent is invented for raw pressure or phase. Harm/injury descriptions
stay factual and uncertain where appropriate; posterior values and unmodelled
perceived-control explanations remain diagnostics, not character knowledge.

All consumers use the same formatter: local/cloud postcard replies, waking
journals, drawing intent, warden response and expressive choice. Existing memory
context interfaces reuse it without a memory architecture change. Dream/sleep
branches and AWG do not consume the waking block. No source, schema or retention
change was made to the scientific/UI snapshot. Independent technical testimony
is not filtered; historical text is not rewritten. This does not guarantee that
a model will never invent a scientific explanation.

See `character-soma-context.md` for exact source tracing and deterministic
before/after examples. Cast metaphors, continuity-gap inventions, journal
architecture, associative memory, model/provider/options and Tempo remain out of
scope; the earlier power and character-core corrections are preserved.

## Offline verification

On both feature and identical merged tree:

- 61/61 focused checks, including thirteen new character-soma tests and existing
  sleep/circadian/TPM, satiety, feeding, somatic, social, defensive, restart,
  character-core/power and journal-source tests.
- 613/613 full runner results, no failures, skips or cancellations.
- Existing tests expecting scientific prose now assert the experiential
  projection; all equation, parameter, public UI and continuity checks remain.
- Numeric snapshots, model histories, state and sampling were checked unchanged
  by projection. The complete structured builder prefix matches the base.
- JSON parsing, diff whitespace and DELL staged syntax checks passed.

Tests used deterministic fixtures and local mock servers, not model calls.
No real or synthetic production inference, postcard or event was requested.

## Deployment and backup

Only deployed file: `C:\dev\cy\runner\grounded-prose-context.js`.

SHA-256 of exact merged/deployed bytes:
`653e39874a2bc20430bba1a3877a7836a4aa76f50421794f04169cd498646c09`.

Old live raw SHA-256:
`ec66e5848b975e3800d431b311d07ce7711a30b5fcf2844e7628218f9b335797`.

Old LF-normalized/source SHA-256:
`1676456a1d9938385b1099e8981da428a0863ffa97f4350208d24586d5138f4c`.

The installer gates on the old normalized hash and thirteen unchanged runtime
dependencies, stages Git-blob bytes, validates syntax and the copied checkpoint,
then atomically replaces just the formatter. The same dependency/hash gates
passed again after restart at `2026-10-22T22:15:09.690547Z`. No VPS files, public
assets, configuration, database schema or canonical history were deployed.

Private verified backup:
`C:\dev\cy\runner\state\deploy-backup-character-soma-ac182f1`.

It retains original/staged code, a hash/dependency plan, pre/post checkpoint
copies, copied power state and validation receipts. The sectioned-store loader
was used only on private copies, never the live store. No state was restored.

One SSH timeout occurred during backup preparation. No runtime installation or
restart proceeded on an unverified backup. A bounded IPv4 connection succeeded;
the copied checkpoint validated fully before installation. No network/firewall
settings changed and no cause for the transient timeout is asserted.

| Check | Before restart | After restart |
| --- | --- | --- |
| Current checkpoint | `1792706918399-10528-3` | `1792707203004-5352-0` |
| Source/location | current / CELL | current / CELL |
| Scientific model/schema versions | seven existing subsystems | exact match |

The post-copy validator additionally constructed the current bodily directive
offline and checked that engineering terminology was absent. This was a pure
formatter call, not inference.

## Guarded restart and health

Existing helper reason: `deploy:character-soma-context-ac182f1`.

- Watchdog acted at 22 October 2026 23:13:02.766 BST, stopped only old CY PID
  10528, cleared the request and left restart to the existing supervisor.
- Exactly one replacement CY: PID 5352, created at
  `2026-10-22T22:13:17.227Z` (23:13:17.227 BST).
- New checkpoint validates as current, with no fallback recovery. Startup reports
  `satiety restart recovery: LIVE; reason=REPLAYED; records=0`, providers ready
  and `world mirror synchronized`.
- Delivery queue and memory-source spool: zero bytes at 22:13:26Z. Sender
  pending/processing/retryable formation query remained empty. No backlog drain
  or memory manipulation occurred.
- Stream advanced 2873729 -> 2873812. Latest public event: 23:14:23.320 BST;
  singleton live vitals: 23:14:22.837 BST.
- CY and Feddit both returned HTTP 200 after restart at approximately 22:13:26Z.
- Feddit worker PID 8616 and arbiter PID 15004 remained unchanged. Expected
  listeners only: loopback 11434/11435, no experimental listener. Ollama 0.34.1.
- Arbiter healthy with 3072 context/four threads and zero expiries. A normal
  Feddit lease and queued CY request were observed; no experimental call was
  made and ordinary scheduling was not forced.

Conservative natural-evidence cutoff:
**22 October 2026 23:15:10 BST = 2026-10-22T22:15:10Z**.

Production remains the tested merge. This evidence is separately committed on
`ops/character-soma-rollout-20261022`; primary and unrelated worktrees remain
untouched.
