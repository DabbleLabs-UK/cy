# Hosting convention: CY dev/admin/debug web UIs

**Rule:** any CY-related browser tool (admin dashboards, debug viewers,
internal inspection tools, the replay workbench, etc.) gets a stable URL
under `cy.dabblelabs.uk`, admin-gated the same way as the rest of the site.
It does not get spawned ad hoc on a random workstation/port that Jody has to
remember or re-start by hand.

## Why

Before this convention, the Soma replay workbench was `node
runner/soma-replay-server.js` run manually on whatever machine happened to be
free, reachable only at `http://<that machine>:4610/`. That is fine for a
five-minute local check but is not something to depend on: the port isn't
memorable, nothing restarts it after a reboot, and it isn't reachable except
from that one machine's network.

## The pattern

1. **Routing**: reuse the site's existing stack (Caddy + PHP-FPM, see the
   README's `## Deploy` section) - no new reverse-proxy, subdomain, or open
   port. A new tool is just more files under `public/`, reachable at
   `cy.dabblelabs.uk/<tool>/`, exactly like every existing `public/api/*.php`
   endpoint. This needs zero Caddy/Infra changes as long as the tool's own
   compute can run as something PHP can call directly (a plain PHP endpoint,
   or a short-lived subprocess it shells out to - see below). Reaching for a
   persistent backend service + a new Caddy route is a bigger step; only take
   it if the tool genuinely cannot be expressed as "PHP handles the request,
   optionally shelling out briefly."

2. **Auth**: gate every file in the tool with the SAME check the rest of the
   site's admin surface uses - `captive_is_admin($db)` from `lib/admin.php`
   (same-network-as-DELL, or the `?111` fallback). Do not invent a new login
   or a new IP-allowlist mechanism. Apply the check to EVERY reachable file,
   including static-looking JS/CSS - see "no unauthenticated static leak"
   below.

3. **No unauthenticated static leak**: Caddy serves a literal `.js`/`.css`
   file directly, bypassing PHP-FPM entirely (that's how `public/assets/*.js`
   already works, deliberately, because that code IS public). An admin tool's
   client code should NOT be reachable that way unless you've deliberately
   decided it's fine to be public. The replay workbench's approach: give
   gated assets a `.php` extension (`viewer.js.php`, `viewer.css.php`, ...)
   so every one of them is forced through PHP-FPM and the same admin check,
   with a tiny PHP wrapper that reads the real source file and serves it with
   the right `Content-Type`. The real source stays wherever it already lived
   (e.g. `runner/replay-viewer/`) - never duplicated into `public/`.

4. **Heavy/JS-only computation**: if the tool's engine is Node (not PHP) but
   doesn't need a live model, DELL/LENO, or production data - i.e. it's
   deterministic and fast over static/synthetic fixtures - let PHP shell out
   to a small Node CLI subprocess per request (see
   `lib/replay_workbench.php` / `runner/soma-replay-api-cli.mjs`). This needs
   `node` installed on the box PHP-FPM runs on (an environment fact to verify
   once per deploy, not an ongoing service to babysit) but no persistent
   process, no port, and no Caddy change.

5. **If it genuinely needs DELL/LENO**: some future tool might need real
   inference, GPU/Ollama, or another resource that only exists on a
   workstation. In that case do NOT expose that workstation's port directly
   to the internet. Prefer a stable VPS3-facing access/routing layer (the
   existing DELL -> `api/ingest.php` push pattern, authenticated with
   `X-Cy-Key`, is the model to extend) over a raw port. Routing/reverse-proxy
   changes that reach beyond the CY app itself are Infra's call, not CY's -
   prepare an exact handoff rather than making that change from here.

## Worked example: the Soma replay workbench

- URL: `https://cy.dabblelabs.uk/replay/` (admin-only, not linked from the
  public page - same "light obscurity, not a login" posture `lib/admin.php`
  already documents for the rest of the owner tooling).
- Files: `public/replay/{index.php,viewer.js.php,timeline-model.js.php,viewer.css.php,api.php}`,
  `lib/replay_workbench.php`, `runner/soma-replay-api-cli.mjs`.
- The six golden fixtures are synthetic and already in the repo
  (`runner/soma-replay-fixtures.js`) - no live model, no DELL/LENO, no
  production DB read - so the whole tool runs entirely on the box already
  serving `cy.dabblelabs.uk`.
- `node runner/soma-replay-server.js` still exists for quick local dev
  (`http://127.0.0.1:4610/`) and stays in lock-step with the hosted version:
  both call the exact same shared logic in `runner/soma-replay-api.js`, and
  `runner/replay-viewer/viewer.js` uses one relative `api.php?action=...`
  entrypoint that resolves correctly under either path.
- Restart/reboot: nothing to restart. There is no persistent workbench
  process - each admin request runs a short-lived `node` subprocess and PHP
  serves the rest, exactly like every other page on the site. It works
  whenever Caddy/PHP-FPM are up, which is already a precondition for
  `cy.dabblelabs.uk` to exist at all.
