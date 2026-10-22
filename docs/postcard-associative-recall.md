# Bounded postcard associative recall

Unreleased feature based on production 770f6bd. No journal integration, provider
change, embedding service, vector store or extra inference call.

## One canonical memory system

The required 5-second sender read is unchanged: sender identity, two PERSON and
two unresolved-topic slots remain protected. Postcard optional enrichment now
uses a separate 750-ms cancellable indexed read instead of waiting for a
background model-selected prepared set. An unavailable, late or empty optional
read does not hold the reply or alter required sender continuity. It never
overwrites the runtime's journal/background working set.

The authenticated `postcard_associations` action in the existing memory API
reads the existing MariaDB full-text index and canonical source/tag tables.
There is no raw postcard/archive lookup or second conversation store.

## Eligibility and privacy

The existing ACTIVE + PUBLIC_RECALLABLE + nonempty public_summary combination is
the explicit public-safe recollection representation. Only that summary is
returned, even when the original content contains additional private details.
Anonymisation, public archive appearance, a nonempty summary on a sender-only
record, or being a returning visitor does not grant eligibility. The retriever
itself creates or promotes no memories; automatic formation requires the
separate explicit prospective permission below.
Existing sender formation still produces SENDER_RECALLABLE records. The optional
future-sender permission below can separately produce one public-safe recollection;
it never changes the scope of the sender memory.

Eligible Cy-owned INTERNAL_ONLY autobiography has no subject visitor, no
correspondence provenance and no sender-only source. Supported origin kinds
distinguish observed experience, dreams, past thoughts and curated recollections.
Private correspondence cannot masquerade as Cy-owned material by losing its
sender key. Current-sender records and protected memory IDs are excluded from
the optional lane. Unknown, archived, unlinked and partially linked records fail
closed. Anonymous replies may still use explicitly public-safe summaries.
Canonical event type and exchange identity also exclude legacy unlinked
environment copies of correspondence; ambiguous correspondence origin is not
relabelled as prison experience.

Public-summary permission does not change the source's original visibility;
the private original and its source remain private. No approval is inferred
from deletion of a name. The initial audit found zero eligible correspondence
memories. Formation now has the explicit prospective permission described below;
historical records are not automatically authorized or processed again.

## Future-sender compact recollection opt-in (unreleased)

The unchecked per-postcard checkbox says:

> Allow Cy to remember a short, public-safe summary of this postcard and his reply,
> if published, and recall it in replies to other people. This does not allow raw
> message reuse or identifying/private details. Optional; leaving this off does
> not affect his memory of you in your own correspondence.

Submission accepts only the explicit `compact-public-recall-v1` value, saving
`recall_permission_version` and server `recall_permitted_at` on this postcard.
Missing permission is opt-out. The checkbox resets only after successful
submission and is not a persistent sender preference. Migration 032 only adds
nullable columns; it grants no historical permission and does no backfill.

For opt-in replies, the existing public reply transaction queues the canonical
`CY_REPLY / postcard-reply:N` formation source. This replaces the early local
enqueue for that opted-in reply only, avoiding publication/formation races and
making a lost acknowledgement harmless. Incoming POSTCARD formation and opt-out
reply formation remain sender-only. Claims obtain optional published-exchange
context directly from the authoritative postcard, screened arrival and reply
records; stored/runner-supplied eligibility cannot authorize a summary.

The SAME existing configured formation call retains its sender decision and adds
an independent nullable `publicRecollection: {basis, summary}` slot. `NOTHING`
and null are normal for greetings, repetition, sensitive material or no lasting
value. The model abstracts one side only: `basis=POSTCARD` or `CY_REPLY`; it cannot
choose WORLD. No second call, new source job or transcript store exists.
Existing model/options, including the 260-token formation output allowance,
are unchanged. This is not the journal's separate 93-token limit.

The bounded real-model rehearsal exposed a conflict in the original wording
(current reply only versus a postcard-basis public slot). The opt-in prompt now
explicitly admits the published pair, without making the public slot compulsory
or allowing private candidate memories to supply public text. Because one model
context cannot honestly isolate two free-prose evidence decisions, private
CREATE/UPDATE content that receives this pair is marked CORRESPONDENCE_EXCHANGE
and binds both canonical POSTCARD and CY_REPLY sources, still sender-only. A
claim-specific server pairing receipt, not a client flag, controls this binding.
RESOLVE adds the source while preserving the archived content's earlier origin.
The existing Cy-authored PERSON guard and ordinary opted-out path are unchanged.

After rechecking publication and permission, completion prefixes the <=200-char
abstraction with `A correspondent told Cy: ` or `Cy replied to a correspondent: `.
For example, synthetic `Patience helped with growing seedlings.` becomes
`A correspondent told Cy: Patience helped with growing seedlings.` This is an
UNCERTAIN EPISODIC memory, not proof the testimony is true. Both original
POSTCARD and CY_REPLY source IDs are linked with their SENDER_RECALLABLE visibility;
the public representation/excerpts contain no transcript. Origin records which
side was abstracted. Existing retrieval groups both links as `exchange:N`.

One deterministic memory ID per exchange plus the existing claim receipt and
atomic application prevents duplicate recollections, including replay after a
lost response. Archived/deleted identities cannot be resurrected by late work.
Public summaries cannot occupy protected sender-formation candidate slots:
the scoped indexed query filters them before pool/ranking limits.

The instructions prohibit identifying/private/sensitive details, quotes and
invented claims. Persistence additionally rejects contact/URL/number identifiers,
source-derived capitalized names, the sender handle, control syntax and copied
four-word source spans/full originals. These conservative omissions can reject
useful summaries too. They are defence in depth, NOT an exhaustive semantic
privacy or truth checker: lower-case identifiers, paraphrased sensitive facts or
model misattribution remain possible. No real-model quality claim is made without
authorized natural evidence. Malformed/unsafe optional summaries fail closed and
record a bounded rejection in the private completion receipt while valid sender
formation is preserved. Historical entries and world truth are never rewritten.

## Retrieval and ranking

The current postcard body/caption supplies lexical terms, with common English
function/social-opening words removed. No generic postcard or location tag is
injected as a relevance cue. The existing indexed whole-store prefilter admits
at most 200 rows; source metadata is bounded to 4000 rows. Scope is filtered
before the pool. Complete provenance is required after that bound.

Ranking is deterministic: number of meaningful safe-text term matches, matching
canonical tags also present in that safe text, open-topic type, a recorded
instrumental consequence, then actual source time and memory ID. Update/retrieval
timestamps do not make a memory fresh. Recency cannot outrank a stronger topic
match. This is lexical retrieval, not a claim of semantic understanding or
psychological salience. No match is a normal result.

Source grouping joins postcard:N and postcard-reply:N as exchange:N. Canonical
social, movement, search and instrumental context episode IDs also join related
environment sources. Shared source references are always grouped. Transitive
overlap is resolved before choosing slots, so A+B, B+C and C cannot occupy two
slots. No guessed episode is inferred from prose. Unknown episode relationships
can only be deduplicated through retained source identities.

At most two complete recollections, each <=260 Unicode characters, are offered.
Long records are omitted rather than cut before a qualification or negation.
This is deliberately conservative, not a new summarisation inference.

## Prompt budget and provenance

Both providers receive the same turn-local snapshot through the existing broker.
Optional items share the unchanged 900-character autobiographical section and
7200-character total broker budget. Their origin/uncertainty wording is inside
the charged content. Required sender items retain mandatory priority, even when
they exhaust the optional section. Budget pressure may therefore insert one or
zero of two offered recollections. No unbudgeted optional fallback copy exists.
The existing context/token settings and full-prompt construction are unchanged;
these character limits are the existing engineering broker policy, not an exact
tokenizer measurement or a promise that arbitrary oversized postcard inputs fit.

Items are labelled SUBJECTIVE MEMORY / CY_BELIEVES, with a short origin phrase:
something a correspondent told Cy; something Cy said to a correspondent;
something he experienced; a dream; or a prior thought. Recollection and repeated
recall never become independent world proof. Technical source/visitor IDs never
enter the model-facing item. No authoritative world record is edited.

## Evidence of use

`postcard_associative_recall` in the private inference diagnostic log records
status, wait, considered/offered/inserted counts and source identities. The
existing owner-only memory-query ledger records considered IDs, offered IDs,
actually included broker IDs, origin and source references separately under
POSTCARD_ASSOCIATIVE. Prompt insertion is measured from the actual included
packet after canonical prompt construction, not from prepared/selected data or
a string-match guess. It does not claim the model mentioned the memory, or that
the provider retained it after any provider-side truncation. Logging failure has
its own private diagnostic and cannot block a reply. No prompt/source body is
added to these diagnostics. No new public telemetry payload is emitted.

There is no satiation policy or journal selection in this feature. Those remain
separate design work; journal generation, freshness, voice, model, sampler,
cadence and 93-token ceiling are untouched.

## Verification

Focused Node tests cover protected continuity, private exclusion, whole-record
bounds, no-match, cancellation, source overlap, provenance, actual broker budget
omission, fallback, dry-run API and provider-equivalent serialization. Pure PHP
tests cover safe-text ranking, source completeness, exchange/episode grouping
and transitive deduplication. The opt-in disposable MariaDB/HTTP integration
test exercises the real full-text index, authenticated API, source joins and
existing access ledger without production data or inference.

Initial retrieval verification on 22 October 2026: 61/61 focused Node checks, 24/24 focused
PHP assertions, all 27 PHP suites, the disposable real MariaDB/HTTP integration
test, and 572/572 full runner tests passed with no skips or cancellations in
the invoked final runs. Syntax, manifest parsing and git diff --check passed.
The PHP server and owned loopback database were stopped afterward. Initial
local fixture bootstrap/path/driver setup issues were corrected before the
successful final integration run; no production database was used.

Formation requires migration 032 before any new server code. A future authorized
deployment must coordinate server libraries/API, runner and checkbox/submission
assets. Do not enable the new checkbox against an old submission server, which
does not persist permission. No such deployment is authorized in this task.

Opt-in formation verification on 22 October 2026: 70/70 focused Node tests,
581/581 full runner tests, 22 focused permission/summary PHP assertions and all
28 PHP suites passed. Four owned-disposable MariaDB/HTTP suites passed (canonical
formation delivery, formation provider accounting, associative retrieval/formation
and postcard retry lifecycle). A final associative integration rerun additionally
applied the actual 032 migration over an existing historical row and verified it
stayed ineligible, rejected invalid permission versions, and preserved valid
sender formation when public eligibility was lost between claim and completion.
All test servers/databases were stopped. Only synthetic fixtures/mocked responses
were used; zero model/provider calls, production writes or historical backfill.

After an eventual authorized rollout, important checks are: the checkbox starts
unchecked and resets for the next postcard, opt-out still forms sender memories,
and a natural opted-in exchange is either explicitly omitted/rejected or recorded
once with attributed source-linked public text. Inspect natural summary quality
and privacy before claiming automatic abstraction is reliable; deterministic
fixtures do not demonstrate real-model semantics.

## Real-model rehearsal: release remains blocked

See `rehearsal/postcard-associative-20261022/README.md` and its hash-indexed raw
synthetic evidence. Three fixed batches of sixteen calls used the actual
DeepSeek formation adapter, configured deepseek-v4-flash (returned deepseek-flash),
schema/parser, canonical accounting/application and indexed retrieval in isolated
databases. No production writes, historical data, deployment or backfill occurred.
The final batch accepted six public recollections, rejected three, and omitted
seven. This is not six clean privacy passes: the accepted job-loss/distress
recollection demonstrates an unresolved personal-detail boundary. Recommendation
is REVISE, not deploy. Copy protection was not weakened and no further calls or
fixture tuning were used to manufacture a higher acceptance rate.
