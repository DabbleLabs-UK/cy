// Opt-in real-browser checks against loopback fixtures only. No PHP, DB or provider runs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const enabled = process.env.CY_RUN_BROWSER_TESTS === '1';
const require = createRequire(import.meta.url);
const endpoint = kind => `/api/${kind === 'reply' ? 'postcard' : 'memory-formation'}-inference.php`;
const selector = kind => `#postcard-${kind}-inference`;
const caps = { concurrency: 2, requests_hour: 10, requests_day: 100, requests_month: 1000, gbp_hour: 0.1, gbp_day: 1, gbp_month: 10 };

function fixture(state, kind) {
  return {
    ok: true, can_admin: state.canAdmin, settings: state.settings[kind],
    start: '2026-10-06T00:00:00Z', end: '2026-10-07T00:00:00Z',
    status: { reason: 'deepseek_active', provider: 'deepseek', model: 'fixture-model', actual_model: 'fixture-model', configured_model: 'fixture-model' },
    totals: {
      published: 12 + state.revision, formed: 7 + state.revision, updated: 2, resolved: 1, nothing: 2,
      estimated_gbp: 0.0123, uncertain_gbp: 0.002, failures: 1, held: 2,
      validation_failures: 1, invalid: 1, application_conflicts: 1, fallbacks: 2,
      requests: 15, cloud_requests: 12, local_requests: 3,
      input_tokens: 12345, output_tokens: 678, cached_tokens: 2345, uncached_tokens: 10000, mean_latency_ms: 1250,
    },
    windows: Object.fromEntries(['hour', 'day', 'month'].map(key => [key, { estimated_gbp: 0.0123, uncertain_gbp: 0.002, requests: 3 }])),
    pending_count: kind === 'memory' ? 4 : 0, oldest_pending_age_seconds: 7800,
    pricing: { model: 'fixture-model', input_uncached_per_million: 1, input_cached_per_million: 0.1, output_per_million: 2, usd_to_gbp: 0.75 },
    buckets: [{ at: '2026-10-06T12:00:00Z', estimated_gbp: 0.0123, uncertain_gbp: 0.002, requests: 3 }],
  };
}

async function noOverflow(page) {
  const overflow = await page.locator('#postcard-inference').evaluate(root => {
    const bounds = root.getBoundingClientRect();
    return [root, ...root.querySelectorAll('*')].filter(el => {
      if (!el.checkVisibility()) return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && (box.left < bounds.left - 1 || box.right > bounds.right + 1 || el.scrollWidth > el.clientWidth + 1);
    }).map(el => `${el.tagName}.${el.className?.baseVal ?? el.className}`);
  });
  assert.deepEqual(overflow, [], 'visible panel content fits the sidebar');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}

async function refresh(page) {
  // Exercise the existing refresh listener without changing disclosure or focus.
  const responses = ['reply', 'memory'].map(kind => page.waitForResponse(response => new URL(response.url()).pathname === endpoint(kind) && response.request().method() === 'GET'));
  await page.locator('details.panel').evaluate(el => el.dispatchEvent(new Event('toggle')));
  await Promise.all(responses);
}

test('postcard inference disclosure, ranges, owner edits and stale recovery in a browser', { skip: !enabled, timeout: 90000 }, async t => {
  const { chromium } = require(process.env.CY_PLAYWRIGHT_PATH || 'playwright');
  const index = await readFile(new URL('../public/index.php', import.meta.url), 'utf8');
  const panel = index.match(/<details class="panel panel-collapsible">\s*<summary[^>]*>POSTCARD INFERENCE<\/summary>[\s\S]*?<\/details>/)?.[0];
  assert.ok(panel, 'fixture uses the real inference panel HTML');
  const files = new Map(await Promise.all([
    ['postcard-inference.js', 'text/javascript'], ['postcard-inference.css', 'text/css'], ['assets/style.css', 'text/css'],
  ].map(async ([path, type]) => [`/${path}`, { type, body: await readFile(new URL(`../public/${path}`, import.meta.url)) }])));
  let state;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const kind = ['reply', 'memory'].find(value => endpoint(value) === url.pathname);
      response.setHeader('Cache-Control', 'no-store');
      if (kind) {
        state.requests.push({ kind, method: request.method, range: url.searchParams.get('range') });
        if (request.method === 'POST') {
          let body = '';
          for await (const chunk of request) body += chunk;
          const payload = JSON.parse(body);
          state.posts.push({ kind, payload });
          state.settings[kind] = payload.settings;
        }
        response.writeHead(state.fail ? 503 : 200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(state.fail ? { ok: false } : fixture(state, kind)));
      } else if (url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/style.css"><link rel="stylesheet" href="/postcard-inference.css"><style>.fixture-sidebar{width:334px;max-width:100%;margin:16px auto}@media(max-width:420px){.fixture-sidebar{width:auto;margin:12px}}</style></head><body><main class="fixture-sidebar">${panel}</main><script type="module" src="/postcard-inference.js"></script></body></html>`);
      } else if (files.has(url.pathname)) {
        const file = files.get(url.pathname);
        response.writeHead(200, { 'Content-Type': file.type });
        response.end(file.body);
      } else {
        response.writeHead(404);
        response.end();
      }
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await t.test(`${viewport.width}px viewport`, async () => {
        state = { canAdmin: true, fail: false, revision: 0, posts: [], requests: [], settings: {
          reply: { enabled: true, route: 'AUTO', ...caps }, memory: { mode: 'DEEPSEEK', ...caps },
        } };
        const context = await browser.newContext({ viewport });
        const unexpected = [], errors = [];
        await context.route('**/*', route => {
          if (new URL(route.request().url()).origin === base) return route.continue();
          unexpected.push(route.request().url());
          return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(base);
          await page.waitForFunction(() => document.querySelectorAll('.pci-metrics dt').length === 4);
          const outer = page.locator('details.panel > summary');
          await outer.focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('details.panel').evaluate(el => el.open), true);
          if (viewport.width > 420) assert.equal(await page.locator('.fixture-sidebar').evaluate(el => el.clientWidth), 334);
          for (const kind of ['reply', 'memory']) {
            const section = page.locator(selector(kind));
            assert.equal(await section.locator('.pci-current .pci-metrics dt').count(), 2);
            assert.equal(await section.locator('.pci-details').evaluate(el => el.open), false);
            assert.equal(await section.locator('.pci-settings').evaluate(el => el.open), false);
            assert.equal(await section.locator('.pci-chart').isVisible(), false);
            assert.equal(await section.getByText('Input tokens', { exact: true }).isVisible(), false);
            assert.equal(await section.locator('.pci-attention').isVisible(), true);
            assert.match(await section.locator('.pci-attention').textContent(), /1 failed/);
            assert.match(await section.locator('.pci-attention').textContent(), /unresolved cost/);
          }
          assert.equal(await page.getByText('4 sources waiting', { exact: true }).isVisible(), true);
          await noOverflow(page);

          for (const kind of ['reply', 'memory']) {
            const section = page.locator(selector(kind));
            const summary = section.locator('.pci-details > summary');
            await summary.focus();
            await page.keyboard.press('Enter');
            assert.equal(await summary.evaluate(el => document.activeElement === el), true);
            assert.equal(await section.locator('.pci-chart').isVisible(), true);
            assert.match(await section.locator('.pci-chart').getAttribute('aria-label'), /cost/);
            assert.equal(await section.getByText('Input tokens', { exact: true }).isVisible(), true);
            assert.equal(await summary.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
          }
          await page.locator(`${selector('reply')} [data-range="1H"]`).click();
          await page.waitForFunction(() => document.querySelector('#postcard-reply-inference .pci-period').textContent === 'Last hour');
          assert.equal(await page.locator(`${selector('memory')} [data-range="24H"]`).getAttribute('aria-pressed'), 'true');
          await page.locator(`${selector('memory')} [data-range="30D"]`).click();
          await page.waitForFunction(() => document.querySelector('#postcard-memory-inference .pci-period').textContent === 'Last 30 days');
          assert.equal(await page.locator(`${selector('reply')} [data-range="1H"]`).getAttribute('aria-pressed'), 'true');
          assert.ok(state.requests.some(request => request.kind === 'reply' && request.range === '1H'));
          assert.ok(state.requests.some(request => request.kind === 'memory' && request.range === '30D'));

          for (const kind of ['reply', 'memory']) {
            const section = page.locator(selector(kind));
            await section.locator('.pci-settings > summary').click();
            await section.locator('[name="gbp_hour"]').fill('0.25');
          }
          const focused = page.locator(`${selector('reply')} [name="gbp_hour"]`);
          await focused.focus();
          state.revision++;
          await refresh(page);
          await page.waitForFunction(() => document.querySelector('#postcard-reply-inference .pci-metrics dd').textContent === '13');
          assert.equal(await focused.evaluate(el => document.activeElement === el), true);
          for (const kind of ['reply', 'memory']) assert.equal(await page.locator(`${selector(kind)} [name="gbp_hour"]`).inputValue(), '0.25');
          await noOverflow(page);

          for (const kind of ['reply', 'memory']) {
            const section = page.locator(selector(kind));
            const field = section.locator('[name="gbp_hour"]');
            await field.focus();
            await page.keyboard.press('Enter');
            await page.waitForFunction(id => document.querySelector(`${id} .pci-message`).textContent === 'Settings saved.', selector(kind));
            assert.equal(await field.evaluate(el => document.activeElement === el), true);
            assert.equal(await section.locator('.pci-settings').evaluate(el => el.open), true);
            assert.deepEqual(state.posts.find(post => post.kind === kind)?.payload, { action: 'settings', settings: {
              ...(kind === 'reply' ? { enabled: true, route: 'AUTO' } : { mode: 'DEEPSEEK' }), ...caps, gbp_hour: 0.25,
            } });
          }
          assert.equal(state.posts.length, 2, 'one mocked settings write per section');

          state.fail = true;
          await refresh(page);
          await page.waitForFunction(() => document.querySelectorAll('.pci-state[data-stale="true"]').length === 2);
          assert.match(await page.locator(`${selector('reply')} .pci-state`).textContent(), /out of date/);
          assert.equal(await page.locator(`${selector('reply')} .pci-metrics dd`).first().textContent(), '13');
          state.fail = false;
          state.revision++;
          await refresh(page);
          await page.waitForFunction(() => document.querySelector('#postcard-reply-inference .pci-metrics dd').textContent === '14');
          assert.equal(await page.locator('.pci-state[data-stale]').count(), 0);
          state.canAdmin = false;
          state.revision++;
          await refresh(page);
          await page.waitForFunction(() => document.querySelectorAll('.pci-admin form').length === 0);
          assert.equal(await page.locator('.pci-settings, .pci-form input, .pci-form select').count(), 0);
          assert.equal(await page.locator('.pci-ranges button').count(), 8, 'public history controls remain available');
          await noOverflow(page);
          assert.deepEqual(unexpected, [], 'all requests stay on the fixture server');
          assert.deepEqual(errors, [], 'no browser script errors');
        } finally {
          await context.close();
        }
      });
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
