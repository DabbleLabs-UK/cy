# Private PHP deployment validation

Operator-only correction, based on production `8363197`. No application runtime,
memory candidate, provider, database, service or deployment state is changed.
No merge or deployment is authorized by this tool change.

## Defect and correction

The stopped operator called `opcache_compile_file()` and then `require` on the
same library in one request. Compilation can register function declarations in
the current request without marking the script as included. Loading it again,
even changing that second call to `require_once`, is not a safe remedy.

The reusable private probe accepts a fixed, operator-generated plan. Each fresh
FastCGI request performs exactly one of:

- `compile`: invalidate the target cache entry, then compile the exact hashed
  file. Never include or execute it. Use this for API/handler files and staged
  syntax checks.
- `load`: invalidate the target cache entry, then `require_once` a reviewed,
  declaration-only library. PHP performs normal compilation as part of that
  single load. Verify the required functions/classes afterward. Never call
  `opcache_compile_file` in this branch.

Dependencies keep their ordinary `require_once` behavior. Repeated validation
requests on one long-lived worker remain safe because declarations are scoped to
each request. This does not suppress real duplicate declarations or errors in an
invalid library graph: those must fail the check.

The client requires a complete successful HTTP/JSON receipt with the exact
phase, action, success flag and source hash. It does not salvage a JSON substring
from a fatal/error response. A transport error, malformed response, failed
compilation/load, absent required symbol or changed source fails closed.

## Immediate operator integration

`../journal-memory-leadtime/server-operator.php` preserves the stopped operator's
candidate/base assertions, file allowlist/order, backups, exact old/new hashes,
atomic per-file renames, syntax lint and metadata handling. Only its validation
sequence is corrected:

1. Copy this `probe.php` to the existing private `/run/cy-<release>/` directory;
   write its fixed `validation-plan.json` with reviewed source hashes.
2. Before any active file rename, compile every staged PHP payload in separate
   serving-FPM requests. Repeat this gate at install entry after payload/hash
   and backup verification.
3. After helper installation, compile-check that helper in a fresh request.
4. After library installation, load it once in a different request and require
   the original two availability checks.
5. Compile-check the API in a fresh request without executing its handler.
6. Clean up both private probe files and their directory at postflight.

For a later explicitly approved package, use
`../journal-memory-leadtime/package-validation.mjs` to copy the three operator
members into a fresh package directory and return their exact hashes. This
replaces the stopped builder's copies of `leadtime-server-operator.php` and
`leadtime-fpm-check.php`; that old builder must not be used unchanged. The helper
refuses existing output files rather than overwriting a frozen package. It does
not assemble memory/runtime files or deploy anything. The private probe reads
only the plan in its own directory;
there is no public route or user-supplied filename. Update and independently
verify package member hashes before that future rollout. The previous frozen
`deploy-journal-leadtime-3fd01dc` package is unsafe and remains untouched as
historical evidence; it must not be executed or silently reused.

The generic plan/driver is not journal-specific. Future PHP deployments can
specify their own exact source files and required library functions/classes.
Only reviewed declaration-only libraries may use `load`: no validator can make
an arbitrary top-level script safe to execute. API controllers always use
`compile`. The probe has no application bootstrap, DB, model, network or service
control of its own. The current library's transitive top-level code contains
declarations/includes only; no query or provider is invoked by loading it.

This is not a general deployment/transaction redesign. Staged syntax failures
can now be caught before partial publication. Live dependency/load checks still
occur after their files/dependencies exist, before continuing the rollout; they
cannot guarantee arbitrary application behavior or make a multi-file deployment
atomic. A failure still stops the operator, not an automatic repair/retry.

## Offline verification

Run from the repository root with Node and local PHP 8.4/OPcache/FastCGI:

```text
node --test --test-concurrency=1 ops/php-validation/tests/operator.test.mjs
```

Optional executable paths: `CY_TEST_PHP`, `CY_TEST_PHP_CGI`, `CY_TEST_OPCACHE`.
Defaults use the existing Windows `C:/php84` tools. Missing tools fail rather
than skipping the regression. The suite owns one loopback FastCGI child and a
unique temporary directory, stops the child and removes the fixtures afterward.
No existing PHP, database or production process is used or restarted.

The frozen old mechanism fails against exact source from candidate
`09b77356130d79f443b53ff74fa42f4557e76407` in both CLI and persistent FastCGI
with OPcache. Corrected staged compile and library load requests pass without
changing that source. Negative tests retain syntax/dependency/runtime/symbol/
hash/receipt rejection, handler non-execution and pre-publication ordering.
An operator-only archive test verifies the three source members; it does not
build another memory runtime/deployment package.

Final validation on 28 October 2026: 18/18 tests passed in 14.775 seconds under
PHP 8.4.23 FastCGI/OPcache, zero failures/skips/cancellations. The owned FastCGI
process exited and its private fixtures were removed. All four PHP and two
JavaScript files passed syntax checks; source/whitespace checks passed.
Independent source/package review found no material issue.

All tracked changes are confined to `ops/`. Application runtime and metadata
remain identical to production `8363197`, and candidate `09b7735` remains
unchanged. The old unsafe package retains its original archive hash. No memory
runtime package was rebuilt, no merge was published, and no production host was
contacted or mutated. Production PHP 8.5.12 FPM has not been tested by this task.
Serving-FPM checks remain mandatory for any separately authorized future rollout.
No restart, inference, memory audit or deployment follows automatically.
