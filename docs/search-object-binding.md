# Search property identity boundary

Source-only repair based on production `76cfd02`. No deployment, inference,
history repair or new possession system is part of this change.

## Proven defect

The 21-24 October natural audit counted 17 handover/retention resolutions.
On 24 October, canonical event `env-986eddc2-8254-4969-9c0e-7ab3c69a7195`
at 21:48:13.931 BST said Mr Locke searched, found nothing, and an item remained
with Cy. Public sequences 2947418/2947419/2947422 show the opening, engineering
branch and resolution. There was no usable Cy-held canonical object. The latest
search was instead Bailey's already-completed search
`search-47bfab50-6b69-4756-88e7-6baad4f250ec`, with a null object ID and a retained
property result. Three other outcomes that day asserted an item had been handed
over, including `env-ed8955da-fedd-4a2d-adc3-599f1de66598` at 12:43:47.914 BST.

An offline execution of the exact pre-fix functions from `76cfd02` reproduces
both failures: open officer/search without an object or search ID, resolve the
withhold branch, then mark a different completed Bailey search retained while its
object ID remains null. This is not journal speculation.

History explains the two independently evolved paths:

- `b9df51e` introduced generic officer/search instrumental branches on 11 September.
- `0fe19bbc` connected their resolution to the latest staged search/object on
  13 September, without binding pending work to that identity.
- Later object revisions (`bceee372`) and incident safeguards (`e018a5a`) did not
  gate creation of the original possession consequence.

## Invariant and lifecycle

Only the staged search's explicit PROPERTY_RESULT callback supplies a search ID.
Generic officer searches still occur at their existing frequency and location
checks, but cannot borrow a staged search or open an item scenario.

Admission requires that exact ACTIVE search at PROPERTY_RESULT, Cy currently in
CELL and present from the start, the same officer, an inspected object, and an
actually available Cy-held object in the canonical inventory. The existing
active/current-delivered-message rules are reused; current holder overrides owner.
There is no replacement-object search and no placeholder creation.

Pending state adds `propertyBinding`:

```json
{
  "searchId": "existing search identity",
  "objectId": "existing canonical object identity",
  "actorId": "existing officer identity",
  "revision": 1,
  "transitionId": "existing canonical transition UUID"
}
```

Resolution rechecks the same identity, stage, presence, availability and revision
before preparing any world outcome. A legacy object without revision metadata
can bind with null revision/transition; once it gains a revision it no longer
matches that old binding. Invalid revision metadata fails closed.

Handover prepares confiscation of only that object with its next ordinary world
revision and existing source-linked custody incident. Retention leaves the object
unchanged. Both record one `property_action` receipt on that exact search with
opportunity ID, object ID, action and timestamp. The changed property result and
receipt prevent replay, including retention where no object revision changes.
No generic resolution may select or mutate the latest/previous search.

Existing sectioned checkpoint serialization preserves the binding, search receipt
and object state without a schema migration. Old unbound pending evidence is
preserved on load but rejected with an operational diagnostic when serviced;
no historical outcome is inferred. Old published records and old completed
search records are not rewritten or reconciled by this repair.

## Validation boundary and limitations

Focused tests cover object absence/unavailability, current ownership, explicit
episode admission, both divergent outcomes, revision fencing, wrong/completed
searches, adjacent searches, duplicate offers, actual runner resolution wiring,
and real sectioned-checkpoint recovery/replay. Existing non-property instrumental
scenarios and empty staged searches remain covered by their regressions.

Final focused result: 70/70 passing, including the development harness.
Final full runner result: 721/721 passing, zero failures, cancellations or skips,
across 136 root test files (83.0 seconds, not a performance benchmark). The new
binding suite contains 23 tests, including execution of the actual runner
resolution function and real sectioned-checkpoint save/load. Syntax, JSON
manifest and whitespace checks pass. The first full run exposed a development
soak harness importing the removed unsafe mutator; that harness now uses the
same binding and effect-preparation functions, and its isolated synthetic soak
regressions pass. No LLM or production state is used by these tests.

This is a correctness gate on existing world mechanics, not new Cy agency.
The engineering round-robin remains unchanged for genuinely admitted branches.
Search selection probabilities, stage timing, unrelated officer events and all
LLM paths/settings are unchanged. Existing checkpoint/public delivery guarantees
are reused, not redesigned; no new transactional publication subsystem is added.
An invalidated pending interaction produces no possession or loss outcome rather
than guessing what happened. Existing false history can still be read as history;
this feature does not retroactively remove it from prompts or memories.
