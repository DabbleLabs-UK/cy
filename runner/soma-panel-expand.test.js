// soma-panel-expand.test.js
//
// Locks the Soma panel expand/collapse control: it widens the .col-brain grid
// column for real reading room, persists the visitor's choice, exposes the
// correct accessible state, and is hidden once the grid stops being a fixed
// multi-column board (nothing left to expand into). Presentation only - this
// does not touch Soma computation, model semantics or backend state.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initSomaExpandToggle, SOMA_EXPANDED_STORAGE_KEY } from '../public/shell-layout.js';

const here = dirname(fileURLToPath(import.meta.url));

// --- minimal DOM stubs, matching the existing codebase convention of testing
// browser-only files via source inspection plus small behavioural stubs
// rather than pulling in a full DOM library (see brain.test.js). ---
function makeClassList() {
  const set = new Set();
  return {
    toggle(cls, on) { if (on) set.add(cls); else set.delete(cls); },
    contains(cls) { return set.has(cls); },
  };
}
function makeButton() {
  const listeners = {};
  return {
    attrs: {},
    textContent: '',
    setAttribute(key, value) { this.attrs[key] = String(value); },
    addEventListener(type, fn) { listeners[type] = fn; },
    click() { (listeners.click || (() => {}))(); },
  };
}
function makeStorage(initial = {}) {
  const store = { ...initial };
  return { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
}

// A. Defaults to collapsed, correct accessible state, no storage write yet.
{
  const button = makeButton();
  const layout = { classList: makeClassList() };
  const storage = makeStorage();
  initSomaExpandToggle(button, { layout, storage });
  assert.equal(layout.classList.contains('soma-expanded'), false);
  assert.equal(button.attrs['aria-expanded'], 'false');
  assert.equal(button.textContent, 'EXPAND');
}

// B. Clicking expands, updates aria state and label, and persists the choice.
{
  const button = makeButton();
  const layout = { classList: makeClassList() };
  const storage = makeStorage();
  initSomaExpandToggle(button, { layout, storage });
  button.click();
  assert.equal(layout.classList.contains('soma-expanded'), true);
  assert.equal(button.attrs['aria-expanded'], 'true');
  assert.equal(button.textContent, 'COLLAPSE');
  assert.equal(storage.getItem(SOMA_EXPANDED_STORAGE_KEY), '1');
  button.click();
  assert.equal(layout.classList.contains('soma-expanded'), false);
  assert.equal(storage.getItem(SOMA_EXPANDED_STORAGE_KEY), '0');
}

// C. A previously-persisted expanded choice is honoured on init (the panel
// stays how the visitor left it across a reload).
{
  const button = makeButton();
  const layout = { classList: makeClassList() };
  const storage = makeStorage({ [SOMA_EXPANDED_STORAGE_KEY]: '1' });
  initSomaExpandToggle(button, { layout, storage });
  assert.equal(layout.classList.contains('soma-expanded'), true);
  assert.equal(button.attrs['aria-expanded'], 'true');
}

// D. No button/layout (feature not present on the page) must not throw.
assert.doesNotThrow(() => initSomaExpandToggle(null, {}));

// --- Source-level checks: the CSS actually widens the grid column, the
// control is keyboard-accessible (a real <button>, not a div), and it is
// hidden once expansion has nothing to widen into. ---
const css = await readFile(join(here, '..', 'public', 'assets', 'style.css'), 'utf8');
assert.match(css, /\.layout\.soma-expanded\s*\{[^}]*grid-template-columns:\s*clamp\((4[5-9]\d|[5-9]\d{2})px/,
  'expanded Soma column must be substantially wider than the ~340-400px default, not a token bump');
assert.match(css, /@media \(max-width: 1180px\)\s*\{\s*\.soma-expand-toggle\s*\{\s*display:\s*none;/,
  'the toggle must hide once the grid is no longer the fixed three-column desktop board');
assert.match(css, /\.soma-expand-toggle:focus-visible/, 'the control must have a visible keyboard focus state');

const indexSource = await readFile(join(here, '..', 'public', 'index.php'), 'utf8');
assert.match(indexSource, /<button[^>]*id="soma-expand-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="brain"/,
  'the control must be a real button with correct initial accessible attributes');

console.log('soma-panel-expand.test.js: all checks passed');
