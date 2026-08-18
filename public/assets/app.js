// app.js - the CY viewer client.
//
// Polls GET api/stream.php?since=<seq>&limit=500 every 1000ms, tracks the
// highest seq seen, and dispatches events to the pen renderer, the brain HUD
// and the telemetry/mail HUD. Also wires the public postcard composer
// (text + image: file drop, browse, or Openverse search).
//
// Endpoints come from window.CY (injected by index.php) so the same code
// runs against the fake test feed.

import { Pen } from './pen.js';
import { Postcards } from './postcard.js';
import { BrainHud } from './brain.js';
import { Hud } from './hud.js';
import { Power } from './power.js';
import { Tempo } from './tempo.js';

const CFG = window.CY || {};
const STREAM = CFG.stream || 'api/stream.php';
const POST_POSTCARD = CFG.postPostcard || 'api/post-postcard.php';
const OPENVERSE_SEARCH = CFG.openverseSearch || 'api/openverse-search.php';
const TEMPO_ENDPOINT = CFG.tempo || 'api/tempo.php';
const POLL_MS = 1000;
const LETTER_MAX = 900;
const FROM_MAX = 40;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const $ = (sel) => document.querySelector(sel);

let pen, postcards, brain, hud, power, tempo;
let lastSeq = 0;
let polling = false;
let adminCtl = null; // the pause control's state machine (wired in initAdmin)

// ---- inference LED (public, everyone) -----------------------------------
// A small dot next to the pause control that lights while the model is producing
// text. It is driven by the runner's explicit `inference` boundary events (so it
// is accurate, not guessed from text arriving), with a per-token fast path and a
// watchdog so a missed 'idle' can never leave it stuck lit. Three states:
//   gen  - bright: tokens are being produced right now
//   eval - dim/amber: the model is reading its prompt (CPU pinned, nothing appears)
//   idle - dark
const led = {
  el: null,
  phase: 'idle',
  watchdog: null,
  set(phase) {
    this.phase = phase;
    if (!this.el) return;
    this.el.classList.toggle('gen', phase === 'gen');
    this.el.classList.toggle('eval', phase === 'eval');
    this.el.title =
      phase === 'gen'
        ? 'Generating - the model is writing text right now.'
        : phase === 'eval'
          ? 'Reading the prompt - the CPU is busy but nothing has appeared yet.'
          : 'Idle - the model is not generating right now.';
  },
  // an explicit boundary from the runner
  signal(phase) {
    this.set(phase);
    clearTimeout(this.watchdog);
    // safety net if an 'idle' is ever dropped: gen refreshes on every token below;
    // eval can legitimately run several seconds on a cache reset, so give it slack.
    if (phase !== 'idle') this.watchdog = setTimeout(() => this.set('idle'), phase === 'gen' ? 4000 : 15000);
  },
  // fast path: a streamed token IS active generation, so light immediately
  activity() {
    if (this.phase !== 'gen') this.set('gen');
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.set('idle'), 4000);
  },
};

function initLed() {
  const meta = document.querySelector('.topmeta');
  if (!meta) return;
  const el = document.createElement('span');
  el.id = 'infer-led';
  el.className = 'infer-led';
  el.setAttribute('role', 'img');
  meta.insertBefore(el, meta.firstChild); // left of day / mode / pause
  led.el = el;
  led.set('idle');
}

async function boot() {
  const font = await loadFont();

  pen = new Pen($('#paper'), font);
  postcards = new Postcards($('#postcards'), font);
  brain = new BrainHud($('#brain'));
  hud = new Hud({ host: $('#host'), mail: $('#mail') });
  const powerEl = $('#power');
  if (powerEl) power = new Power(powerEl);
  const tempoEl = $('#tempo');
  if (tempoEl) tempo = new Tempo(tempoEl, TEMPO_ENDPOINT);

  wireForms();
  initLed();
  initAdmin();

  // test hook (only on the ?stream=test page): lets a headless check drive the
  // real event dispatch, e.g. to assert an abort raises no toast. Inert in prod.
  if (document.body.dataset.test === '1') {
    window.__CY_TEST__ = { pen, postcards, dispatch, ticker: () => $('#ticker') };
  }

  // first load fills the page mid-stream, drawn instantly
  await firstLoad();

  // then poll live
  setInterval(poll, POLL_MS);
}

async function loadFont() {
  const res = await fetch('assets/hershey-cursive.json', { cache: 'force-cache' });
  if (!res.ok) throw new Error('font load failed: ' + res.status);
  return res.json();
}

async function firstLoad() {
  let data;
  try {
    data = await fetchStream(-400);
  } catch (e) {
    setStatus('offline', true);
    return;
  }
  pen.setInstant(true);
  postcards.setInstant(true);
  // apply only the latest vitals/host from the backlog, but render all text
  const events = data.events || [];
  for (const ev of events) dispatch(ev, true);
  pen.setInstant(false);
  postcards.setInstant(false);
  if (typeof data.now === 'number') lastSeq = Math.max(lastSeq, data.now);
  setStatus('live', false);
}

// tokens beyond this many in one batch mean we fell behind (backgrounded tab,
// network stall) - draw the older ones instantly and only animate the tail so
// the pen catches up to live instead of lagging for minutes.
const CATCHUP_TOKENS = 50;
const ANIMATE_TAIL = 25;

async function poll() {
  if (polling) return; // never overlap
  polling = true;
  try {
    const data = await fetchStream(lastSeq);
    dispatchBatch(data.events || []);
    if (typeof data.now === 'number') lastSeq = Math.max(lastSeq, data.now);
    setStatus('live', false);
  } catch (e) {
    setStatus('reconnecting', true);
  } finally {
    polling = false;
  }
}

function dispatchBatch(events) {
  const textTotal = events.reduce((n, ev) => n + (ev.kind === 'text' ? 1 : 0), 0);
  if (textTotal <= CATCHUP_TOKENS) {
    for (const ev of events) dispatch(ev, false);
    return;
  }
  // catch-up: everything up to the last ANIMATE_TAIL text events is drawn flat
  const animateFrom = textTotal - ANIMATE_TAIL;
  let seenText = 0;
  pen.setInstant(true);
  postcards.setInstant(true);
  let flat = true;
  for (const ev of events) {
    if (flat && ev.kind === 'text' && seenText >= animateFrom) {
      pen.setInstant(false);
      postcards.setInstant(false);
      flat = false;
    }
    if (ev.kind === 'text') seenText++;
    dispatch(ev, false);
  }
  pen.setInstant(false);
  postcards.setInstant(false);
}

async function fetchStream(since) {
  const url = `${STREAM}?since=${since}&limit=500`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('stream ' + res.status);
  const data = await res.json();
  // track highest seq we actually saw as a fallback to `now`
  for (const ev of data.events || []) {
    if (typeof ev.seq === 'number' && ev.seq > lastSeq) lastSeq = ev.seq;
  }
  return data;
}

// ---- event dispatch -----------------------------------------------------

let latestMode = 'journal';

function dispatch(ev, bootstrap) {
  const p = ev.payload || {};
  switch (ev.kind) {
    case 'text':
      // A 'letter'-mode token is a REPLY: it is written live on the postcard, not
      // on the journal sheet. Everything else (journal, warden, dream murmurs -
      // p.mode 'dream' + p.lucid distinguishes a faint murmur from a lucid
      // night-waking line) is handwritten on the paper.
      if (!bootstrap) led.activity(); // a live token means the model is generating now
      if (p.mode === 'letter') {
        postcards.write(p.s);
      } else {
        pen.write(p.s, p.mode, p.lucid);
      }
      break;

    case 'draw':
      // a drawing pass: the same pen engine, fed strokes instead of glyphs. On
      // backlog fill pen.instant is set, so a drawing that finished before you
      // arrived lays down complete instead of re-animating from scratch.
      pen.draw(p);
      if (!bootstrap && p.dream) {
        // the night's slow dream drawing: mention it once, quietly, at its start
        if (p.seq === 0) pushTicker('drawing something in his sleep');
      } else if (!bootstrap && p.pass && p.pass.i === 0) {
        pushTicker('picking the pen up' + (p.title ? ': ' + String(p.title).slice(0, 48) : ''));
      }
      break;

    case 'mode': {
      const to = p.to || latestMode;
      latestMode = to;
      setMode(to, p.cause); // header pill
      if (to === 'letter') {
        // a reply is starting: build the postcard and write on IT, not the sheet.
        // The journal pen is deliberately NOT switched to letter mode, so the
        // paper keeps its place and the journal resumes on it once the card settles.
        postcards.begin();
      } else {
        if (p.from === 'letter') postcards.settle(); // reply done: card settles into place
        pen.setMode(to); // journal / dream / warden still drive the paper sheet
      }
      break;
    }

    case 'abort':
      // Trail off the current stroke and leave the fragment as a scar. No toast,
      // no flash: an abort is visible only as the ink trailing off and the
      // fragment staying on the page - announcing the mechanism breaks the
      // fiction. During a reply the interrupt cuts the CARD's stroke; otherwise
      // it cuts the journal thought on the sheet.
      if (!bootstrap) {
        if (latestMode === 'letter') postcards.abort();
        else pen.abort();
      }
      break;

    case 'silence': {
      // he stopped writing: leave a real blank gap on the page, no ink. For a
      // longer silence, resume on a fresh line stamped with the time.
      const secs = Number(p.seconds) || 0;
      let marker = '';
      if (secs >= 90 && ev.ts) {
        const m = String(ev.ts).match(/(\d{2}):(\d{2})/);
        if (m) marker = m[1] + ':' + m[2];
      }
      pen.silence(secs, marker);
      if (!bootstrap && secs >= 60) pushTicker(p.reason === 'under' ? 'asleep, gone still' : 'gone quiet');
      break;
    }

    case 'vitals':
      pen.setVitals(p);
      brain.setBrain(p.brain);
      brain.setHeart(p.hr);
      brain.setMental(p.mental);
      brain.setDerived(p.derived);
      brain.setAmp(p.monotony, p.amp);
      brain.setCast(p.relations);
      if (p.mode) {
        latestMode = p.mode;
        setMode(p.mode);
      }
      if (typeof p.day === 'number') setDay(p.day);
      break;

    case 'host':
      hud.setHost(p);
      break;

    case 'gen':
      hud.setGen(p);
      break;

    case 'power':
      if (power) power.push(p, ev.ts ? Date.parse(String(ev.ts).replace(' ', 'T')) : Date.now());
      break;

    case 'tempo':
      if (tempo) tempo.update(p);
      break;

    case 'inference':
      // live generation indicator (public). Explicit boundary from the runner:
      // eval (reading, nothing appears yet) / gen (writing) / idle. Live only - a
      // backlog replay must not flash a stale phase; the LED starts idle and the
      // continuous live stream lights it within a poll.
      if (!bootstrap) led.signal(p.phase || 'idle');
      break;

    case 'day':
      if (typeof p.n === 'number') setDay(p.n);
      break;

    case 'postcard_in':
      hud.addPostcardIn(p);
      // remember the sender + any picture so the reply card is addressed back to
      // them (and can pin their photo) when the reply begins.
      postcards.incoming(p);
      pushTicker(`postcard from ${p.from || 'someone'}${p.image ? ' (with a picture)' : ''}`);
      break;
    case 'postcard_out':
      hud.addPostcardOut(p);
      // the authoritative full reply text, for the mailbag and as the backlog
      // backfill if this card's per-token stream scrolled out of the window.
      postcards.reply(p.body);
      break;
    case 'news_in':
      hud.addNewsIn(p);
      pushTicker(`news: ${p.headline || ''}`);
      break;

    // the runner also emits a generic `event` for ambient prison happenings
    case 'event':
      handleAmbient(p);
      break;
  }
}

function handleAmbient(p) {
  const name = p.name || '';
  if (name === 'social') {
    const who = p.who || 'someone';
    const g = p.standing && typeof p.standing.grudge === 'number' ? p.standing.grudge : 0;
    pushTicker(g > 0.7 ? `bad blood with ${who}` : `${who} on the spur`);
    return;
  }
  if (name === 'officer') {
    const who = p.who || 'an officer';
    const g = p.standing && typeof p.standing.grudge === 'number' ? p.standing.grudge : 0;
    pushTicker(g > 0.7 ? `bad blood with ${who}` : `${who} on the wing`);
    return;
  }
  if (name === 'overheard') {
    pushTicker(p.misheard ? 'something half-heard, and it is about him' : 'something half-heard down the wing');
    return;
  }
  const nice = {
    letter_arrives: p.from ? `mail from ${p.from}` : 'mail arrives',
    letter_hostile: 'hostile mail',
    image_arrives: p.caption ? `image: ${p.caption}` : 'an image arrives',
    news_arrives: p.headline ? `news: ${p.headline}` : 'news arrives',
    warden: 'a notice from Warden Florian',
    meal: 'meal',
    lights_out: 'lights out',
    lights_on: 'lights on',
    noise_night: 'noise in the night',
    injury: 'injury',
    cell_search: 'cell search',
    no_mail_24h: 'no mail in 24h',
    no_eggs: 'no eggs on the tray',
    cold_tea: 'the tea came cold',
    delayed_unlock: 'unlock came late',
    assoc_cancelled: 'association cancelled',
    lockdown: 'the wing on lockdown',
  };
  if (nice[name]) pushTicker(nice[name]);
}

// ---- header / status widgets -------------------------------------------

function setStatus(text, bad) {
  const el = $('#status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('bad', !!bad);
}

function setDay(n) {
  const el = $('#day');
  if (el) el.textContent = 'DAY ' + n;
}

function setMode(mode, cause) {
  // paused is the runner's REAL state off the live stream. Make it unmistakable
  // across the whole page (not just the pill), and feed it to the pause control so
  // the button settles to confirmed reality rather than an optimistic guess.
  document.body.classList.toggle('cy-paused', mode === 'paused');
  if (adminCtl) adminCtl.syncMode(mode);
  const el = $('#mode');
  if (!el) return;
  const label =
    mode === 'paused'
      ? 'PAUSED'
      : mode === 'letter'
        ? 'WRITING A LETTER'
        : mode === 'warden'
          ? 'READING A NOTICE'
          : mode === 'sleep' || mode === 'dream'
            ? 'ASLEEP'
            : 'JOURNAL';
  el.textContent = label + (cause && (mode === 'letter' || mode === 'warden') ? ' - ' + cause : '');
  el.dataset.mode = mode;
}

let tickerTimer = null;
function pushTicker(msg) {
  const el = $('#ticker');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(tickerTimer);
  tickerTimer = setTimeout(() => el.classList.remove('show'), 6000);
}

// ---- admin pause/resume (operator control, ?111 only) -------------------
//
// The control shows STATE, not a command: the label reads exactly 'ACTIVE' or
// 'PAUSED', reflecting the RUNNER'S REAL state off the live stream (the mode goes
// 'paused' only once the runner has actually stopped). The tooltip describes what a
// tap will DO ('pause generation' / 'resume generation').
//
// A tap does not optimistically flip the label. It:
//   1. gives immediate feedback - a disabled, pulsing PENDING look - so it never
//      feels dead, while POSTing the command to admin.php;
//   2. surfaces a POST failure at once (the command never reached/persisted);
//   3. otherwise WAITS for the runner to acknowledge via the stream, then settles
//      the label to the confirmed state;
//   4. if no acknowledgement arrives within a few seconds, shows FAILED so the
//      operator knows the runner did not act (and can tap again to retry).
// No-op for an ordinary visitor (CFG.admin is null): the button is not rendered.
function initAdmin() {
  const url = CFG.admin;
  const btn = $('#admin-pause');
  if (!url || !btn) return;

  let confirmed = null; // the runner's REAL paused state (from the stream). null = unknown
  let pending = null; // { target:boolean } while awaiting the runner's acknowledgement
  let failed = false; // last command did not reach/land - surfaced until the next tap
  let failTimer = null;
  const ACK_TIMEOUT_MS = 15000; // safety margin; the runner now cuts the burst and acks within a poll, so this should almost never be hit

  const render = () => {
    const isPaused = confirmed === true;
    btn.textContent = isPaused ? 'PAUSED' : 'ACTIVE'; // STATE, nothing else
    btn.classList.toggle('paused', isPaused);
    btn.classList.toggle('pending', !!pending);
    btn.classList.toggle('failed', failed);
    btn.disabled = !!pending;
    if (pending) {
      btn.title = pending.target ? 'Pausing... waiting for the runner to stop.' : 'Resuming... waiting for the runner to start.';
    } else if (failed) {
      btn.title = 'The runner did not acknowledge - it may not have acted. Tap to try again.';
    } else {
      btn.title = isPaused ? 'resume generation' : 'pause generation';
    }
  };

  const clearFail = () => {
    if (failTimer) clearTimeout(failTimer);
    failTimer = null;
  };

  // the runner's real mode arriving on the stream - the only thing that settles a
  // pending toggle. Matching target -> confirmed; a change we did not ask for still
  // keeps the label honest.
  const syncMode = (mode) => {
    if (mode == null) return;
    const nowPaused = mode === 'paused';
    confirmed = nowPaused;
    if (pending && pending.target === nowPaused) {
      pending = null;
      failed = false;
      clearFail();
    }
    render();
  };

  // seed the label from the server's current flag so it is not blank before the
  // first stream frame; the stream then keeps it honest (this is a hint only).
  fetch(url, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d && typeof d.paused !== 'undefined' && confirmed === null) {
        confirmed = !!d.paused;
        render();
      }
    })
    .catch(() => {});

  btn.addEventListener('click', async () => {
    if (pending) return; // already awaiting an acknowledgement
    const target = !(confirmed === true); // paused -> resume, active/unknown -> pause
    pending = { target };
    failed = false;
    render();
    clearFail();
    failTimer = setTimeout(() => {
      if (pending) {
        pending = null;
        failed = true; // the runner never acknowledged within the window
        render();
      }
    }, ACK_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: target ? 'pause' : 'resume' }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || (d && d.ok === false)) {
        throw new Error((d && d.error) || 'HTTP ' + res.status);
      }
      // command accepted + persisted. Do NOT flip the label here - wait for the
      // runner's real acknowledgement via syncMode (or the fail timer).
    } catch (err) {
      // the POST itself failed: the command did not land, so surface it now rather
      // than waiting out the timeout.
      pending = null;
      failed = true;
      clearFail();
      render();
    }
  });

  adminCtl = { syncMode };
  render();
}

// ---- forms --------------------------------------------------------------

// The postcard composer: one card, a message side and a picture side. A picture
// can come from a dropped/browsed file OR a chosen Openverse result - never both
// at once. At least one of {text, picture} must be present on submit.
function wireForms() {
  const form = $('#postcard-form');
  const from = $('#pc-from');
  const body = $('#pc-body');
  const count = $('#pc-count');
  const note = $('#pc-note');

  const drop = $('#pc-drop');
  const fileInput = $('#pc-file');
  const browse = $('#pc-browse');
  const emptyEl = $('#pc-pic-empty');
  const previewEl = $('#pc-pic-preview');
  const previewImg = $('#pc-pic-img');
  const previewSrc = $('#pc-pic-src');
  const clearBtn = $('#pc-pic-clear');

  const ovQ = $('#pc-ov-q');
  const ovGo = $('#pc-ov-go');
  const ovGrid = $('#pc-ov-grid');
  const ovStatus = $('#pc-ov-status');

  // chosen picture: exactly one of these is non-null at a time
  let chosenFile = null;
  let chosenOpenverse = null; // { url, attrib, thumb }

  const updateCount = () => {
    const n = body.value.length;
    count.textContent = n + ' / ' + LETTER_MAX;
    count.classList.toggle('over', n > LETTER_MAX);
  };
  body.addEventListener('input', updateCount);
  updateCount();

  function showPreview(src, label) {
    previewImg.src = src;
    previewSrc.textContent = label || '';
    emptyEl.hidden = true;
    previewEl.hidden = false;
  }
  function clearPicture() {
    chosenFile = null;
    chosenOpenverse = null;
    fileInput.value = '';
    previewImg.removeAttribute('src');
    previewSrc.textContent = '';
    previewEl.hidden = true;
    emptyEl.hidden = false;
    ovGrid.querySelectorAll('.pc-ov-item.sel').forEach((n) => n.classList.remove('sel'));
  }
  clearBtn.addEventListener('click', clearPicture);

  function chooseFile(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      return showNote(note, 'pictures must be JPG, PNG or WEBP', true);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return showNote(note, 'picture too large (max 3MB)', true);
    }
    chosenFile = file;
    chosenOpenverse = null;
    ovGrid.querySelectorAll('.pc-ov-item.sel').forEach((n) => n.classList.remove('sel'));
    showPreview(URL.createObjectURL(file), file.name);
    note.className = 'form-note';
  }

  browse.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => chooseFile(fileInput.files && fileInput.files[0]));

  // drag + drop onto the picture side
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('dragover');
    }),
  );
  ['dragleave', 'dragend', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('dragover');
    }),
  );
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) chooseFile(f);
  });

  // openverse search
  async function runSearch() {
    const q = ovQ.value.trim();
    if (!q) return;
    ovStatus.textContent = 'searching...';
    ovGrid.innerHTML = '';
    ovGo.disabled = true;
    try {
      const res = await fetch(OPENVERSE_SEARCH + '?q=' + encodeURIComponent(q), { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      const results = (data && data.results) || [];
      if (!res.ok) {
        ovStatus.textContent = (data && data.error) || 'search failed';
        return;
      }
      if (!results.length) {
        ovStatus.textContent = 'nothing found - try other words';
        return;
      }
      ovStatus.textContent = results.length + ' results (Creative Commons)';
      for (const r of results) renderOvResult(r);
    } catch (err) {
      ovStatus.textContent = 'network error, try again';
    } finally {
      ovGo.disabled = false;
    }
  }
  function renderOvResult(r) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pc-ov-item';
    btn.title = r.attrib || r.title || '';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = r.thumb || r.url;
    img.alt = r.title || 'image';
    btn.appendChild(img);
    btn.addEventListener('click', () => {
      ovGrid.querySelectorAll('.pc-ov-item.sel').forEach((n) => n.classList.remove('sel'));
      btn.classList.add('sel');
      chosenOpenverse = { url: r.url, attrib: r.attrib || '', thumb: r.thumb || r.url };
      chosenFile = null;
      fileInput.value = '';
      showPreview(r.thumb || r.url, r.attrib || r.title || 'Openverse');
      note.className = 'form-note';
    });
    ovGrid.appendChild(btn);
  }
  ovGo.addEventListener('click', runSearch);
  ovQ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    note.className = 'form-note';
    const f = from.value.trim();
    const b = body.value.trim();
    if (f.length < 1 || f.length > FROM_MAX) {
      return showNote(note, `name must be 1-${FROM_MAX} characters`, true);
    }
    if (b.length > LETTER_MAX) return showNote(note, `message too long (max ${LETTER_MAX})`, true);
    const hasPicture = !!(chosenFile || chosenOpenverse);
    if (b.length < 1 && !hasPicture) {
      return showNote(note, 'write something or add a picture first', true);
    }

    const fd = new FormData();
    fd.append('from', f);
    if (b.length) fd.append('body', b);
    if (chosenFile) {
      fd.append('image', chosenFile);
    } else if (chosenOpenverse) {
      fd.append('openverse_url', chosenOpenverse.url);
      if (chosenOpenverse.attrib) fd.append('openverse_attrib', chosenOpenverse.attrib);
    }

    setBusy(form, true);
    try {
      const res = await fetch(POST_POSTCARD, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        showNote(note, data.error || 'could not send (' + res.status + ')', true);
      } else {
        body.value = '';
        updateCount();
        clearPicture();
        const back = data.returning ? 'he knows you. ' : '';
        showNote(note, 'posted. ' + back + 'he gets it straight away.', false);
      }
    } catch (err) {
      showNote(note, 'network error, try again', true);
    } finally {
      setBusy(form, false);
    }
  });
}

function showNote(el, msg, bad) {
  el.textContent = msg;
  el.className = 'form-note show ' + (bad ? 'bad' : 'good');
}
function setBusy(form, busy) {
  form.classList.toggle('busy', busy);
  const btn = form.querySelector('button[type=submit]');
  if (btn) btn.disabled = busy;
}

boot().catch((err) => {
  console.error('[captive] boot failed', err);
  setStatus('error', true);
});
