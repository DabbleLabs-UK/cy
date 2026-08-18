# async-select

A framework-free `<async-select>` custom element for value changes that are
**confirmed asynchronously by a server**.

The core idea: choosing a value is a *request*, not a fact. Until the host's
`commit` function confirms the change, the control shows the chosen value as
explicitly provisional and keeps the previously-confirmed value visible as the
authoritative one. It never lies about which is which while a round trip is in
flight - and it stays honest through rejection, network failure, timeout, the
user changing their mind mid-flight (supersede), and the value changing
elsewhere (external change).

- Zero dependencies. One ES module, one stylesheet, a shadow root, standard ARIA.
- Works with a slow, fallible network: latency-aware pending state, escalation,
  timeout, retry.
- Also serves **local** (instant, no-server) options - one component, both kinds.
- **Occupies exactly the footprint of a plain select box in every state** - no
  status row, no error field, no reserved space, no layout shift. State is
  expressed with a single glyph in the chevron slot plus a border/wash tint.
- Fully keyboard operable, screen-reader friendly, themeable through CSS custom
  properties.

## Quick start (the one-line case)

```html
<script type="module" src="/cy/public/components/async-select/async-select.js"></script>

<async-select label="Status">
  <option value="draft">Draft</option>
  <option value="review">In review</option>
  <option value="published">Published</option>
</async-select>
```

With no `commit` supplied, changes apply instantly (a plain select). Supply a
`commit` to make changes confirmation-aware:

```html
<async-select id="status" label="Status"></async-select>
<script type="module">
  import '/cy/public/components/async-select/async-select.js';

  const el = document.getElementById('status');
  el.options = [
    { value: 'draft',     label: 'Draft',     description: 'Only you can see it' },
    { value: 'published', label: 'Published', description: 'Live for everyone' },
  ];
  el.value = 'draft'; // the confirmed, authoritative value

  // Return/resolve to confirm. Throw to reject or fail.
  el.commit = async (value, { signal, previous }) => {
    const res = await fetch('/api/status', {
      method: 'POST',
      body: JSON.stringify({ value }),
      signal,               // honour abort so supersede/timeout cancel real work
    });
    if (res.status === 403) throw AsyncSelect.reject('You are not allowed to publish.');
    if (!res.ok) throw new Error('save failed'); // -> FAILED, with Retry
    // resolving confirms the requested value
  };
</script>
```

## The state machine

Every state below stays within the select's own footprint - the visible signal
is a glyph in the chevron slot, the value's own treatment, and a border/wash
tint. Words that used to sit in a status row now live only in the accessible
description, the tooltip, and the live region.

| State | Meaning | What the control does |
|-------|---------|-----------------------|
| **IDLE** | Display equals confirmed server value. | Shows the confirmed value; plain chevron. |
| **PENDING** | A request is in flight. | Shows the *requested* value as provisional (subdued italic, dashed underline) with a spinner in the glyph slot. Below ~150 ms latency it shows nothing (no flicker). |
| **CONFIRMED** | Server agreed. | Brief, quiet tick glyph, then fades back to idle. |
| **REJECTED** | Server refused, or returned a *different* value. | Reverts to the authoritative value; warning glyph + red tint, with the reason in the tooltip / live region only. |
| **FAILED** | Network error or timeout. | Keeps the attempted value visible (provisional), warning glyph + red tint. The glyph is the **retry** control (clickable + keyboard reachable). Never silently reverts. |
| **SUPERSEDED** | User changed their mind mid-flight. | Newer request wins; the stale response is ignored (guarded by a sequence number, not by ordering). |
| **EXTERNAL CHANGE** | Authoritative value changed for another reason. | Momentary highlight, no text; reconciles the baseline without stealing focus or discarding in-flight intent. |
| **UNAVAILABLE** | Control disabled, or an option not permitted. | Disabled control / disabled option, announced, never requested. |
| **LOCAL** | Option needs no confirmation. | Applies instantly; also supersedes any in-flight server request. |

### Escalation

A slow request (past `escalate-delay`, default 3 s) is signalled by
**intensifying the spinner glyph** - thicker and warmer - not by adding any
text. The live region re-announces "still trying" for screen readers.

## The `commit` contract

`commit(value, ctx)` is supplied by the host. `ctx` is
`{ signal, previous, requestedValue }` where `signal` is an `AbortSignal` that
fires on supersede and timeout.

- **Confirm** - resolve. Resolving with nothing, or with the same value, confirms
  the requested value.
- **Server settled on a different value** - resolve with
  `{ value, reason? }` (or just a different plain value). The control treats
  this as an honest rejection: it adopts the server's value and shows the reason.
- **Reject with a reason** - `throw AsyncSelect.reject(reason)`, or
  `throw AsyncSelect.reject(reason, authoritativeValue)` to also correct the
  authoritative value. Any thrown value with `rejected === true` and a `reason`
  works.
- **Fail (transport)** - throw any other error. The control enters FAILED and
  offers Retry.
- **Timeout** - if `commit` does not settle within `timeout` ms, the control
  aborts (via `signal`) and enters FAILED. It does not rely on `commit`
  honouring the signal.

## API

### Properties

| Property | Type | Notes |
|----------|------|-------|
| `options` | `Array<Option>` | `{ value, label?, description?, disabled?, local? }`. Also readable from child `<option>` elements. |
| `value` | `string` | The **confirmed** value. Reading never returns a provisional one. Setting it is treated as an *external* change. |
| `requestedValue` | `string \| null` | The value currently requested (PENDING/FAILED), else `null`. Read-only. |
| `phase` | `string` | `idle \| pending \| confirmed \| rejected \| failed`. Read-only. |
| `commit` | `(value, ctx) => Promise` | Host confirmation function. Omit for instant local behaviour. |
| `disabled` | `boolean` | Reflects the `disabled` attribute. |

### Attributes

`value`, `disabled`, `label` (accessible name), `timeout` (ms, default 10000),
`pending-delay` (ms below which no pending state shows, default 150),
`escalate-delay` (ms after which messaging escalates, default 3000).

### Option fields

`value` (string, required), `label` (defaults to value), `description`
(secondary line), `disabled` (not selectable), `local` (applies instantly, no
`commit` call).

### Methods

- `requestValue(value)` - initiate a change as if the user chose it.
- `setConfirmed(value, { silent? })` - apply an authoritative/external change
  without calling `commit`; reconciles safely mid-flight. (Same as setting
  `.value`.)

### Events

All bubble and are `composed`. `detail` shapes:

- `change-requested` - `{ value, previous }`
- `confirmed` - `{ value, previous, local }`
- `rejected` - `{ requested, value, reason }`
- `failed` - `{ requested, previous, error, timeout }`
- `superseded` - `{ supersededValue }`
- `externalchange` - `{ value, previous, duringPending }`

## Theming

Override any `--as-*` custom property on the element (they inherit through the
shadow boundary). Defaults suit a dark instrument panel but assume nothing.

```css
async-select {
  --as-bg-raised: #1b2029;
  --as-text: #d7e3ec;
  --as-accent: #2b6f9f;
  --as-good: #4fd08a;         /* confirmed */
  --as-bad: #ff6a45;          /* rejected / failed */
  --as-provisional: #ffbf47;  /* requested, not yet true */
  --as-radius: 6px;
  --as-hit: 44px;             /* min touch target */
  --as-pad-y: 8px;            /* trigger padding - lower for a compact/top-bar fit */
  --as-pad-x: 12px;
  --as-min-width: 12rem;
}
```

Structural parts are exposed for deeper theming: `trigger`, `face`, `value`,
`glyph` (the state indicator in the chevron slot), `action` (the interactive
warning/retry affordance), `listbox`, `option`, `option-tag`, `option-desc`.

## Accessibility

- Select-only combobox pattern: `role="combobox"` trigger controlling a
  `role="listbox"`, active option tracked with `aria-activedescendant` so focus
  stays on the trigger and is never stolen across a state change.
- Keyboard: Down/Up/Home/End to move, Enter/Space to choose, Esc to close, Tab
  to leave, and type-ahead.
- A polite live region announces outcomes (confirmed / rejected / failed /
  external), not every keystroke; failures announce assertively.
- Because the state text is no longer visible, the same information is carried in
  the accessible description (`aria-describedby`) and the tooltip: pending
  ("Saving X; currently Y"), and the reject/fail reason. The warning glyph is a
  real focusable button, so a keyboard or screen-reader user can reach the reason
  and trigger retry.
- Visible focus ring; `prefers-reduced-motion` respected (spinner and highlight
  transitions drop out); touch targets >= 44 px. The control never changes size
  between states - it always occupies exactly the select box.

## Demo

`demo.html` exercises every state deliberately - instant / 800 ms / 4 s success,
rejection with a reason, network failure, timeout, a superseding second change,
an external change mid-flight, and local + disabled. Each control sits beside a
plain native `<select>` of the same width so you can verify at a glance that the
box never grows. Served from the wamp share:

```
http://localhost/cy/public/components/async-select/demo.html
```

## Files

- `async-select.js` - the custom element (ES module).
- `async-select.css` - styles and theme tokens.
- `demo.html` - standalone state gallery.
- `README.md` - this file.
