# Postcard inference

Postcard replies can use the configured DeepSeek Flash route without changing
Cy's active journal, dream, drawing, AWG or memory provider. Both reply providers
receive one canonical persona/context: the verbatim submitted card, sender
recognition, current clock/location/regime, bounded observed events, grounded
Soma, provenanced incident notes, eligible autobiographical memories, static cast
descriptions and one bounded subjective prior-writing source. Sender identity,
PERSON memories, relevant prior exchanges and UNRESOLVED_THREAD records use the
existing autobiographical retrieval/formation system, not a second transcript
lookup or cloud memory store. Public cross-visitor recall uses only the existing
privacy-eligible public summary. Local and cloud consume the same selected set.

Sender continuity is required before reply routing/inference. Identity/counts
come from the existing inbox visitor record. An authenticated canonical memory
read has a 5-second total deadline, independent of background model selection.
It reserves up to two ACTIVE same-sender PERSON memories and two ACTIVE
same-sender unresolved topics, with 600 characters per record. Existing privacy,
subjective-memory labels and provenance remain intact. These bounded records
and recognition cannot be evicted by optional context budgeting. This is not
exhaustive recall or a transcript: no new memory store or consolidation exists.

The 5-second deadline allows headroom over measured DELL-to-API read timings
(424 ms cold; 27-39 ms warm; canonical DB query 1.1-1.9 ms on 5 October 2026).
Timeout/error/malformed response holds the claim before routing, inference or
arrival side effects under the existing postcard retry/expiry policy. It does
not generate a reply pretending the sender is new, nor promise an extra reply.
A successful empty read is explicitly distinguished from unavailable recall.

Broader autobiographical/public cross-visitor enrichment keeps its own 750-ms
best-effort deadline and background model selector. A cache miss cannot normally
finish within that deadline because background work is scheduled after 1 second;
this no longer affects required sender continuity. Both layers are snapshotted
once for local/cloud/fallback, with duplicate memory IDs removed. Content-free
`postcard_memory_readiness` diagnostics record status, latency, counts and held
replies in the existing inference diagnostic log. No prompts or memory text are
included. Formation remains asynchronous: this guarantees retrieval readiness
for selected stored records, not that every exchange has already formed memory.

The postcard-specific instruction allows interest, gratitude, warmth, curiosity
and humour while preserving Cy's present mood, rough voice and unresolved history.
The request has no second character or assistant writer. Cloud postcard requests
use non-thinking mode; normal sampling/length settings and other paths are unchanged.

## Routing and limits

Settings persist in `postcard_inference_settings`; changes have an audit row.
Default cloud ON, AUTO, concurrency 1. OFF and LOCAL always use local replies.
AUTO falls back locally on known unavailability or admission denial. DEEPSEEK
holds the card on failure; operational holds retain retry eligibility rather
than consuming the completed reply-quality failure allowance.
An ambiguous accounting acknowledgement holds the card without another inference.

Default cloud request limits are 20/hour, 100/day and 1000/month. Each initial
call and repair counts. Default GBP limits are 0.10/hour, 1/day and 5/month.
The hour rolls; day/month use UTC boundaries. Admin can edit all these limits.
New paid settings exclude the old public `?111` shortcut: they require the
existing verified owner-network check and same-origin JSON. This retains the
project's trusted-home-network ownership model, not an individual account login.

`config/postcard-inference.json` is the sole postcard pricing source. It retains
the deployed `deepseek-v4-flash` request ID. On 5 October 2026, DeepSeek's official
pricing page says this alias is served by V4.1 Flash. Configured peak USD prices
per million tokens are 0.30 uncached input, 0.006 cached input and 1.20 output.
GBP uses the existing 0.79 conversion assumption. These are conservative
calculated token costs, not a provider invoice; off-peak actual billing can be lower.
Source: https://api-docs.deepseek.com/quick_start/pricing/

Preflight counts UTF-8 bytes of system+prompt plus 256 tokens for the envelope,
uses uncached input pricing and the complete output ceiling. It reserves the
result under a singleton database lock before any paid request. A typical
10,000-byte prompt with 256 output tokens reserves about GBP 0.00263. Pricing
must be kept current by the operator. Unknown usage retains the full reservation.

## Durability and publication

Migration 026 adds a postcard-unique turn and request-unique attempt rows.
Migration 030 adds fenced claim generations to the existing turn/attempt ledger.
Initial/repair identities are unique per postcard/claim generation/provider.
The canonical turn identity remains the postcard ID. Losing a route,
reservation or settlement response cannot authorize a repeat paid call.
Explicitly reported usage replaces the reservation even for failed/rejected
responses. Missing usage never becomes zero spend. An abandoned concurrency
lease expires after 30 minutes (provider timeout is 10 minutes); its uncertain
cost remains and its identity is never reused.

Processing claims, temporary failures and completed quality failures have
separate counters. Legacy `reply_attempts` values are not evidence of quality
failures, and migration 030 neither reopens nor rewrites historical terminal
cards. Only three completed substantive failures reach terminal `fan_final`.
Temporary interruptions and holds release with exponential backoff from 30
seconds to 15 minutes. Expiry of a 30-minute claim releases it under that same
policy, unless an unknown provider outcome or pending publication requires a
protected hold. Old workers cannot reserve, defer or publish against a newer
claim generation. The existing overflow fan-mail promotion cadence is unchanged.

Confirmed no-dispatch requests can settle at zero usage. Local interruptions
and explicit provider rejection responses are retryable; dispatched cloud
timeouts, cancellations and uncertain transport failures are not evidence that
the paid call failed. They retain their reservation and prevent blind replay or
AUTO fallback. A generated result awaiting publication also blocks new provider
execution. Late delivery of the same accepted reply remains transactional and
idempotent. No automatic retry promises another paid call when its outcome is
unknown, and no whole postcard transcript or parallel memory store is added.

The normal shared prose validator and single repair still apply, with both raw
and normalized postcard candidates checked. Accounting must acknowledge the
validated outcome before visible chunks. The existing ingest delivery receipts
remain in force. An additional postcard-level guard accepts only the first reply,
even if another delivery ID is used. Publication status is recorded in the same
transaction as the accepted `postcard_out`. A crash can leave a protected
ambiguous hold; it cannot promise or manufacture another paid reply.

Ledger rows contain identities, token counts, price snapshots, bounded categories,
latency and publication outcome, never raw prompt/reply text, keys or visitor IPs.
The public panel exposes only aggregates and bounded 1H/24H/30D/ALL cost buckets.
Bars show spending when calls occur; unresolved reservations are visibly separate.

## Rollout and recovery

Back up runner runtime/checkpoint and web runtime/affected postcard rows. Apply
030 after the existing 026 ledger and before the PHP/API and runner changes.
Deploy only changed runtime files and
restart through `cy-restart`. Keys remain in `runner/deepseek.key`; absent keys
cannot make a paid call. No model probe or synthetic postcard is needed for rollout.
Disable cloud through the panel for an operational rollback; retain the additive
ledger/history. Reverting code must preserve this ledger and ingest receipts.

Tests: full runner suite, PHP tests, and opt-in disposable-MariaDB real HTTP tests
in `tests/postcard_inference_integration.test.mjs`, alongside the existing claim
response-loss and ingest replay suites. Test credentials belong only to temporary
isolated web roots. No tests call a paid provider.
