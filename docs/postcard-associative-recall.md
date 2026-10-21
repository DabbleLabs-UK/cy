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
record, or being a returning visitor does not grant eligibility. This feature
creates or promotes no memories and adds no automatic permission mechanism.
Existing sender formation still produces SENDER_RECALLABLE records only.

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
from deletion of a name. An owner-approved public-safe record must already
exist before cross-correspondent recall can occur. The audit found zero such
correspondence memories in production; this feature does not manufacture them.

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

Final verification on 22 October 2026: 61/61 focused Node checks, 24/24 focused
PHP assertions, all 27 PHP suites, the disposable real MariaDB/HTTP integration
test, and 572/572 full runner tests passed with no skips or cancellations in
the invoked final runs. Syntax, manifest parsing and git diff --check passed.
The PHP server and owned loopback database were stopped afterward. Initial
local fixture bootstrap/path/driver setup issues were corrected before the
successful final integration run; no production database was used.

No migration is required. A future authorized deployment must install both
server API/library and runner changes together; existing callers keep their old
query semantics. New runner + old server fails only the optional lane closed.
