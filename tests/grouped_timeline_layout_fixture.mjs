// Read-only loopback fixture: real chronology renderer/CSS, no API or runner.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = 'ec21652673a263c803ac70c9caf1e370cef14521';
const root = fileURLToPath(new URL('../', import.meta.url));

const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CY grouped timeline layout fixture</title><link rel="stylesheet" href="/assets/style.css">
<style>body{display:block}header{padding:16px;font:14px system-ui}header a{color:#aebbc4}
.fixture{width:min(650px,100%);margin:auto}hr{border:0;border-top:1px solid #303b44;margin:12px}</style>
</head><body><header>CY grouped timeline layout fixture<br>
<a href="/?before=1">Before</a> | <a href="/">After</a> | <a href="/?view=plain">Plain view</a></header>
<main class="fixture"><div id="flow"></div></main>
<script type="module">
import { ChronologyHierarchy } from '/assets/chronology-hierarchy.js';
import { refreshEndpointTimes } from '/assets/timeline.js';
// Freeze visible ages to reproduce the exact narrow-label pressure, not today's clock.
const now = Date.parse('2026-10-20T21:42:05Z');
Date.now = () => now;
const flow = document.querySelector('#flow');
flow.className = new URL(location.href).searchParams.get('view') === 'plain' ? 'pl-col' : 'cy-flow';
const hierarchy = new ChronologyHierarchy(flow);
function add(name, ts, text = '', extra = {}, label = text) {
  hierarchy.add({payload:{name,text,...extra},label,detail:text,ts}, () => {
    const row = document.createElement('section');row.textContent = label;flow.appendChild(row);return row;
  });
}
function search(date, clock, actor, refusal) {
  const stamp = seconds => date + ' ' + clock + ':' + String(seconds).padStart(2,'0');
  add('cell_search_initiated', stamp(0), actor + " arrived at Cy's cell to begin a search");
  add('cell_search_cy_instruction', stamp(10), actor + ' instructed Cy to stand aside');
  add('instrumental_situation', stamp(10), actor + ' gave Cy a direct instruction');
  const action = refusal ? 'action:refuse_instruction' : 'action:comply_instruction';
  add('instrumental_action', stamp(10), 'The situation resolved', {action});
  add('instrumental_outcome', stamp(15), refusal ? 'Cy refused an instruction' : 'Cy complied', {action});
  add('cell_search_search_ongoing', stamp(20), 'The search began');
  add('cell_search_property_result', stamp(30), 'The search found nothing');
  add('cell_search_search_complete', stamp(40), 'The officers completed the search');
  add('cell_search_aftermath_observed', stamp(50), 'The search ended');
  flow.appendChild(document.createElement('hr'));
}
search('2026-10-06','01:09','Mr Proctor',false);
search('2026-10-20','21:04','Mr Locke',true);
add('no_eggs','2026-10-20 22:10:53','',{},'no eggs on the tray');
add('overheard','2026-10-20 22:13:59','',{},'something half-heard down the wing');
window.advanceFixtureAges = () => refreshEndpointTimes(now + 60000);
document.documentElement.dataset.ready = 'true';
</script></body></html>`;

export function createLayoutServer() {
  const baselineCss = execFileSync('git', ['show', base + ':public/assets/style.css'], {cwd:root});
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method !== 'GET') { response.writeHead(405);response.end();return; }
      response.setHeader('Cache-Control','no-store');
      if (url.pathname === '/') {
        response.setHeader('Content-Type','text/html; charset=utf-8');
        response.end(html.replace('/assets/style.css', '/assets/style.css' + (url.searchParams.has('before') ? '?before=1' : '')));
      } else if (['/assets/style.css','/assets/chronology-hierarchy.js','/assets/timeline.js'].includes(url.pathname)) {
        response.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');
        response.end(url.pathname.endsWith('.css') && url.searchParams.has('before') ? baselineCss
          : await readFile(new URL('../public' + url.pathname, import.meta.url)));
      } else { response.writeHead(404);response.end(); }
    } catch { response.writeHead(500);response.end('fixture error'); }
  });
}

if (process.argv.includes('--serve')) {
  const server = createLayoutServer();
  server.listen(0,'127.0.0.1',()=>console.log('Fixture: http://127.0.0.1:' + server.address().port));
}
