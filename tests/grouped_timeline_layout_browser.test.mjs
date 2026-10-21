// Opt-in real-engine regression. Only isolated loopback fixtures are requested.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createLayoutServer } from './grouped_timeline_layout_fixture.mjs';

const require = createRequire(import.meta.url);
const enabled = process.env.CY_RUN_BROWSER_TESTS === '1';
const artifacts = process.env.CY_LAYOUT_ARTIFACT_DIR;

test('group summaries keep readable phone labels and identical wider layout', {skip:!enabled,timeout:90000}, async t => {
  const {chromium} = require(process.env.CY_PLAYWRIGHT_PATH || 'playwright');
  const server = createLayoutServer();
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({channel:'msedge',headless:true});
    if (artifacts) await mkdir(artifacts,{recursive:true});
    for (const width of [320,360,390,520,521,768,1440]) for (const view of ['handwritten','plain']) {
      await t.test(width + 'px ' + view, async () => {
        const page = await browser.newPage({viewport:{width,height:1000}});
        const external = [], errors = [];
        await page.route('**/*', route => {
          if (new URL(route.request().url()).origin === origin && route.request().method() === 'GET') return route.continue();
          external.push(route.request().url());return route.abort();
        });
        page.on('pageerror',e=>errors.push(e.message));
        const saveShot = async name => {
          const height = await page.locator('.fixture').evaluate(e=>Math.ceil(Math.min(innerHeight,e.getBoundingClientRect().bottom+18)));
          await page.screenshot({path:join(artifacts,name),clip:{x:0,y:0,width,height}});
        };
        const measure = () => page.evaluate(() => {
          const rect = e => {const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
          const groups = [...document.querySelectorAll('.cy-chronology-group')];
          return {
            width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,
            groups:groups.map(e=>{
              const h=e.querySelector('summary'),time=h.querySelector('.cy-chronology-group-time'),label=h.querySelector('.cy-chronology-group-label');
              return {head:rect(h),time:rect(time),label:rect(label),cue:rect(h.querySelector('.cy-chronology-group-cue')),
                display:getComputedStyle(h).display,text:label.textContent,
                times:[...h.querySelectorAll('time')].map(n=>({ms:n.dataset.cyEndpointMs,text:n.textContent})),
                steps:[...e.querySelectorAll('.cy-chronology-step time')].map(n=>n.dataset.cyEndpointMs)};
            }),
          };
        });
        try {
          await page.goto(origin + '/?before=1&view=' + view);
          await page.waitForSelector('html[data-ready="true"]');
          const before = await measure();
          if (artifacts && width===390 && view==='handwritten') await saveShot('before-390.png');
          await page.goto(origin + '/?view=' + view);
          await page.waitForSelector('html[data-ready="true"]');
          const after = await measure();
          assert.equal(after.width,width);
          assert.equal(after.overflow,false);
          assert.equal(after.groups.length,3);
          assert.deepEqual(after.groups.map(g=>[g.text,g.times,g.steps]),before.groups.map(g=>[g.text,g.times,g.steps]),'timestamps, wording and event order unchanged');
          if (width<=520) {
            for (const g of after.groups) {
              assert.equal(g.display,'grid');
              assert.ok(g.label.w>=150,JSON.stringify(g));
              assert.ok(g.head.h<=145,JSON.stringify(g));
              assert.ok(g.label.y>=g.time.y+g.time.h-1,'metadata is above wording');
              assert.ok(g.cue.x>=g.label.x+g.label.w-1,'details cue does not overlap wording');
              assert.ok(g.time.x+g.time.w<=g.head.x+g.head.w,'metadata fits the row');
            }
          } else assert.deepEqual(after,before,'desktop/tablet geometry exactly unchanged');
          const summary = page.locator('summary').nth(1);
          await summary.focus();await page.keyboard.press('Enter');
          assert.equal(await page.locator('details').nth(1).getAttribute('open'),'');
          assert.ok(await page.locator('details').nth(1).locator('.cy-chronology-steps').isVisible());
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('details').nth(1).getAttribute('open'),null);
          const oldAge = await page.locator('summary time').first().innerText();
          await page.evaluate(()=>window.advanceFixtureAges());
          assert.notEqual(await page.locator('summary time').first().innerText(),oldAge,'relative ages remain bound/updatable');
          if (artifacts && width===390 && view==='handwritten') await saveShot('after-390.png');
          assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
          console.log(JSON.stringify({width,view,before:before.groups.map(g=>({height:g.head.h,labelWidth:g.label.w})),after:after.groups.map(g=>({height:g.head.h,labelWidth:g.label.w})),overflow:after.overflow}));
        } finally { await page.close(); }
      });
    }
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
});
