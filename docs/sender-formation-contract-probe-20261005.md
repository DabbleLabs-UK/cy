# Sender formation contract acceptance, 2026-10-05

Implementation candidate: `07cd964`, based on production `751661c`.
Deployment held: the local-model semantic acceptance target was not met.

## Bounded synthetic probes

Three calls per fixture used the unchanged candidate prompt/schema/parser,
actual local Ollama provider and shared arbiter, with disposable in-memory
SQLite state. No production memory writes, postcards or paid calls occurred.

| Fixture | Valid schema | Expected action/type | Faithful decision |
| --- | --- | --- | --- |
| Dog named Alfie | 3/3 | CREATE PERSON, 3/3 | 3/3 |
| Awaiting an unknown result | 3/3 | CREATE UNRESOLVED_THREAD, 3/3 | 2/3 |
| Trivial greeting | 3/3 | NOTHING, 3/3 | 3/3 |
| Explicitly settled offered topic | 3/3 | RESOLVE, 0/3 | 0/3 |

All three resolution calls instead returned UPDATE of the exact offered FM1.
They changed the content to say the result had arrived but would leave the
topic ACTIVE. One open-topic call invented that the sender was not ready to
share the result; its source only said the result was still unknown.
The automated harness checks action/type/target, so its 9/12 passes are not
9 faithful decisions. Manual review yields 8/12 faithful decisions.

No structural failures, invented references, control leakage, truncation or
provider/access failures occurred. Lease wait median/max: 48.531s/182.686s.
Inference median/max: 24.302s/110.785s. Probe-only access and inference bounds
were separately 240s and 120s; production's combined deadline was unchanged.

The first process stopped after the initial four cases. The second process
completed exactly eight further cases without tuning. That running process
loaded before the final exit-code correction and exited zero despite reporting
6/8 action passes; its output, not exit status, establishes acceptance failure.
The committed harness now exits nonzero when the action pass target is unmet.

## Deterministic verification

- 381/381 runner tests.
- 21/21 PHP suites, including 33 formation checks.
- 7/7 disposable database integration suites.
- Independent review found no material implementation/privacy issues.

Schema enforcement, exact reference binding, safe rejection diagnostics and
the independent invalid-decision counter are verified. Correct inference
semantics are not established. Migration 028, production merge, deployment and
restart were not performed. Existing historical statuses and the 17 quarantined
unlinked sources were not reset. Do not claim durable visitor relationships are
solved from these results.
