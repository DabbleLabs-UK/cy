# timeseries-chart

A framework-free `<timeseries-chart>` custom element: a **scrubbing** time-series
chart whose entire display state is a viewport, and whose values mean the same
thing at every zoom level.

- Zero dependencies. One ES module, one stylesheet, a shadow root, a canvas.
- Takes an **arbitrary** list of named, coloured series - the categories
  (energy, spend, CPU, ...) are never the component's business.
- **No animation.** Every visual state is a pure function of the viewport,
  recomputed each frame, so the chart is nailed to the pointer. Hard clamps at
  bounds and zoom limits - no bounce, no rubber-band, no easing.
- **Cursor-anchored zoom**: the timestamp under the pointer stays put.
- Plots **rates, not bucket sums**, so a value is zoom-invariant.
- Themed entirely through CSS custom properties. Extraction to a shared repo is
  a directory move, not an untangling.

## Quick start

```html
<script type="module" src="/cy/public/components/timeseries-chart/timeseries-chart.js"></script>

<timeseries-chart id="chart" mode="rate"></timeseries-chart>

<script type="module">
  const chart = document.getElementById('chart');
  chart.data = {
    series: [
      { id: 'cpu', name: 'CPU', kind: 'level', unit: '%',
        samples: [ { t: 1737000000000, v: 22 }, { t: 1737000060000, v: 41 } ] },
    ],
  };
</script>
```

Give the host element a height (the component fills its box). See `demo.html`
for single-series, stacked multi-series, cumulative mode, live-tailing, and
every input method.

## The one idea: the viewport

The whole display is three values:

| State    | Meaning                                          |
| -------- | ------------------------------------------------ |
| `centre` | the timestamp (ms) at the middle of the view     |
| `span`   | how much time is visible, **in seconds**         |
| `follow` | whether the view live-tails the newest sample    |

**Every input is just a different writer to that same state.** A drag writes
`centre`; a wheel writes `span`; a preset button writes `span`; a pinch writes
both. Coherence comes from the shared state, not from matching gestures. The
zoom unit is a **time span in seconds**, never columns or slots.

Read it with `chart.viewport` (returns `{ centre, span, follow }`, `span` in
seconds). Write it with `chart.setViewport({ centre, span, follow })` - any
subset. Values are hard-clamped to the data bounds and the min/max span.

## Data shape

```js
chart.data = {
  series: [
    {
      id:        'spend',      // string, stable identity (colours bind to order)
      name:      'API spend',  // shown in the legend and tooltip
      kind:      'delta',      // 'level' | 'delta'  (see below) - default 'level'
      color:     '#4f9cff',    // optional; else assigned from the palette by index
      unit:      '£',          // display unit for values
      rateLabel: '/h',         // suffix for delta rates (e.g. "£/h"); default '/h'
      ratePer:   3600,         // seconds; report delta rates per this (3600 = /hour)
      defaultSpan: 1800,       // optional per-series initial span (seconds)
      maxSpan:   86400,        // optional per-series furthest zoom-out (seconds)
      samples: [ { t: <ms epoch>, v: <number> }, ... ],  // unsorted is fine
    },
  ],
};
```

Timestamps `t` are **milliseconds since the epoch** (what `Date.now()` gives).
Samples may arrive in any order; they are sorted internally.

### `kind` - what a value means (this dissolves a class of bug)

- **`level`** - `v` is an instantaneous rate/level that is *already*
  zoom-invariant (CPU %, power in kW). Averaging it when zoomed out is honest.
  - *rate* view: the time-weighted average level over the bucket.
  - *cumulative* view: the running time-integral (e.g. power kW -> energy kWh).
- **`delta`** - `v` is an increment that occurred at `t` (a cost, a count).
  Plotting spend-*per-bucket* would mean something different at every zoom, so
  instead we plot a **rate**: pounds per hour. Three pounds an hour is three
  pounds an hour whether computed over a minute or six hours.
  - *rate* view: sum of deltas per unit time, scaled by `ratePer`.
  - *cumulative* view: the running sum (only ever climbs).

Both view modes are zoom-invariant, so the tooltip never has to caveat a bucket
period.

## Forms

- **line / area** - a single series (or `form="line"` to overlay several).
- **stacked ribbon** - two or more series: each ribbon's height is that
  category's value, stacked so total height is the total. A 2px surface-coloured
  gap separates adjacent ribbons so boundaries read without outlines.

`form` is `auto` (line for one series, stacked for several), `line`, or
`stacked`.

## API

### Properties

| Property             | Type     | Notes                                                        |
| -------------------- | -------- | ------------------------------------------------------------ |
| `data`               | object   | `{ series: [...] }` as above. Setting it (re)builds the chart. |
| `options`            | object   | Any tunable below, plus `mode`, `form`, `follow`, `span` (s). |
| `mode`               | string   | `'rate'` (default) or `'cumulative'`.                        |
| `form`               | string   | `'auto'` (default), `'line'`, or `'stacked'`.                |
| `follow`             | boolean  | Live-tail the newest sample.                                 |
| `viewport`           | getter   | `{ centre, span (s), follow }`.                              |

### Methods

| Method                        | Effect                                                    |
| ----------------------------- | -------------------------------------------------------- |
| `setViewport({centre,span,follow})` | Write any subset of the viewport (`span` in seconds).    |
| `push(seriesId, {t, v})`      | Append one sample; keeps the newest edge pinned if following. |
| `toStart()`                   | Jump to the earliest data (releases follow).             |
| `toEnd()`                     | Jump to the newest data and re-arm follow.               |

### Attributes

`mode`, `form`, `follow`, `span` (seconds), `min-span`, `max-span`, `rate-per`.
Attributes seed the initial state; properties are the live API.

## Inputs

Every input writes the viewport, and the chart has keyboard equivalents for
everything - it is never pointer-only.

- **Drag** pans horizontally. Vertical movement falls through to the page; the
  gesture claims an axis only after an ~8px slop threshold, then **locks** that
  axis for the rest of the gesture (no mid-drag switching). A horizontal pan is
  hard-clamped at the data edge and never triggers page side-scroll or
  back-swipe (`touch-action: pan-y`).
- **Wheel** zooms, cursor-anchored. The chart takes the wheel while it can still
  zoom in that direction and **releases it to the page at the zoom limit** - so a
  user scrolling a tall dashboard never gets stuck.
- **Trackpad**: `ctrlKey` on a wheel event indicates a pinch and uses a finer
  rate; a plain two-finger scroll also zooms.
- **Touch**: pinch to zoom anchored on the centroid; drag to pan; the readout
  appears on contact. During a pinch the page is locked out but panning is not
  suppressed - the centre tracks the centroid.
- **Keyboard** (the element is focusable): arrows pan, `+`/`-` zoom, `Home`/`End`
  jump to the extremes. A polite live region announces the centre, span and the
  values there.

## The tooltip

A box beside the cursor (no labels projected onto the axes). It **interpolates
between samples** as the cursor moves - it does not snap to the nearest sample,
because this is a scrubbing chart. Its time readout is always **finer-grained
than the axis ticks** (ticked in days -> readout gives the time of day). It sits
above the cursor, horizontally centred, always fully inside the chart - sliding
sideways near the edges and dropping below the cursor near the top.

For the stacked form it becomes a small **table**: every band with its value,
colour-matched, the total on the bottom row, and the band under the cursor
highlighted. On a stacked area only the bottom ribbon sits on the baseline, so
the tooltip does the real work of reading band heights.

Values are colour-matched to the ribbon; a row key is a short *stroke* of the
series colour, not a filled swatch; the value leads and the label follows. Label
text stays in normal ink - only the coloured key and value carry identity.

## Theming

Set any of these custom properties on the host (or an ancestor). Defaults are a
neutral light theme; an explicit dark set of steps kicks in under
`prefers-color-scheme: dark` (a chosen palette, not an inversion).

| Property                | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `--tsc-surface`         | Plot background; also the 2px ribbon gaps.     |
| `--tsc-ink`             | Primary text.                                  |
| `--tsc-ink-dim`         | Axis labels and secondary text.                |
| `--tsc-grid`            | Grid lines (recessive).                        |
| `--tsc-axis`            | Baseline and left axis (a touch stronger).     |
| `--tsc-area-alpha`      | Line/area fill opacity.                         |
| `--tsc-tooltip-bg`      | Tooltip background.                             |
| `--tsc-tooltip-border`  | Tooltip border.                                |
| `--tsc-tooltip-shadow`  | Tooltip shadow.                                |
| `--tsc-hi`              | Highlighted tooltip row (band under cursor).   |
| `--tsc-focus`           | Focus ring.                                    |
| `--tsc-font`            | Font shorthand for axis + tooltip text.        |
| `--tsc-series-1 .. -8`  | Categorical palette, assigned in fixed order.  |

Colours are assigned by series **index**, in order, and never cycled or
reassigned when a filter changes the series count - so a category keeps its
colour. Provide `color` per series, or `--tsc-series-N` to override slot N.

The Y axis uses `niceCeil` (1, 2, 2.5, 5 or 10 times a power of ten) rather than
the raw data max.

## Tunables - the cross-platform contract

Every tunable value in one table. These are the numbers copied back into the
canonical spec. Override per instance via `chart.options = { ... }` or the
matching attribute where one exists.

| Tunable          | Default | Unit    | Attribute    | Meaning                                                      |
| ---------------- | ------- | ------- | ------------ | ------------------------------------------------------------ |
| `slopPx`         | `8`     | px      | -            | Movement before a drag claims and locks its axis.            |
| `wheelZoomRate`  | `0.0015`| exp/dY  | -            | Span-multiplier exponent per unit wheel `deltaY`.            |
| `pinchWheelRate` | `0.01`  | exp/dY  | -            | Same, for `ctrlKey` wheel (trackpad pinch) - finer.          |
| `keyPanFraction` | `0.15`  | frac    | -            | Arrow-key pan step, as a fraction of the span.               |
| `keyZoomFactor`  | `1.3`   | mult    | -            | `+`/`-` zoom step, span multiplier per press.                |
| `minSpan`        | `5`     | seconds | `min-span`   | Closest zoom-in.                                             |
| `maxSpan`        | `null`  | seconds | `max-span`   | Furthest zoom-out; `null` => the data extent.                |
| `defaultSpan`    | `1800`  | seconds | `span`       | Initial span when none is supplied.                          |
| `ratePer`        | `3600`  | seconds | `rate-per`   | Report delta rates per this (3600 = per hour).               |
| `longPressMs`    | `450`   | ms      | -            | Touch hold before the readout latches.                       |
| `followSnapPx`   | `6`     | px      | -            | Within this many px of the newest sample => re-arm follow.   |

Reference spans to design against: ~30 seconds, ~30 minutes, ~6 hours. Each
series may set its own `defaultSpan` and `maxSpan`.

## Notes on decisions

- **Canvas, not SVG.** Live-tailing and per-pixel rate evaluation want a
  redraw-per-frame model without per-sample DOM churn, and canvas removes any
  temptation to add CSS transitions to data marks.
- **Wheel trade-off.** Swallowing the wheel unconditionally would break page
  scrolling on a tall dashboard; ignoring it would make zoom feel dead. The
  chart takes the wheel while it can still zoom in that direction and releases it
  to the page at the limit - documented above.
- **Rendering and the tooltip share one value function**, so what you scrub
  reads exactly what is drawn.
