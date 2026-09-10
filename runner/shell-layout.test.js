import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { syncTopbarHeight } from '../public/shell-layout.js';

const set = [];
const root = {
  style: {
    setProperty(name, value) { set.push([name, value]); },
  },
};
const topbar = {
  getBoundingClientRect() { return { height: 63.2 }; },
};

assert.equal(syncTopbarHeight(topbar, root), 64);
assert.deepEqual(set, [['--cy-topbar-height', '64px']], 'the spacer tracks a wrapped header exactly');

const css = await readFile(new URL('../public/shell-layout.css', import.meta.url), 'utf8');
assert.match(css, /#topbar\s*\{[\s\S]*?position:\s*fixed;/, 'the header is fixed to the viewport');
assert.doesNotMatch(css, /position:\s*sticky;/, 'the failed sticky implementation is gone');
assert.match(css, /#topbar-spacer\s*\{[\s\S]*?var\(--cy-topbar-height\)/);

const page = await readFile(new URL('../public/index.php', import.meta.url), 'utf8');
assert.match(page, /id="topbar-spacer"/);
assert.match(page, /cy_asset\('shell-layout\.js'\)/);

console.log('shell-layout.test.js: all checks passed');
