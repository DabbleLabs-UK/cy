# Obsolete stream generator cleanup: reviewed rollout

## Source and independent review

- Parent production: `ac182f17fad0c1c2941fb4b936c2b53d1f4dea09`.
- Cleanup: `cleanup/obsolete-stream-generator-20261023` at
  `ed22d092c516e6fa09cca16606d7aaa4e17d0e18`, committed and pushed before review.
- No-ff production merge: `4b15a37dd7d6298c92473dece08bcaff6ea3d0cb`.
- Merge tree equals the reviewed feature tree:
  `6949493d943ef66222652d797b71f54683fa0797`.
- Production remote was unchanged at the expected parent before merge; push
  and remote readback confirmed the new merge without force.
- Independent final reviewer: `obsolete_stream_final_review`, read-only,
  verdict `looks-good`, no material findings or merge vetoes.

The reviewer independently reconciled the exact deleted slice, historical
replacement, lack of dynamic/startup/fallback access, unchanged live callbacks,
measurement commands/hashes/counts, warm-control tree and archive totals.
The proof and before/after records are in `obsolete-stream-cleanup-20261023.md`
and `evidence/obsolete-stream-20261023/`.

## Merge-result validation

- `node --check runner/run.js`: passed.
- Same ordered ten-file focused command as the measurement archive:
  46/46 TAP tests, zero failures; 4.237 seconds reported by Node.
- Same ordered 131-file full-runner command, concurrency 2:
  613/613 TAP tests, zero failures; 57.869 seconds reported by Node.
- Workspace-owned TEMP/TMP and disposable mock servers only. No live provider
  request, paid probe, synthetic postcard, journal or world event was invoked.
- `git diff --check`: clean. Integration worktree clean before documentation.

The slower merge-result full run reinforces that these wall-clock observations
are noisy, not a demonstrated performance win. The measured benefit is removal
of a complete misleading alternative implementation, not faster inference.

## Minimal deployment and verified recovery

Only `C:\dev\cy\runner\run.js` was installed on DELL. No VPS file, public asset,
configuration, prompt, provider, model, state schema or setting was deployed.

SHA-256, Git blob and deployed bytes:

```text
before 3682887668401a706d48cc581f7a94924059dbb0e6af91dea7fd28cc24fc65b2
after  6a5704ab37c5fc43b8f9cdfb779121b55f47924f633843f7ef64572ea47dd32b
```

Ten unchanged runtime dependencies were hash-gated before staging/install and
again after restart: prompt, grounded-prose-context, power, provider,
character-output, warden, inference-coordinator, shared-ollama-lease, vitals
and soma. The obsolete symbol is absent from the deployed file.

Private backup on DELL:
`C:\dev\cy\runner\state\deploy-backup-obsolete-stream-20261023`.
It retains the exact previous runner, deployment plan, staged runner and copied
checkpoint/power state. No private checkpoint content is committed to Git.

The completed pre-deployment checkpoint copy validated through the unchanged
production loader with `source=current`, generation
`1792715257174-5352-19`, location CELL and all seven promoted Soma model
identities retained. An initial validation while the copy was still incomplete
failed; installation remained blocked until the completed copy passed.

Atomic installation completed at `2026-10-23T00:32:19.572750Z`. The existing
guarded helper requested restart with reason `deploy:obsolete-stream-4b15a37`.
Watchdog acknowledged it at 01:33:02 BST, stopped only CY PID 5352, and the
existing supervisor started replacement PID 7512 at
`2026-10-23T00:33:17.133Z` (01:33:17.133 BST).

An optional full-directory post-restart copy raced the normal content-addressed
checkpoint garbage collector. It was retained but is not claimed as verified
recovery evidence. Instead a separate `post-state-verified` snapshot captured
the manifest and every hash-bound referenced section before writing the private
copy. Its 868 sections validated through the production loader with
`source=current`, generation `1792715627777-7512-1`, CELL and exact equality
of all seven pre/post Soma model identities. The snapshot never loaded or wrote
the live state store. This diagnostic copying adjustment changed no runtime code.

## Live health

Read-only checks through `2026-10-23T00:35:35.945Z` confirmed:

- Exactly one CY runner, stable PID 7512; restart marker acknowledged/absent.
- Satiety restart recovery LIVE/REPLAYED, zero replay records.
- Providers ready and world mirror synchronized.
- New checkpoint committed by PID 7512; pre/post copied checkpoints valid.
- Durable event queue and memory-source spool both zero bytes.
- Public stream advanced from sequence 2877383 at 01:30:31.875 BST to
  2877463 at 01:33:43.774 BST; live vitals advanced to 01:33:42.658 BST.
- CY and Feddit public HTTP both 200.
- Only normal inference listeners 127.0.0.1:11434 and :11435 among checked
  normal/rehearsal ports; Ollama remains 0.34.1.
- Arbiter healthy, zero expiries, unchanged 3072-context/4-thread profile.
- Feddit worker PID 8616 unchanged and naturally acquiring/releasing leases.

No generation was forced, clock altered, queue drained manually, history
rewritten or setting changed. Ordinary natural processing continued.

This documentation is committed separately on
`ops/obsolete-stream-rollout-20261023`; it is not an additional runtime change
or production merge. Supported compatibility helpers, intentional historical
reference files and migrations were deliberately left intact.
