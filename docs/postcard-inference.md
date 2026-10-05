# Postcard inference

Postcard replies can use the configured DeepSeek Flash route without changing
Cy's active journal, dream, drawing, AWG or memory provider. Both reply providers
receive one canonical persona/context: the verbatim submitted card, sender
recognition, current clock/location/regime, bounded observed events, grounded
Soma, provenanced incident notes, eligible autobiographical memories, static cast
descriptions and one bounded subjective prior-writing source. Up to two earlier
replied-to cards from this exact sender are included. Legacy outgoing replies
without an indexed event association are omitted, not guessed.

The postcard-specific instruction allows interest, gratitude, warmth, curiosity
and humour while preserving Cy's present mood, rough voice and unresolved history.
The request has no second character or assistant writer. Cloud postcard requests
use non-thinking mode; normal sampling/length settings and other paths are unchanged.

## Routing and limits

Settings persist in `postcard_inference_settings`; changes have an audit row.
Default cloud ON, AUTO, concurrency 1. OFF and LOCAL always use local replies.
AUTO falls back locally on known unavailability or admission denial. DEEPSEEK
holds the card on failure; existing retry/expiry rules account for it in fan mail.
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
Initial/repair identities are unique per postcard/provider. Losing a route,
reservation or settlement response cannot authorize a repeat paid call.
Explicitly reported usage replaces the reservation even for failed/rejected
responses. Missing usage never becomes zero spend. An abandoned concurrency
lease expires after 30 minutes (provider timeout is 10 minutes); its uncertain
cost remains and its identity is never reused.

The normal shared prose validator and single repair still apply, with both raw
and normalized postcard candidates checked. Accounting must acknowledge the
validated outcome before visible chunks. The existing ingest delivery receipts
remain in force. An additional postcard-level guard accepts only the first reply,
even if another delivery ID is used. Publication status is recorded in the same
transaction as the accepted `postcard_out`. A crash can leave the card as retained
fan mail; it cannot promise or manufacture another paid reply.

Ledger rows contain identities, token counts, price snapshots, bounded categories,
latency and publication outcome, never raw prompt/reply text, keys or visitor IPs.
The public panel exposes only aggregates and bounded 1H/24H/30D/ALL cost buckets.
Bars show spending when calls occur; unresolved reservations are visibly separate.

## Rollout and recovery

Back up runner runtime/checkpoint and web runtime/affected postcard rows. Apply
026 before the PHP/API and runner changes. Deploy only changed runtime files and
restart through `cy-restart`. Keys remain in `runner/deepseek.key`; absent keys
cannot make a paid call. No model probe or synthetic postcard is needed for rollout.
Disable cloud through the panel for an operational rollback; retain the additive
ledger/history. Reverting code must preserve this ledger and ingest receipts.

Tests: full runner suite, PHP tests, and opt-in disposable-MariaDB real HTTP tests
in `tests/postcard_inference_integration.test.mjs`, alongside the existing claim
response-loss and ingest replay suites. Test credentials belong only to temporary
isolated web roots. No tests call a paid provider.
