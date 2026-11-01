# CY rollout endpoint ownership gate

Operator-only correction, 1 November 2026. This directory is not CY runtime and
must not be installed into `C:\dev\cy` or the VPS3 application tree.

## Former false negative

Previous private rollout packages used `Get-NetTCPConnection -State Listen` and
required one row on ports 11434 and 11435, with none on 11535. On 1 November,
unfiltered CIM returned the expected loopback server endpoints with raw state 0
and a null rendered State. Filtering for Listen therefore returned zero.

Read-only independent inspection established one genuine service per endpoint:

| Endpoint | Owner | Established identity |
| --- | --- | --- |
| 127.0.0.1:11434 | PID 15236 at diagnosis | Pinned Ollama 0.34.1 executable, `ollama.exe serve` |
| 127.0.0.1:11435 | PID 14820 at diagnosis | Windows Node running the existing WSL-supervised arbiter release |

The PIDs above are evidence, not acceptance pins. Existing supervisor/unit
configuration supplies executable, command and version expectations in
`Get-CyEndpointPolicy`. The Ollama executable hash is the existing supervisor
pin. The arbiter executable/command path is the existing resolved service
command, not a newly learned process. Its Node binary did not previously have a
reviewed hash pin; this check does not invent one.

At 2026-11-01T13:27:17.3989835Z, a read-only native
`GetExtendedTcpTable/TCP_TABLE_OWNER_PID_LISTENER` query returned exactly those
two IPv4 endpoints and no IPv6 endpoints. Even that listener-only table reported
anomalous raw states (1 for Ollama, 0 for arbiter). The state anomaly's cause is
unknown. This correction neither explains nor repairs it.

## Required invariant

For EACH required endpoint, the checker now requires all of:

1. Exactly one native **listener-only owner table** row for that port, across
   IPv4 and IPv6. The native API is called with table class 3, never class 5
   (all connections). Membership in the listener-only table establishes the
   listener role; its anomalous state field is retained, not reinterpreted.
2. Exactly one matching unfiltered CIM server-shaped row (unspecified remote
   address, remote port 0), with raw state 2 (normal Listen) or the demonstrated
   raw 0. Missing/other CIM state is not converted to zero or accepted.
3. Both observations identify exactly `127.0.0.1`, the required port and the
   same positive owner PID. Extra native endpoints, even identical duplicate
   rows, fail closed. No wildcard/IPv6/alternate-address fallback exists.
4. The owner has the expected name, exact executable path and command, readable
   creation identity, and existing executable hash pin where available. Exactly
   one matching genuine server process may exist, not two on different ports.
5. Existing HTTP health checks succeed. Ollama also matches its existing pinned
   version. Endpoint/process identity is checked again after HTTP and must be
   unchanged, including creation time (PID reuse cannot satisfy continuity).

Port 11535 remains forbidden as a listener in either source, including raw 0.
Accepted connections with nonzero remote ports do not count as listeners.
Enumeration, identity/hash, native API, HTTP or access failures remain fatal.
There is no HTTP-only, process-only, raw-zero-only or inferred-owner fallback.
The existing single-runner, public HTTP, spool and restart-marker checks remain.

## Fresh package use

Historical private package scripts/receipts are immutable evidence. Do not edit
them or copy their old `health.ps1` into a new rollout. The maintained replacement
is this directory's `health.ps1` plus its adjacent `endpoint-ownership.ps1`.

For a newly authorized rollout, export the two exact reviewed PowerShell Git
blobs plus `invoke-health.mjs` into the fresh private operator package, retain
their relative names, and include all three SHA-256 hashes in its receipt.
Compare package bytes against source before execution. CRLF-converted source
checkouts are not exact packages; export the blobs rather than normalizing live
input at execution time. Do not modify historical package bytes or receipts.

Invoke the reviewed Node launcher on DELL with an absolute package directory:

```sh
node.exe <reviewed-operator-directory>/invoke-health.mjs <absolute-package-directory>
```

The launcher reads only fixed `health.ps1` and `endpoint-ownership.ps1` names,
requires their exact approved SHA-256 pins, and substitutes the verified helper
at the one reviewed import position. Neither PowerShell file is modified.
It uses the already-successful command convention from CY's read-only probes:
fresh Windows PowerShell 5.1, `-NoProfile -NonInteractive -OutputFormat Text
-EncodedCommand`, with command text supplied on stdin and compiled using
`ScriptBlock.Create`. It does NOT use `-File`, dot-source a script file, or
ask to change any execution policy, signing or trust setting.

Only a short fixed bootstrap and a computed hexadecimal digest enter argv.
The complete source travels as base64 stdin, is hash-verified inside PowerShell
before strict UTF-8 decoding/compilation/execution, and never enters a shell.
Path metacharacters are ordinary filesystem input, not PowerShell source.
Truncated/changed stdin, malformed source, native failure/timeout/signal,
missing/incomplete/multiple JSON receipts or nonzero native exit fail closed.
Success forwards the checker's original stdout unchanged. No endpoint, process,
HTTP or health rule is reimplemented in the launcher.

Use native Node process spawning as in the established DELL probes, not an
unchecked shell exit code: the stopped direct WSL/Windows invocation returned
empty stdout while its actual Windows child reported failure. For remote use,
the existing `ssh dell node.exe --input-type=module` stdin transport can import
the exact hash-verified launcher in memory and call `runHealthCheck`; no operator
or application installation is needed for standalone verification. Propagate
exceptions/nonzero status and require the original full receipt.

Missing/changed helper fails closed. Do not paste partial functions, modify hash
pins to accept unknown bytes, or feed an ALL-table snapshot into the verifier.
If machine controls also prohibit command execution, fail closed; do not relax
them or switch policy/trust settings. This is reuse of the existing permitted
command interface, not an authorization to disable security controls.

No change to the writer-role application candidate is required to use these
operator files. Keep source/remote, runtime hashes, backups, guarded restart and
all other established rollout gates. This change does not authorize a rollout.
If the expected startup executable or command genuinely changes in future,
review the new identity explicitly; do not learn/accept whichever process owns
the port. Inability to inspect either source is a blocked gate, not permission
to bypass it.

Only existing non-content operator receipts gain endpoint authority/raw-state,
process identity and pin evidence. No application record, prompt, prose, secret,
model payload, inference, queue, configuration or service is changed. Native
type compilation is local inspection support, not service installation.

## Offline validation

```sh
node --test ops/rollout-health/tests/operator.test.mjs
node --test ops/rollout-health/tests/invocation.test.mjs
```

The test runner uses Windows PowerShell 5.1 by default. Its 47 deterministic
checks use synthetic endpoint/process fixtures and mocked inspection/HTTP/spool
commands, including the exact wrapper body. Two static operator checks guard
table-class selection and absence of mutation/inference commands. A separate
compile-only check compiles the actual native collector without calling it.
Tests do not inspect live endpoints, bind ports, start services or make HTTP or
provider requests. `CY_OPERATOR_TEST_POWERSHELL` can select another installed
PowerShell for an additional compatibility run; it is test-only, not a health
gate bypass. No full application suite is necessary for an operator-only delta;
all `runner/`, PHP, configuration and manifest bytes remain unchanged.

Recorded validation: 47/47 deterministic checks and all four Node test groups
passed under Windows PowerShell 5.1, then again under PowerShell 7. Independent
source/test/package-procedure review found no material issue or gate weakening.
The initial test run exposed two test-double/assertion mistakes (a missing mock
switch type and a static regex matching the existing restart-marker filename);
both were corrected in tests, without changing the operator to make them pass.

A standalone read-only execution of these exact checker definitions, transported
in memory without installation, passed at 2026-11-01T13:35:19.9269834Z. Both
services retained the diagnosed PIDs/creation identities and passed ownership,
pin and HTTP checks. CY still had one runner (PID 9920), both public sites
returned 200, both reported spools were empty and no restart marker existed.
The first attempted diagnostic transport exceeded the local Windows command
length and did not reach DELL; stdin transport then succeeded. Fresh packages
originally specified `-File`; the later stopped attempt proved that invocation
was incompatible with DELL's existing policy. The method above supersedes it.
The full private read-only receipt is retained with the task evidence, not in
application storage. No application deployment, restart or inference occurred.

At that first checker correction, production was `3aabfa46...`. The subsequent
writer-role rollout pushed merge `2adbce6593900e6abd89b18d73cfceb0040eca2f` but
stopped before backup, metadata installation, runtime replacement or restart:
Windows rejected `-File health.ps1` with `running scripts is disabled` and native
exit 1. The prior in-memory preflights had passed; the checker invariant and
runtime were not at fault. No policy was changed. Deployed `warden.js` remained
the old raw hash `5ecb38ebec1e2804c7e31356f56d1b09d263de2e25ca5b6cbb6e44f8a3423b24`.

The invocation correction changes only the launcher, deterministic tests and
these instructions. Its 16 tests compare successful/failing actual checker
execution with the prior command convention under offline doubles, exercise
truncation/hash/parser/receipt/exit failures, preserve literal quoting and Unicode,
handle large source without the Windows command-line bound and reject malformed
CLI/package input. A policy-constrained process double models the known `-File`
denial without changing policy. Actual serving-machine compatibility must also
be verified read-only under its unchanged effective policy; a local simulated
constraint is not claimed as proof of that environment.

Final offline validation passed all 20 Node test groups, including the 16 new
invocation cases and the unchanged 47 deterministic endpoint checks. Syntax and
whitespace checks passed. Independent source/test/documentation review found no
material issue, policy weakening or shell-quoting/injection path. One new test
was adjusted to keep Node's required lowercase `.mjs` format suffix while varying
Windows filesystem path casing; the launcher/checker logic was not changed for
that test. No full application rerun is required for this operator-only change.

An explicitly authorized application retry must start from the already-pushed
merge, recheck fresh source/runtime/package/health gates and use the reviewed
invocation. Do not create another merge, restore old state, install the runtime
or restart merely because this operator correction passes. This task authorizes
only standalone read-only verification. The cause of the Windows TCP state
anomaly remains unresolved and is not investigated here.
