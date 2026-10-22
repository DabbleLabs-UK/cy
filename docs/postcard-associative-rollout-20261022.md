# Associative postcard recall - final review and rollout

## Authority and review

Approved candidate: feature/postcard-associative-recall-20261022 at
ddb0c5199b5e242771150f6cf28ce73d015153e5.
Production parent: 770f6bdd24dfddd4804d7b3baa88e5c7c395d647.
No-ff merge, pushed to current/production-lineage:
7cdb58d96902134ef35a24f23dffff4478f849d8.
The merge tree exactly equals the reviewed feature (tree
f53b78e5ab9d835f4986be217eed43e4c45fb0ad). The old primary checkout and unrelated
worktrees were preserved; this rollout used a separate integration worktree.

Final focused review: CLEAN. Two independent read-only reviews found no material
server or runner/context/UI defect; no further feature correction was made.
The review covered:

- Unchecked exact-version, per-card opt-in; successful submission clears it.
  Historical and opted-out cards do not gain permission. Sender-only continuity
  remains protected regardless of permission.
- One existing formation inference may independently produce no public summary
  or one <=200-character abstraction plus mechanical attribution. No second call.
  The future opt-in allows minimum meaningful personal gist, not identifiers,
  raw reuse or unnecessary sensitive specifics. Explicit confidentiality wins.
- POSTCARD testimony and CY_REPLY reflection have separate basis/origin; private
  paired content binds both canonical sources. All public recollections remain
  UNCERTAIN, not independently observed world facts.
- Canonical publication/permission are rechecked at completion. Transactional
  completion receipts and exchange-derived memory IDs prevent replay duplicates.
- Optional direct indexed recall: 750-ms bound, at most two whole source-grouped
  recollections, existing broker budget, no unbudgeted fallback; same local and
  DeepSeek context. Protected five-second sender continuity remains separate.
- No vectors, transcript store, background selection inference, journal changes
  or historical backfill.

The corrected sixteen-case evidence was independently rechecked: exactly 16
commercial sends, five accepted, five copy-rejected, six null; fixture/harness
identity and all 14 archived hashes match. No new rehearsal was run. The weak
secondary help/failure -> seedlings match is a related but weaker lexical
association, not a privacy or grounding defect worth tuning. Unrelated controls
were empty. This is bounded evidence, not exhaustive semantic privacy assurance.

## Tests

- 35/35 focused Node tests, no failures/skips/cancellations.
- 581/581 full runner tests, no failures/skips/cancellations; workspace TEMP/TMP.
- 28/28 PHP suites, including 36 public-summary/permission checks.
- 4/4 owned-disposable MariaDB/HTTP integration suites on the identical merge
  tree: formation delivery, formation accounting, associative permission/formation/
  retrieval and postcard retry lifecycle. All fixture processes stopped afterward.
- Six exact staged runner files passed node --check; deployed PHP files passed
  syntax checks. Source/manifest checks and rehearsal hash checks passed.

No test called production inference or created production postcards.

## Migration and protected backups

Migration 032 applied at 2026-10-22T01:52:42Z, before installing the new PHP code.
It adds nullable recall_permission_version VARCHAR(32) and
recall_permitted_at DATETIME(3). No row permission or memory was backfilled.

Private VPS backup:
/home/dabblela/cy-deploy-backup-associative-7cdb58d.
The postcards table was dumped before ALTER using single-transaction/hex-blob
backup, with credentials only in child-process environment, never in an archive,
command argument or report. Backup SHA-256:
e2c9f3f486c60f2d2041fbb148ed41cf26a86de07685e74532f5a7e27369ea60.
The dump remains private outside the web root, not in Git or local evidence.
Migration result and exact original code backups are retained there.

There were 37 postcards (maximum ID 37). All 37 remained unpermissioned at
migration and final verification; both permission columns remain NULL. No real
new postcard arrived during verification. Public correspondence recollections
remain zero, as expected without future opt-in correspondence.

Private DELL code/state backup:
C:\dev\cy\runner\state\deploy-backup-associative-7cdb58d.
The copied sectioned checkpoint was loaded and validated only in the backup,
not by a mutating loader on live state: source=current, generation
1792633298512-7592-39. No old state was restored over natural activity.

## Exact deployment

Full SHA-256 values for all sixteen installed files are in
deployments/postcard-associative-20261022-hashes.json. Every installed target was
rechecked against the canonical merged Git blob; the live HTTPS app.js response
also matches f2d9e0c22b6fb42accf4f29f928f120ad0396e760ec18fc372a26cc738eef25c.

DELL (six): runner/autobiographical-memory.js, runner/client.js,
runner/memory-runtime.js, runner/postcard-associative-memory.js,
runner/postcard-memory.js, runner/run.js.

VPS3 (nine runtime/public files plus migration): lib/autobiographical_memory.php,
lib/postcard_associative_memory.php, lib/postcard_recollection.php,
public/api/inbox.php, public/api/ingest.php, public/api/memory.php,
public/api/post-postcard.php, public/assets/app.js, public/index.php,
sql/032_postcard_public_recollection_permission.sql.

Dependencies/backend were installed before the runner; UI was enabled last.
Original assets were copied before replacement. All changes were staged outside
live assets and placed only after hash verification, not edited in place.

Initial Windows Git export used CRLF while the manifest used canonical blob
bytes. Preflight stopped before installation/migration. A separate staging copy
was normalized only where its full normalized hash exactly matched the Git blob;
original archives/staging were retained. This was packaging, not a feature edit.
SCP stalled and was cancelled before transfer; bounded compressed authenticated
SSH transport verified artifacts instead. Intermittent sandbox SSH timeouts
paused rollout before any migration/file install. The narrow host-side SSH probe
and rollout succeeded; no firewall, security, SSH configuration or service change
was made. No blind DDL retry occurred.

## Guarded restart and health

Existing cy-restart request: deploy:associative-postcard-recall-7cdb58d.
Watchdog acknowledged at 02:54:02.831 BST, stopping exactly old CY PID 7592.
The existing supervisor started exactly one replacement, PID 14160:
2026-10-22T01:54:22.988Z. Request marker cleared; no manual runner launch.
Checkpoint continuity survived; new current generation
1792634093401-14160-1 appeared, with no observed recovery failure/reset, and the
world mirror reported synchronized.

Verified through approximately 2026-10-22T02:00:39Z:

- One CY runner, PID 14160. Feddit worker PID 8616 unchanged.
- Delivery queue and memory-source spool both zero bytes.
- Sender formation mode DEEPSEEK unchanged, zero pending/in-flight/retryable
  sender jobs. Existing history: 38 PROCESSED and four old FAILED records remain
  untouched. The last prior source completed normally on 21 October. The worker
  is initialized in the runner but has no eligible sender work; this rollout did
  not invoke it to manufacture a successful public recollection.
- Public stream advanced 2840487 -> 2840566 during final checks; fresh live UI
  timestamps also advanced. CY/Feddit and app.js returned HTTP 200.
- Only expected inference listeners among inspected ports: 127.0.0.1:11434 and
  127.0.0.1:11435. No 11436/11437/11535 experimental listener. Ollama 0.34.1 PID
  15120 and arbiter PID 15004 unchanged; arbiter healthy, profile 3072/four threads.
- No new task failure, memory reset, clock/Tempo/provider change or forced output.
  All owned diagnostic/test sessions ended; no extra model process was started.

## Live UI and natural-evidence cutoff

The live public page was inspected in the browser. pc-public-recollection was
an unchecked checkbox (AX value 0) with the full approved minimum-gist wording,
including the opt-out sender-memory assurance. Visual inspection confirmed it
below the postcard form. Nothing was typed, checked or submitted; the temporary
browser tab was closed afterward. The HTTPS asset hash matches merged source.

All components, including the prospective-permission UI, were live from:

**22 October 2026 02:55:43.120 BST = 2026-10-22T01:55:43.120Z.**

Use this as the natural behavioural-evidence cutoff. Runner startup itself was
earlier, at 02:54:22.988 BST. Future real opted-in published exchanges may now
produce an omitted/rejected summary or one attributed public recollection.
Important next natural checks: it forms at most once without exposing identifiers
or unnecessary specifics; later related correspondence offers/inserts the bounded
association while protected same-sender continuity remains present. No automatic
backfill or forced observation is authorized by this report.
