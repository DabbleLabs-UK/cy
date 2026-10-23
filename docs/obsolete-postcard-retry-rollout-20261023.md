# Postcard retry dead-code replication: reviewed rollout

## Authority and independent final review

- Parent: `4b15a37dd7d6298c92473dece08bcaff6ea3d0cb`.
- Pushed cleanup: `cleanup/obsolete-path-replication-20261023` at
  `b66d2996ec08c95fe6a162b66c17f0db1ab85c3b`.
- No-ff production merge: `68056b88fed2360ed959ef6f57b9890be52c84af`.
- Merge tree equals reviewed candidate:
  `666e6bf8356a5b4c72401d766ed0ab1c6aa73194`.
- Fetch confirmed expected parent, clean/remote-matched feature, and no
  intervening production changes. Push/readback confirmed production merge.
- Independent final reviewer `retry_replication_final_review`: `looks-good`;
  no material finding or merge veto. The reviewer verified exact slice removal,
  historical replacement, dynamic/config/route/recovery reachability, retained
  real-API coverage, archive/script/source hashes, command equality and the
  appropriately limited interpretation. No production action preceded review.

See `obsolete-postcard-retry-replication-20261023.md` and the hash-indexed
`evidence/obsolete-postcard-retry-20261023/` for complete measurements/proof.

## Validation

All before/after/unchanged-control phases passed:

- PHP library syntax: nine repetitions per phase.
- Same three focused PHP suites: five repetitions per phase.
- Same 28 PHP suites: three repetitions per phase.
- Same 131-file runner suite: three repetitions per phase, 613/613 each.
- Actual unchanged retry HTTP/DB lifecycle scenario: passed without skips
  before and after, using separately owned disposable MariaDB instances.
  Both instances and fixture PHP servers stopped normally. No existing service,
  production data or provider inference was used.

On the exact merge result: syntax and three focused PHP suites passed again
(22 queue assertions, 34 inference checks, 21 archive checks), followed by
613/613 full-runner tests with zero failures/skips, reported duration 65.640 s.
The merge-result timing again does not support a speedup claim.

The cleanup's tracked Git blobs total 535 files / 12,594,050 bytes, versus
529 / 12,554,503 at the parent. Audit/evidence costs therefore add 39,547 bytes
net, despite removing 825 source bytes net. Separate rollout documentation adds
further archive overhead; no claim of total repository compression is made.

## One-file deployment

Only `/home/dabblela/cy/lib/postcard_queue.php` was installed on VPS3. No runner,
frontend asset, configuration, model, prompt, schema or state file was deployed.
No migration, backfill, provider call, forced event or inference was invoked.

Exact previous file and staged source were backed up privately outside webroot:
`/home/dabblela/cy-backups/obsolete-retry-20261023-68056b8`.
The directory also holds the hash/commit plan, with no credentials.

```text
old deployed raw SHA-256 (CRLF)
30da74048038fec4d2c8375c7c8deaad8dd28a9fb3f995a5a4a48c0181202dbc
old LF-normalized source SHA-256
677d75dde9b5b9c74f2e971f7885f0df5effd132fe66d18df9c4eeff777eea3f
new Git blob and deployed exact SHA-256
baf410d735b0aaf599903ab11df0a2a84842960ba2b724f6c0074cc31898f34e
```

Staged and installed PHP syntax checks passed under server PHP 8.5.12. The
atomic replacement preserved file ownership/mode. Five unchanged dependencies
were hash-gated before staging/install and verified afterwards: ingest, inbox,
postcard inference endpoint, submission endpoint and inference library. The
obsolete declaration is absent from the deployed source.

Installation: `2026-10-23T01:16:42.207143Z` (02:16:42.207143 BST).
Hash/dependency readback: `2026-10-23T01:16:46.356453Z`.

No CY restart was needed: this is an unused PHP helper deletion and no Node
runtime changed. PHP timestamp revalidation defaults remain enabled with a
two-second interval; no FPM/application override was found in inspected settings.
No PHP service restart was performed either.

## Read-only health through 01:17:17.771Z

- Exactly one CY runner, PID 7512, unchanged from before this task; Feddit worker
  PID 8616 also unchanged. No restart marker exists.
- Existing checkpoint generation `1792718060199-7512-6` and synchronized world
  mirror. No checkpoint was loaded, rewritten or restored by this rollout.
- Durable event queue and memory-source spool both zero bytes.
- Public stream advanced from seq 2878486 at 02:12:49.226 BST to seq 2878601
  at 02:17:14.885 BST. Live vitals advanced to 02:17:16.109 BST.
- CY and Feddit public HTTP both 200.
- Normal loopback listeners :11434/:11435 only among checked normal/rehearsal
  ports. Ollama remained 0.34.1 in the baseline check; no inference server changed.
- Shared arbiter healthy, zero expiries, no queued work at final read, unchanged
  3072-context/four-thread execution profile.

Runtime/state behavior is preserved. The evidence supports one fewer misleading
retry implementation to rule out, not a general agent-productivity measurement.
All tempting other cleanup candidates were left alone. This is the end of the
single requested replication.

This record is on isolated `ops/obsolete-postcard-retry-rollout-20261023`;
it is not another production merge or deployed file.
