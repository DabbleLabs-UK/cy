import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hud = await readFile(join(here, '..', 'public', 'assets', 'hud.js'), 'utf8');
const css = await readFile(join(here, '..', 'public', 'assets', 'style.css'), 'utf8');
const hostCss = css.slice(css.indexOf('/* ================= HOST PANEL ================= */'), css.indexOf('/* ================= FORMS ================= */'));

assert.doesNotMatch(hud, /Math\.max\(0\.45/, 'stale diagnostics are never faded to low contrast');
assert.match(hud, /this\.snap\.style\.opacity = '1'/, 'stale diagnostics remain fully opaque');
assert.match(hostCss, /--hp-label:/, 'the host card has one shared readable label colour');
assert.match(hostCss, /--hp-muted:/, 'the host card has one shared readable secondary colour');
assert.match(hostCss, /--hp-value:/, 'the host card has one shared value colour');
assert.match(hostCss, /\.hp-snap \{ position: relative; opacity: 1; \}/, 'the last-generation section stays fully legible');
assert.doesNotMatch(hostCss, /\.hp-cyc-zero \{ color: var\(--line\)/, 'zero cycle values do not disappear into border colour');

console.log('hud-view.test.js: all checks passed');
