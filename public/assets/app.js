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

let pen, brain, hud, power, tempo;
let lastSeq = 0;
let polling = false;

async function boot() {
  const font = await loadFont();

  pen = new Pen($('#paper'), font);
  brain = new BrainHud($('#brain'));
  hud = new Hud({ host: $('#host'), mail: $('#mail') });
  const powerEl = $('#power');
  if (powerEl) power = new Power(powerEl);
  const tempoEl = $('#tempo');
  if (tempoEl) tempo = new Tempo(tempoEl, TEMPO_ENDPOINT);

  wireForms();

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
  // apply only the latest vitals/host from the backlog, but render all text
  const events = data.events || [];
  for (const ev of events) dispatch(ev, true);
  pen.setInstant(false);
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
  let flat = true;
  for (const ev of events) {
    if (flat && ev.kind === 'text' && seenText >= animateFrom) {
      pen.setInstant(false);
      flat = false;
    }
    if (ev.kind === 'text') seenText++;
    dispatch(ev, false);
  }
  pen.setInstant(false);
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
      pen.write(p.s, p.mode);
      break;

    case 'draw':
      // a drawing pass: the same pen engine, fed strokes instead of glyphs. On
      // backlog fill pen.instant is set, so a drawing that finished before you
      // arrived lays down complete instead of re-animating from scratch.
      pen.draw(p);
      if (!bootstrap && p.pass && p.pass.i === 0) {
        pushTicker('picking the pen up' + (p.title ? ': ' + String(p.title).slice(0, 48) : ''));
      }
      break;

    case 'mode':
      latestMode = p.to || latestMode;
      pen.setMode(latestMode);
      setMode(latestMode, p.cause);
      break;

    case 'abort':
      // trail off the current stroke and leave the fragment as a scar
      if (!bootstrap) pen.abort();
      flashAbort(p.reason || p.cause);
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

    case 'power':
      if (power) power.push(p, ev.ts ? Date.parse(String(ev.ts).replace(' ', 'T')) : Date.now());
      break;

    case 'tempo':
      if (tempo) tempo.update(p);
      break;

    case 'day':
      if (typeof p.n === 'number') setDay(p.n);
      break;

    case 'postcard_in':
      hud.addPostcardIn(p);
      pushTicker(`postcard from ${p.from || 'someone'}${p.image ? ' (with a picture)' : ''}`);
      break;
    case 'postcard_out':
      hud.addPostcardOut(p);
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
  const el = $('#mode');
  if (!el) return;
  const label =
    mode === 'letter' ? 'WRITING A LETTER' : mode === 'warden' ? 'READING A NOTICE' : mode === 'sleep' ? 'ASLEEP' : 'JOURNAL';
  el.textContent = label + (cause && (mode === 'letter' || mode === 'warden') ? ' - ' + cause : '');
  el.dataset.mode = mode;
}

function flashAbort(reason) {
  const el = $('#paper');
  if (!el) return;
  el.classList.remove('abort-flash');
  // reflow to restart the animation
  void el.offsetWidth;
  el.classList.add('abort-flash');
  if (reason) pushTicker('thought cut off (' + reason + ')');
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
        showNote(note, 'posted. ' + back + deliverLine(data.deliver_at), false);
      }
    } catch (err) {
      showNote(note, 'network error, try again', true);
    } finally {
      setBusy(form, false);
    }
  });
}

function deliverLine(deliverAt) {
  if (!deliverAt) return 'mail is delivered at 08:00, 13:00 and 19:00 UK time.';
  // stored as a UTC "Y-m-d H:i:s" string
  const d = new Date(deliverAt.replace(' ', 'T') + 'Z');
  let when = deliverAt + ' UTC';
  if (!isNaN(d.getTime())) {
    when = d.toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return 'delivered at the next mail drop: ' + when + '.';
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
