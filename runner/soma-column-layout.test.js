import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../public/index.php', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/assets/style.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/shell-layout.js', import.meta.url), 'utf8');

assert.match(page, /<div class="panel-title">SOMA<\/div>\s*<div id="brain"><\/div>/,
  'Soma has its original plain panel heading');
assert.doesNotMatch(page, /soma-expand-toggle/,
  'there is no left-column expand control');
assert.match(css, /\.layout\s*\{[^}]*grid-template-columns:\s*clamp\(340px, 27vw, 400px\) minmax\(360px, 1fr\) clamp\(300px, 25vw, 380px\)/,
  'the desktop board retains its compact three-column layout');
assert.doesNotMatch(css, /soma-expanded|soma-expand-toggle|panel-title-row/,
  'there are no expanded-width or toggle styles');
assert.doesNotMatch(script, /soma-expanded|soma-expand-toggle|localStorage/,
  'the layout no longer restores an obsolete expanded preference');

console.log('soma-column-layout.test.js: all checks passed');
