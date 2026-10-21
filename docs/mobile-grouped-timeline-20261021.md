# Narrow grouped timeline summaries

Implementation only, based on production `ec21652673a263c803ac70c9caf1e370cef14521`.
No merge, deployment, runner restart or production data change.

## Cause and boundary

`ChronologyHierarchy.makeGroup` creates a native `details > summary` with an
expansion-marker pseudo-element and timestamp-range, description and DETAILS
spans. Both handwritten and plain feeds use this shared markup. Timestamp ends
retain their existing `bindEndpointTime` attributes and live-age updates.

The range uses `flex: 0 0 auto`, while the description uses `flex: 1` and
`min-width: 0; overflow-wrap: anywhere`. The former phone rule only enabled flex
wrapping. Flex can therefore keep the metadata on a line while reducing the
description to a nearly letter-wide column. No horizontal overflow is necessary
for this failure.

Direct live-page reproduction at 390 CSS px on 21 October: the current Miss Trace
search summary was 412.75 px tall with only 16.65 px of description width. This is
the same failure family as the older approximately 540 px observation; exact
height varies with wording, age length and font metrics.

Only the existing `max-width: 520px` summary rules change:

- A three-column grid replaces the wrapping flex summary on phones.
- The expansion marker spans both rows.
- The timestamp range spans the remaining columns on its own first row and may
  wrap independently, including long multi-day ages.
- The description and DETAILS cue occupy the second row with useful text width.

No DOM/JS, event ordering, timestamp wording, age semantics, grouping, keyboard
interaction, journal/drawing styling or expanded-step content changes. Above
520px, the old flex rules remain unchanged. There is no clipping or horizontal
scrolling workaround. Only `public/assets/style.css` is a runtime change. The
original asset was retained in the base worktree; the final stylesheet was
prepared from an external working copy before placement.

## Real-browser evidence

The opt-in loopback fixture uses the actual production chronology renderer and
CSS. It compares current CSS against the pinned base Git blob without keeping a
second hand-maintained stylesheet. It freezes time for identical before/after
ages and covers short ambient descriptions, a long refusal/search description
and a two-week timestamp range. It serves only GET fixture assets; no PHP, DB,
runner, production API or model is involved.

Representative long-search measurements from Edge (px):

| Width/view | Before height | After height | Before label width | After label width |
| --- | ---: | ---: | ---: | ---: |
| 390 handwritten | 141.50 | 65.81 | 52.89 | 277.50 |
| 390 plain | 237.13 | 65.81 | 32.89 | 257.50 |
| 360 plain | 922.44 | 65.81 | 2.89 | 227.50 |
| 320 handwritten | 251.13 | 65.81 | 32.86 | 207.50 |

All tested phone summaries are 49.88-81.75 px tall after the fix, with no
horizontal overflow. Independent visual inspection in the in-app browser at
390 and 320 CSS px agrees; font metrics differ slightly from Windows Edge.
At 521, 768 and 1440px, all measured geometry is exactly equal to base in both
views, including text, metadata, cue and summary boxes.

## Tests

- Updated deterministic hierarchy/CSS guards and six relevant runner/frontend
  test files: 6/6 passed.
- New actual-browser layout matrix: fourteen width/view cases plus parent passed
  (320/360/390/520/521/768/1440px, handwritten and plain).
- Together with existing mixed dream/postcard chronology browser regressions:
  **18/18 passed**. All browser requests were restricted to each owned fixture's
  loopback origin.
- Full runner suite: **531/531 passed**, no failures/skips/cancellations.
- `git diff --check` passed.

Browser tests assert preserved wording, timestamp values and step order, live
relative-age refresh, keyboard expand/collapse, compact summaries, readable label
width and no overflow. They also compare exact wider-screen before/after geometry.
The old CSS fails the new phone-layout regression. Initial sandboxed Edge launch
failed due to disposable-profile permissions; the authorized isolated browser
test run outside that sandbox passed. No browser/OS security policy was changed.

Run using the existing browser-test convention:

```bash
CY_RUN_BROWSER_TESTS=1 CY_PLAYWRIGHT_PATH=/path/to/playwright \
  node --test tests/grouped_timeline_layout_browser.test.mjs tests/dream_chronology_browser.test.mjs
```

Optional `CY_LAYOUT_ARTIFACT_DIR` saves before/after 390px screenshots. The local
manual fixture is `node tests/grouped_timeline_layout_fixture.mjs --serve`; it
binds an ephemeral loopback port and stops with Ctrl+C. No server is deployed.
