// Opt-in browser regression; loopback fixtures only, no production or inference.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const enabled = process.env.CY_RUN_BROWSER_TESTS === '1';
const require = createRequire(import.meta.url);
// Canonical IDs/times from the #27 audit; prose is deliberately synthetic.
const period = 'sleep-2026-10-06';
const events = [
  { seq: 2252008, ts: '2026-10-07 01:09:00.050', kind: 'dream', payload: { id: 'before', sleep_period_id: period, fragments: ['An earlier dream fragment.'] } },
  { seq: 2252103, ts: '2026-10-07 01:12:15.386', kind: 'mode', payload: { from: 'dream', to: 'letter', postcard_id: 27, postcard_to: 'fixture visitor' } },
  { seq: 2252110, ts: '2026-10-07 01:12:17.349', kind: 'text', payload: { mode: 'letter', s: 'got your card.' } },
  { seq: 2252117, ts: '2026-10-07 01:12:17.361', kind: 'postcard_out', payload: { reply_to: 27, to: 'fixture visitor', body: 'got your card.' } },
  { seq: 2252118, ts: '2026-10-07 01:12:17.362', kind: 'mode', payload: { from: 'letter', to: 'journal' } },
  { seq: 2252119, ts: '2026-10-07 01:12:17.362', kind: 'mode', payload: { from: 'journal', to: 'dream' } },
  { seq: 2252274, ts: '2026-10-07 01:17:33.009', kind: 'dream', payload: { id: 'after-1', sleep_period_id: period, fragments: ['A later dream fragment.'] } },
  { seq: 2252551, ts: '2026-10-07 01:27:08.104', kind: 'dream', payload: { id: 'after-2', sleep_period_id: period, fragments: ['Another fragment in the same contiguous run.'] } },
  { seq: 2253159, ts: '2026-10-07 01:48:15.988', kind: 'dream', payload: { id: 'after-3', sleep_period_id: period, fragments: ['The latest fragment belongs below the reply.'] } },
];

test('dream segments preserve mixed chronology in desktop and mobile browsers', { skip: !enabled, timeout: 90000 }, async t => {
  const { chromium } = require(process.env.CY_PLAYWRIGHT_PATH || 'playwright');
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      response.setHeader('Cache-Control', 'no-store');
      if (request.method !== 'GET') throw new Error('fixture is read-only');
      if (url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/style.css"><style>body{display:block}.fixture{width:min(650px,100%);height:800px;margin:auto}.paper{width:100%;height:100%}</style></head><body><main class="fixture"><div id="paper" class="paper"></div></main></body></html>');
      } else if (url.pathname === '/api/range.php') {
        const after = Number(url.searchParams.get('after') || 0);
        const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
        const matches = events.filter(e => e.seq > after && e.seq < before);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, now: 2253159, events: matches, cursors: { has_more_backward: after > 0, has_more_forward: before < 2253159 } }));
      } else if (/^\/assets\/[a-z0-9-]+\.(js|css|json)$/.test(url.pathname)) {
        const body = await readFile(new URL('../public' + url.pathname, import.meta.url));
        response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'application/json' });
        response.end(body);
      } else { response.writeHead(404); response.end(); }
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await t.test(`${viewport.width}px`, async () => {
        const page = await browser.newPage({ viewport });
        const unexpected = [], errors = [];
        await page.route('**/*', route => {
          if (new URL(route.request().url()).origin === base && route.request().method() === 'GET') return route.continue();
          unexpected.push(route.request().url()); return route.abort();
        });
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(base);
          const result = await page.evaluate(async events => {
            const { ComposedFeed } = await import('/assets/composed-feed.js');
            const { Postcards } = await import('/assets/postcard.js');
            const { fetchDayPage } = await import('/assets/history-feed.js');
            const font = await (await fetch('/assets/hershey-cursive.json')).json();
            const feed = new ComposedFeed(document.querySelector('#paper'), font);
            const cards = new Postcards(feed.contentRoot(), font, { inline: true, lane: feed.animationLane() });
            // Finish pen animation instantly; dream live/replay flags remain real.
            cards.setInstant(true); feed.following = false;
            const send = (e, live) => {
              const p = e.payload || {};
              if (e.kind === 'dream') { cards.finishAnimations(); feed.dream(p, e.ts, live); }
              if (e.kind === 'mode') {
                feed.setMode(p.to, e.ts);
                if (p.to === 'letter') { feed.finishAnimations(); cards.begin({ id: p.postcard_id, from: p.postcard_to }); }
                else if (p.from === 'letter') cards.settle();
              }
              if (e.kind === 'text') cards.write(p.s);
              if (e.kind === 'postcard_out') { cards.reply(p.body, { id: p.reply_to, to: p.to }); cards.finishAnimations(); feed.event('reply sent', '', e.ts, 'postcard-reply'); }
            };
            const reset = instant => { cards.reset(); feed.reset(); feed.setInstant(instant); feed.following = false; };
            const snapshot = () => [...feed.flow.children].map(el => ({ kind: el.dataset.kind || 'reply-card', fragments: [...el.querySelectorAll('.cy-dream-fragment')].map(f => f.dataset.eventId), times: [...el.querySelectorAll('time')].map(n => n.dataset.cyEndpointMs), reply: el.querySelector('.pcard-msg')?.textContent || '' }));
            reset(false);
            for (const e of events.filter(e => e.seq <= 2252119)) send(e, true);
            const oldDream = feed.flow.querySelector('.cy-dream-field');
            const card = feed.flow.querySelector('.pcard-obj');
            const topBefore = card.getBoundingClientRect().top - feed.flow.getBoundingClientRect().top;
            const heightBefore = oldDream.getBoundingClientRect().height;
            const textBefore = oldDream.textContent;
            for (const e of events.filter(e => e.seq > 2252119)) send(e, true);
            const live = snapshot();
            const stable = { sameCard: card === feed.flow.querySelector('.pcard-obj'), sameText: oldDream.textContent === textBefore, heightDelta: oldDream.getBoundingClientRect().height - heightBefore, topDelta: card.getBoundingClientRect().top - feed.flow.getBoundingClientRect().top - topBefore };
            reset(true); for (const e of events) send(e, false); const full = snapshot();
            const tail = await fetchDayPage({ rangeUrl: '/api/range.php', date: '2026-10-07', after: 2252008 });
            reset(true); for (const e of tail.events) send(e, false); const partial = snapshot();
            const older = await fetchDayPage({ rangeUrl: '/api/range.php', date: '2026-10-07', before: tail.events[0].seq });
            const known = new Set(tail.events.map(e => e.seq));
            const merged = older.events.filter(e => !known.has(e.seq)).concat(tail.events);
            reset(true); for (const e of merged) send(e, false); const paged = snapshot();
            // A later chunk of the same drawing must not redraw the old SVG.
            reset(true);
            const draw = seq => ({ id: 'same-drawing', dream: true, sleep_period_id: 'sleep-fixture', seq, strokes: [{ t: 'C', x: 50, y: 50, r: 10 + seq * 5 }] });
            feed.draw(draw(0), '2026-10-07 01:09:00', false);
            const oldSvg = feed.flow.querySelector('svg'); const svgBefore = oldSvg.outerHTML;
            feed.event('reply sent', '', '2026-10-07 01:12:17', 'postcard-reply');
            feed.draw(draw(1), '2026-10-07 01:17:33', false);
            feed.draw(draw(2), '2026-10-07 01:27:08', false);
            const drawing = { oldUnchanged: oldSvg.outerHTML === svgBefore, kinds: [...feed.flow.children].map(el => el.dataset.kind), paths: [...feed.flow.querySelectorAll('svg')].map(svg => svg.querySelectorAll('path').length) };
            return { live, full, partial, paged, stable, drawing, overflow: document.documentElement.scrollWidth > innerWidth };
          }, events);
          const kinds = ['dream', 'reply-card', 'postcard-reply', 'dream'];
          assert.deepEqual(result.live.map(x => x.kind), kinds);
          assert.deepEqual(result.live, result.full);
          assert.deepEqual(result.paged, result.full);
          assert.deepEqual(result.partial.map(x => x.kind), kinds.slice(1));
          assert.deepEqual(result.full.flatMap(x => x.fragments), ['before', 'after-1', 'after-2', 'after-3']);
          assert.deepEqual(result.stable, { sameCard: true, sameText: true, heightDelta: 0, topDelta: 0 });
          assert.deepEqual(result.drawing, { oldUnchanged: true, kinds: ['dream', 'postcard-reply', 'dream'], paths: [1, 2] });
          assert.equal(result.overflow, false);
          assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
