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
assert.match(css, /@media\s*\(min-width:\s*901px\)[\s\S]*?body\s*\{[\s\S]*?overflow:\s*hidden;/, 'desktop document scrolling is contained below the header');
assert.match(css, /\.layout\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;/, 'the desktop board fills only the remaining viewport');
assert.match(css, /\.layout\s*>\s*\.col-paper\s*\{[\s\S]*?position:\s*static;[\s\S]*?overflow:\s*hidden;/, 'the chronology frame stays fixed while its contents scroll');
assert.match(css, /\.col-paper\s*>\s*\.paper,[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;/, 'all centre views use the fixed desktop frame height');

const page = await readFile(new URL('../public/index.php', import.meta.url), 'utf8');
assert.match(page, /id="topbar-spacer"/);
assert.match(page, /id="watchers"[^>]*class="pill watchers-pill"/);
assert.match(page, /cy_asset\('shell-layout\.js'\)/);

const app = await readFile(new URL('../public/assets/app.js', import.meta.url), 'utf8');
assert.match(app, /new Tempo\(tempoEl, TEMPO_ENDPOINT, \$\('#watchers'\)\)/);

const tempo = await readFile(new URL('../public/assets/tempo.js', import.meta.url), 'utf8');
assert.doesNotMatch(tempo, /tp-watchers/);
assert.match(tempo, /this\.countEl\.textContent = `\$\{this\.viewers\} WATCHING`/);

console.log('shell-layout.test.js: all checks passed');
