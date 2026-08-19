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
// Registers the <async-select> custom element used by the view switch and the
// operator pause control below. Side-effect import (it self-defines the element).
import '../components/async-select/async-select.js';

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
// DAY N pill: seeded from the server's real count (see lib/tempo.php,
// window.CY.day) so it is right from first paint, then advanced by exactly 1 on
// each live day-rollover event. The runner's own reported day NUMBER is never
// trusted for this - only the fact that a rollover happened, so a stale/drifted
// counter on the runner side can never desync the pill from the true count.
let dayCount = typeof CFG.day === 'number' ? CFG.day : 1;
// HISTORY MODE: while true the live poll is suspended (we are reading the past,
// not following him now). Returning to live kicks an immediate catch-up poll.
let historyMode = false;

// ---- inference LED (public, everyone) -----------------------------------
// A small dot next to the pause control that lights while the model is producing
// text. It is driven by the runner's explicit `inference` boundary events (so it
// is accurate, not guessed from text arriving), with a per-token fast path and a
// watchdog so a missed 'idle' can never leave it stuck lit. Three states:
//   gen  - bright: tokens are being produced right now
//   eval - dim/amber: the model is reading its prompt (CPU pinned, nothing appears)
//   idle - dark
// Watchdogs are a SAFETY NET only, for the rare dropped 'idle' - the runner
// reliably kicks an 'idle' at the end of every generation. They must not expire
// mid-phase. On this hardware prompt-eval alone runs ~55s (and legitimately longer
// after a cache reset), so the eval fallback has to sit well above that: the old
// 15s value blanked the LED ~40s into every eval while the CPU was still pinned,
// which is a large part of why the dot looked uncorrelated with the machine. It
// stays below the runner's own 4-min hang watchdog so a truly wedged model still
// clears. Gen is refreshed by every streamed token, so a short fallback is fine.
const LED_EVAL_WATCHDOG_MS = 90000;
const LED_GEN_WATCHDOG_MS = 4000;

const led = {
  el: null,
  phase: 'idle',
  watchdog: null,
  lastSeq: -1, // highest inference-event seq applied; guards against stale/replayed phases
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
    if (phase !== 'idle') {
      this.watchdog = setTimeout(
        () => this.set('idle'),
        phase === 'gen' ? LED_GEN_WATCHDOG_MS : LED_EVAL_WATCHDOG_MS,
      );
    }
  },
  // fast path: a streamed LIVE token IS active generation, so light immediately
  activity() {
    if (this.phase !== 'gen') this.set('gen');
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.set('idle'), LED_GEN_WATCHDOG_MS);
  },
};

// Drive the LED from the single FRESHEST inference event in a live batch, never by
// replaying each historical transition. Called once per live poll (never for the
// backlog fill or the instant catch-up replay), so after any batch - even a
// catch-up flood after a backgrounded tab - the LED lands on the true CURRENT
// phase instead of flashing through a whole past burst and sticking on a stale
// value. Events arrive ordered by seq, so the last inference event is the newest;
// the seq guard rejects anything we have already shown or that arrives out of order.
function driveLedFromBatch(events) {
  let latest = null;
  for (const ev of events) if (ev.kind === 'inference') latest = ev;
  if (!latest) return;
  const seq = typeof latest.seq === 'number' ? latest.seq : null;
  if (seq != null && seq <= led.lastSeq) return;
  if (seq != null) led.lastSeq = seq;
  led.signal((latest.payload || {}).phase || 'idle');
}

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

  // PLAIN reading view (loaded only behind ?view=plain): hand it the font for its
  // inline drawings. It registers window.__cyPlain during its own module eval, which
  // runs before this awaited font resolves, so it is present by now.
  if (window.__cyPlain) window.__cyPlain.setFont(font);

  pen = new Pen($('#paper'), font);
  postcards = new Postcards($('#postcards'), font);
  brain = new BrainHud($('#brain'));
  hud = new Hud({ host: $('#host'), mail: $('#mail') });
  const powerEl = $('#power');
  if (powerEl) power = new Power(powerEl);
  const tempoEl = $('#tempo');
  if (tempoEl) tempo = new Tempo(tempoEl, TEMPO_ENDPOINT);

  wireForms();
  initViewSwitch();
  initHistoryControl();
  initGearMenu();        // admin only: pause + model provider
  initLed(); // last, so the LED lands leftmost (before the selects)

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
  const res = await fetch(CFG.hershey || 'assets/hershey-cursive.json', { cache: 'force-cache' });
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
  // The LED stays idle through the backlog fill; only inference events newer than
  // the load point may ever drive it, so replayed history can never light it.
  led.lastSeq = lastSeq;
  setStatus('Live', false);
}

// tokens beyond this many in one batch mean we fell behind (backgrounded tab,
// network stall) - draw the older ones instantly and only animate the tail so
// the pen catches up to live instead of lagging for minutes.
const CATCHUP_TOKENS = 50;
const ANIMATE_TAIL = 25;

async function poll() {
  if (polling) return; // never overlap
  if (historyMode) return; // reading the past: do not follow the live edge
  polling = true;
  try {
    const data = await fetchStream(lastSeq);
    const events = data.events || [];
    dispatchBatch(events);
    // Drive the public LED from the freshest inference phase in THIS live batch
    // (after rendering, so it wins over any token fast-path in the same batch).
    driveLedFromBatch(events);
    if (typeof data.now === 'number') lastSeq = Math.max(lastSeq, data.now);
    setStatus('Live', false);
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
    // The flat (caught-up) portion is HISTORICAL: it must not drive the live LED
    // via the token fast-path. Only the animated tail counts as live.
    dispatch(ev, false, !flat);
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
// Mirrors the plain view's block boundaries for the handwritten sheet: a journal/
// dream entry is "open" while its burst streams, and CLOSES on the same signals
// plain uses (a mode change, a burst end, a silence, a drawing, an abort). The next
// journal/dream token then opens a fresh, dated entry on the paper. Same event
// stream, no second data path - just the boundary the pen was never told about.
let penEntryOpen = false;

// HH:MM out of an event timestamp, for the entry lead-in (mirrors plain's clockOf).
function clockOf(ts) {
  if (!ts) return '';
  const m = String(ts).match(/(\d{2}):(\d{2})/);
  return m ? m[1] + ':' + m[2] : '';
}

function dispatch(ev, bootstrap, live = !bootstrap) {
  // PLAIN reading view (behind ?view=plain): forward the same event stream, backlog
  // included, so it can render its own clean blocks. No-op unless plain.js loaded.
  if (window.__cyPlain) window.__cyPlain.handle(ev, bootstrap);

  const p = ev.payload || {};
  switch (ev.kind) {
    case 'text':
      // A 'letter'-mode token is a REPLY: it is written live on the postcard, not
      // on the journal sheet. Everything else (journal, warden, dream murmurs -
      // p.mode 'dream' + p.lucid distinguishes a faint murmur from a lucid
      // night-waking line) is handwritten on the paper.
      if (live) led.activity(); // a genuinely live token means the model is generating now
      if (p.mode === 'letter') {
        postcards.write(p.s);
      } else {
        // first token of a new entry: open it on a fresh, dated line (the break +
        // timestamp the plain view shows, in the language of the notebook).
        if (!penEntryOpen) {
          pen.beginEntry(clockOf(ev.ts), p.mode);
          penEntryOpen = true;
        }
        pen.write(p.s, p.mode, p.lucid, p.shout);
      }
      break;

    case 'draw':
      // a drawing pass: the same pen engine, fed strokes instead of glyphs. On
      // backlog fill pen.instant is set, so a drawing that finished before you
      // arrived lays down complete instead of re-animating from scratch.
      penEntryOpen = false; // a drawing is its own thing; text after it is a new entry
      pen.draw(p);
      if (!bootstrap && p.dream) {
        // the night's slow dream drawing: mention it once, quietly, at its start
        if (p.seq === 0) pushTicker('drawing something in his sleep');
      } else if (!bootstrap && p.pass && p.pass.i === 0) {
        pushTicker('picking the pen up' + (p.title ? ': ' + String(p.title).slice(0, 48) : ''));
      }
      break;

    case 'mode': {
      penEntryOpen = false; // any mode flip ends the open entry (a card interrupts here)
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
        else { pen.abort(); penEntryOpen = false; } // the cut-off thought ends the entry
      }
      break;

    case 'silence': {
      // he stopped writing: leave a real blank gap on the page, marked by a small
      // hand scratch scaled to how long the stillness lasted. The next token opens a
      // fresh dated entry, so the resumed line is stamped with its own time.
      penEntryOpen = false;
      const secs = Number(p.seconds) || 0;
      pen.silence(secs);
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
      // the active model provider rides this frequent tick: settle a pending model
      // switch and keep the compact indicator honest (see initGearMenu).
      if (p.provider) syncProviderState(p.provider);
      // the owner regime override rides the same tick: settle a pending force-day/
      // night once the runner confirms it has picked it up off its tempo poll.
      if (p.regime) syncRegimeState(p.regime);
      break;

    case 'capability':
      // the runner reports whether it holds a DeepSeek key; drives the menu's
      // DeepSeek availability so it is shown (with a reason) rather than hidden.
      syncCapability((ev.payload || {}).deepseek);
      break;

    case 'host':
      hud.setHost(p);
      break;

    case 'gen':
      // a generation burst finished: close the open journal entry so the next burst
      // opens its own, dated (a letter burst is closed by the mode flip, not here).
      if (p.mode !== 'letter') penEntryOpen = false;
      hud.setGen(p);
      break;

    case 'power':
      if (power) power.push(p, ev.ts ? Date.parse(String(ev.ts).replace(' ', 'T')) : Date.now());
      break;

    case 'tempo':
      if (tempo) tempo.update(p);
      break;

    case 'inference':
      // The LED is deliberately NOT driven here, per event. Replaying each
      // historical transition (the backlog fill, or a catch-up batch after a
      // backgrounded tab) would flash it through a whole past burst in
      // milliseconds and leave it on a stale phase - the "looks random" bug.
      // Instead poll() drives the LED once per batch from the single FRESHEST
      // inference event (driveLedFromBatch), so it always lands on the true
      // current phase and never on replayed history.
      break;

    case 'day':
      // A real local-midnight rollover happened - advance by exactly one from our
      // own known-correct count rather than trusting the runner's reported number.
      if (!bootstrap) setDay(++dayCount);
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
  if (name === 'provider') {
    // the runner switched provider mid-loop: settle any pending switch at once
    // (the frequent vitals tick would also settle it, this is just faster).
    syncProviderState(p.to);
    pushTicker('model switched to ' + (p.to === 'deepseek' ? 'DeepSeek' : 'Ollama'));
    return;
  }
  if (name === 'regime') {
    // the runner picked up the regime override mid-loop: settle any pending
    // select at once (the frequent vitals tick is the backstop if this is missed).
    syncRegimeState(p.to);
    pushTicker('regime forced to ' + (p.to === 'day' ? 'Day' : p.to === 'night' ? 'Night' : 'Auto'));
    return;
  }
  if (name === 'provider_refused') {
    // the runner refused a DeepSeek switch (no key). Reflect unavailability and
    // fail any in-flight request so the control shows a retryable failure.
    providerCtl.available = false;
    if (providerCtl.phase === 'pending') failCtl(providerCtl, 'DeepSeek unavailable - no API key on the runner');
    renderGearIfPresent();
    return;
  }
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
  if (historyMode) return; // in history the live pill shows the viewed moment, not the connection
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
  syncRunnerState(mode);
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

// ---- view switch: handwritten / plain / raw (LOCAL, instant) ------------
//
// A single <async-select> in LOCAL mode. Switching view is a client-only concern -
// no server round trip - so every option is `local`: it applies instantly with no
// pending state (the deliberate counterpart to the genuinely-async pause control
// below; the SAME component serves both kinds). handwritten and plain are for
// everyone; raw is admin-only, so the raw option is simply ABSENT (not disabled)
// when CFG.raw is false. The choice is remembered for the session so a reload keeps
// it; ?view= (CFG.viewOverride) can force the starting view.
const VIEW_KEY = 'cy-view';
let viewSelect = null;

function initViewSwitch() {
  const meta = document.querySelector('.topmeta');
  if (!meta) return;
  const admin = CFG.raw === true;

  const options = [
    { value: 'handwritten', label: 'Handwritten', description: 'pen on paper', local: true },
    { value: 'plain', label: 'Plain', description: 'clean reading view', local: true },
  ];
  if (admin) options.push({ value: 'raw', label: 'Raw', description: 'terminal log', local: true });

  const sel = document.createElement('async-select');
  sel.className = 'cy-select cy-view-select';
  sel.setAttribute('label', 'View');
  meta.insertBefore(sel, $('#day') || null); // left of the day/mode/status pills
  sel.options = options;

  // initial view: ?view override > remembered session choice > default handwritten
  let initial = 'handwritten';
  const stored = sessionStorage.getItem(VIEW_KEY);
  if (stored && options.some((o) => o.value === stored)) initial = stored;
  if (CFG.viewOverride && options.some((o) => o.value === CFG.viewOverride)) initial = CFG.viewOverride;

  sel.value = initial; // seed the confirmed value (an external set, no 'confirmed')
  viewSelect = sel;
  applyView(initial); // actually reveal it

  // a LOCAL option confirms instantly and emits 'confirmed' with local:true
  sel.addEventListener('confirmed', (e) => applyView(e.detail.value));
}

function applyView(view) {
  sessionStorage.setItem(VIEW_KEY, view);
  const isHand = view === 'handwritten';
  const isPlain = view === 'plain';
  const isRaw = view === 'raw';

  const paper = $('#paper');
  const postcards = $('#postcards');
  const plainEl = $('#plain');
  const rawEl = $('#raw');
  if (paper) paper.hidden = !isHand;
  if (postcards) postcards.hidden = !isHand; // reply cards belong to the handwritten sheet
  if (plainEl) plainEl.hidden = !isPlain;
  if (rawEl) rawEl.hidden = !isRaw;

  document.body.classList.toggle('raw-active', isRaw);
  document.body.classList.toggle('plain-active', isPlain);

  // RAW runs its own faster poll only while shown (admin only; __cyRaw is absent
  // otherwise). PLAIN is fed continuously by dispatch(), so it is already populated -
  // it just needs pinning to the live edge when revealed (its scroll offsets are
  // meaningless while it is display:none).
  if (window.__cyRaw) isRaw ? window.__cyRaw.start() : window.__cyRaw.stop();
  if (isPlain && window.__cyPlain && window.__cyPlain.reveal) window.__cyPlain.reveal();
}

// ---- LIVE vs HISTORY: the live pill IS the control ----------------------
//
// The green connection pill doubles as the time-travel control - a select box was
// the wrong affordance for live-versus-history; a status indicator you can act on
// is the right one. Live: the pill shows the connection status and, when clicked,
// opens the calendar dialog (timetravel.js) to choose a moment. Reading the past:
// it turns amber, shows the moment being viewed, and clicking it (or its x) returns
// to live. One element does status, entry and exit. History is public: anyone can
// read back. The dialog resolves a chosen moment to a seq + timestamp and announces
// it via `cy:moment`; we consume that here to enter history, and stage 3 consumes
// the same event / `window.__cyMoment` to replay it.
let viewingMoment = null;

function initHistoryControl() {
  const pill = $('#status');
  if (!pill) return;
  pill.classList.add('is-live-control');
  pill.setAttribute('role', 'button');
  pill.setAttribute('tabindex', '0');
  pill.setAttribute('aria-haspopup', 'dialog');
  pill.title = 'Travel back - pick a moment';
  pill.setAttribute('aria-label', 'Watching live. Activate to travel back.');

  const activate = () => {
    if (historyMode) { exitToLive(); return; }
    pill.focus(); // so the dialog returns focus here on close
    if (window.__cyTimeTravel) window.__cyTimeTravel.open();
  };
  pill.addEventListener('click', activate);
  pill.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      activate();
    }
  });

  // The calendar dialog's committed moment: enter history and light the pill.
  // window.__cyMoment is the clean handoff object stage 3 replays from.
  document.addEventListener('cy:moment', (e) => {
    window.__cyMoment = e.detail;
    enterHistory(e.detail);
    const s = e.detail.summary || {};
    const when = s.when || e.detail.ts || '';
    const what = (s.lines && s.lines.length) ? s.lines.join(', ') : '';
    pushTicker(`history: ${when}${what ? ' - ' + what : ''}`);
  });
}

function enterHistory(detail) {
  historyMode = true;
  viewingMoment = detail;
  document.body.classList.add('cy-history');
  showHistoryPill(detail);
}

function exitToLive() {
  historyMode = false;
  viewingMoment = null;
  document.body.classList.remove('cy-history');
  const pill = $('#status');
  if (pill) {
    pill.classList.remove('is-history', 'bad');
    pill.textContent = 'Live';
    pill.title = 'Travel back - pick a moment';
    pill.setAttribute('aria-label', 'Watching live. Activate to travel back.');
  }
  if (window.__cyTimeTravel) window.__cyTimeTravel.close();
  poll(); // resume following: the catch-up path replays everything missed at once
}

function showHistoryPill(detail) {
  const pill = $('#status');
  if (!pill) return;
  const s = detail.summary || {};
  const when = s.when || detail.ts || 'a past moment';
  pill.classList.remove('bad');
  pill.classList.add('is-history');
  // Non-button x (the pill itself is the button; nested buttons are invalid). The
  // whole pill returns to live; the x is the visible affordance for it.
  pill.innerHTML = '<span class="live-when"></span><span class="live-exit" aria-hidden="true">&times;</span>';
  pill.querySelector('.live-when').textContent = when;
  pill.title = 'Return to live';
  pill.setAttribute('aria-label', `Viewing ${when}. Activate to return to live.`);
}

// ---- operator gear menu (ASYNC) -----------------------------------------
//
// A small gear that opens a menu. The gear itself renders for EVERYONE, but its
// contents are gated:
//   - REGIME (Auto / Force Day / Force Night) is PUBLIC - the only group an
//     ordinary visitor sees;
//   - the RUNNER pair (Active / Paused) and the MODEL submenu (Ollama / DeepSeek)
//     are OWNER-ONLY and are not even built for a non-admin (CFG.admin is null).
// In every group the CURRENT state is greyed and inert and only the OTHER item is
// clickable - the action you can take.
//
// Every set is genuinely ASYNCHRONOUS: the click POSTs but the item only SETTLES
// when the runner's REAL state confirms OUT OF BAND on the event stream (pause via
// setMode's `mode`; provider + regime via the frequent `vitals` fields and their
// events). Until then the item shows a pending spinner; a POST failure or a
// confirmation that never arrives (own timeout) drops it into a retryable FAILED
// state. The UI never claims a change happened before the runner confirms it.
//
// REGIME is special in two ways for the public. An owner set is sticky; a PUBLIC set
// is a short LEASE (api/regime.php) that self-releases after 5 min or the moment the
// setter stops watching. When a lease is active the remaining time shows as a compact
// countdown; when it lapses the runner echoes 'auto' on the stream and the select
// settles back to Auto via the same external-change path. And when the OWNER is
// forcing the regime, the public control is shown LOCKED rather than failing silently.
// The endpoints enforce all of this server-side regardless of the UI.
const CONFIRM_TIMEOUT_MS = 15000; // safety net past which "never acknowledged" -> retryable FAILED

// Independent little state machines. confirmed = the runner's real value;
// target = what we asked for while pending; phase = idle | pending | failed.
const runnerCtl = { confirmed: null, target: null, phase: 'idle', error: '', timer: null };
const providerCtl = { confirmed: null, target: null, phase: 'idle', error: '', timer: null, available: false };
// Regime (auto | day | night) - same machine, plus `locked` when the OWNER is forcing
// it (a public set is refused and the control is shown locked, not failed).
const regimeCtl = { confirmed: null, target: null, phase: 'idle', error: '', timer: null, locked: false };

let gearBuilt = false;
let gearAdmin = false; // true when the owner controls (runner + model) are present
let gearBtn = null, gearMenu = null, gearWrap = null;
let menuOpen = false, modelExpanded = false, regimeExpanded = false;
let modelToggle = null, modelGroup = null;
let regimeToggle = null, regimeGroup = null;
let leaseTimerId = null; // ticking countdown for an active public regime lease
const gearItems = {}; // active, paused, ollama, deepseek, deepseekNote, auto, day, night, leaseBadge, leaseTime

const GEAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>';

// A tiny clock for the public regime lease countdown badge.
const CLOCK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16zm.5-13H11v6l5.2 3.1.8-1.3-4.5-2.7V7z"/></svg>';

function makeItem(kind, val, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cy-menu-item';
  b.dataset.kind = kind;
  b.dataset.val = val;
  b.setAttribute('role', 'menuitem');
  const mark = document.createElement('span');
  mark.className = 'cy-mark';
  mark.setAttribute('aria-hidden', 'true');
  const lab = document.createElement('span');
  lab.className = 'cy-menu-lab';
  lab.textContent = label;
  b.appendChild(mark);
  b.appendChild(lab);
  return b;
}

function initGearMenu() {
  const meta = document.querySelector('.topmeta');
  if (!meta) return;
  gearAdmin = !!CFG.admin;
  // The gear renders for everyone as long as there is at least a public regime
  // endpoint to drive; owner controls additionally need CFG.admin.
  if (!CFG.regime && !gearAdmin) return;

  gearWrap = document.createElement('div');
  gearWrap.className = 'cy-gear';

  gearBtn = document.createElement('button');
  gearBtn.type = 'button';
  gearBtn.className = 'cy-gear-btn';
  gearBtn.setAttribute('aria-haspopup', 'menu');
  gearBtn.setAttribute('aria-expanded', 'false');
  gearBtn.setAttribute('aria-label', 'Settings');
  gearBtn.title = 'Settings';
  gearBtn.innerHTML = GEAR_SVG;

  gearMenu = document.createElement('div');
  gearMenu.className = 'cy-menu';
  gearMenu.setAttribute('role', 'menu');
  gearMenu.setAttribute('aria-label', 'Settings');
  gearMenu.hidden = true;

  // ---- OWNER-ONLY groups: Runner pair + Model submenu -------------------------
  // Built ONLY for an admin, so a non-admin's menu holds nothing but Regime (these
  // controls do not render at all, not merely disabled).
  if (gearAdmin) {
    const capR = document.createElement('span');
    capR.className = 'cy-menu-cap';
    capR.textContent = 'Runner';
    gearItems.active = makeItem('runner', 'active', 'Active');
    gearItems.paused = makeItem('runner', 'paused', 'Paused');

    const sep = document.createElement('div');
    sep.className = 'cy-menu-sep';
    sep.setAttribute('role', 'separator');

    modelToggle = document.createElement('button');
    modelToggle.type = 'button';
    modelToggle.className = 'cy-menu-item cy-menu-sub';
    modelToggle.setAttribute('role', 'menuitem');
    modelToggle.setAttribute('aria-haspopup', 'true');
    modelToggle.setAttribute('aria-expanded', 'false');
    const mMark = document.createElement('span');
    mMark.className = 'cy-mark';
    mMark.setAttribute('aria-hidden', 'true');
    const mLab = document.createElement('span');
    mLab.className = 'cy-menu-lab';
    mLab.textContent = 'Model';
    modelToggle.appendChild(mMark);
    modelToggle.appendChild(mLab);

    modelGroup = document.createElement('div');
    modelGroup.className = 'cy-menu-group';
    modelGroup.hidden = true;
    gearItems.ollama = makeItem('provider', 'ollama', 'Ollama (DELL)');
    gearItems.deepseek = makeItem('provider', 'deepseek', 'DeepSeek');
    const dsNote = document.createElement('span');
    dsNote.className = 'cy-menu-note';
    dsNote.hidden = true;
    gearItems.deepseek.appendChild(dsNote);
    gearItems.deepseekNote = dsNote;
    modelGroup.appendChild(gearItems.ollama);
    modelGroup.appendChild(gearItems.deepseek);

    const sep2 = document.createElement('div');
    sep2.className = 'cy-menu-sep';
    sep2.setAttribute('role', 'separator');

    gearMenu.appendChild(capR);
    gearMenu.appendChild(gearItems.active);
    gearMenu.appendChild(gearItems.paused);
    gearMenu.appendChild(sep);
    gearMenu.appendChild(modelToggle);
    gearMenu.appendChild(modelGroup);
    gearMenu.appendChild(sep2);
  }

  // ---- Regime submenu: PUBLIC, rendered for everyone --------------------------
  // A toggle that expands a group whose current item is greyed and inert, the others
  // clickable (force day / force night). A compact lease countdown rides the toggle.
  regimeToggle = document.createElement('button');
  regimeToggle.type = 'button';
  regimeToggle.className = 'cy-menu-item cy-menu-sub';
  regimeToggle.setAttribute('role', 'menuitem');
  regimeToggle.setAttribute('aria-haspopup', 'true');
  regimeToggle.setAttribute('aria-expanded', 'false');
  const rMark = document.createElement('span');
  rMark.className = 'cy-mark';
  rMark.setAttribute('aria-hidden', 'true');
  const rLab = document.createElement('span');
  rLab.className = 'cy-menu-lab';
  rLab.textContent = 'Regime';
  regimeToggle.appendChild(rMark);
  regimeToggle.appendChild(rLab);
  // Compact lease countdown (clock icon + m:ss), hidden until a public lease is live.
  const leaseBadge = document.createElement('span');
  leaseBadge.className = 'cy-lease';
  leaseBadge.hidden = true;
  leaseBadge.innerHTML = CLOCK_SVG;
  const leaseTime = document.createElement('span');
  leaseTime.className = 'cy-lease-t';
  leaseBadge.appendChild(leaseTime);
  regimeToggle.appendChild(leaseBadge);
  gearItems.leaseBadge = leaseBadge;
  gearItems.leaseTime = leaseTime;

  regimeGroup = document.createElement('div');
  regimeGroup.className = 'cy-menu-group';
  regimeGroup.hidden = true;
  gearItems.auto = makeItem('regime', 'auto', 'Auto');
  gearItems.day = makeItem('regime', 'day', 'Force Day');
  gearItems.night = makeItem('regime', 'night', 'Force Night');
  regimeGroup.appendChild(gearItems.auto);
  regimeGroup.appendChild(gearItems.day);
  regimeGroup.appendChild(gearItems.night);

  gearMenu.appendChild(regimeToggle);
  gearMenu.appendChild(regimeGroup);

  gearWrap.appendChild(gearBtn);
  gearWrap.appendChild(gearMenu);
  meta.insertBefore(gearWrap, $('#day') || null);
  gearBuilt = true;

  gearBtn.addEventListener('click', () => (menuOpen ? closeGear(true) : openGear()));
  gearBtn.addEventListener('keydown', (e) => {
    if (!menuOpen && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
      e.preventDefault();
      openGear();
    }
  });
  gearMenu.addEventListener('keydown', onGearKeydown);

  if (gearAdmin) {
    gearItems.active.addEventListener('click', () => sendRunner('active'));
    gearItems.paused.addEventListener('click', () => sendRunner('paused'));
    gearItems.ollama.addEventListener('click', () => sendProvider('ollama'));
    gearItems.deepseek.addEventListener('click', () => sendProvider('deepseek'));
    modelToggle.addEventListener('click', () => (modelExpanded ? collapseModel() : expandModel()));
  }
  gearItems.auto.addEventListener('click', () => sendRegime('auto'));
  gearItems.day.addEventListener('click', () => sendRegime('day'));
  gearItems.night.addEventListener('click', () => sendRegime('night'));
  regimeToggle.addEventListener('click', () => (regimeExpanded ? collapseRegime() : expandRegime()));

  renderGear();

  // seed from the server's current truth so the menu is not a guess before the
  // first stream frame; the stream then keeps it honest.
  if (gearAdmin) {
    fetch(CFG.admin, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        if (typeof d.paused !== 'undefined') runnerCtl.confirmed = d.paused ? 'paused' : 'active';
        if (d.provider) providerCtl.confirmed = d.provider;
        if (typeof d.deepseek_available !== 'undefined') providerCtl.available = !!d.deepseek_available;
        if (d.regime) regimeCtl.confirmed = d.regime;
        renderGear();
      })
      .catch(() => {});
  } else {
    // Public seed: the current regime + whether a lease is live / an owner lock holds.
    fetch(CFG.regime, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        if (d.regime) regimeCtl.confirmed = d.regime;
        applyRegimeMeta(d);
      })
      .catch(() => {});
  }
}

// The menu items reachable by arrow keys right now: visible, enabled, laid out.
function focusableGearItems() {
  return [
    gearItems.active, gearItems.paused,
    modelToggle, gearItems.ollama, gearItems.deepseek,
    regimeToggle, gearItems.auto, gearItems.day, gearItems.night,
  ].filter((el) => el && !el.hidden && !el.disabled && el.offsetParent !== null);
}

function openGear() {
  if (menuOpen || !gearMenu) return;
  menuOpen = true;
  gearMenu.hidden = false;
  gearBtn.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onGearDocDown, true);
  const items = focusableGearItems();
  if (items[0]) items[0].focus();
}

function closeGear(focusGear) {
  if (!menuOpen) return;
  menuOpen = false;
  gearMenu.hidden = true;
  collapseModel();
  collapseRegime();
  gearBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', onGearDocDown, true);
  if (focusGear) gearBtn.focus();
}

function onGearDocDown(e) {
  if (menuOpen && gearWrap && !e.composedPath().includes(gearWrap)) closeGear(false);
}

function expandModel() {
  modelExpanded = true;
  modelGroup.hidden = false;
  modelToggle.setAttribute('aria-expanded', 'true');
  const first = focusableGearItems().find((el) => el === gearItems.ollama || el === gearItems.deepseek);
  if (first) first.focus();
}

function collapseModel() {
  modelExpanded = false;
  if (modelGroup) modelGroup.hidden = true;
  if (modelToggle) modelToggle.setAttribute('aria-expanded', 'false');
}

function expandRegime() {
  regimeExpanded = true;
  regimeGroup.hidden = false;
  regimeToggle.setAttribute('aria-expanded', 'true');
  const first = focusableGearItems().find(
    (el) => el === gearItems.auto || el === gearItems.day || el === gearItems.night
  );
  if (first) first.focus();
}

function collapseRegime() {
  regimeExpanded = false;
  if (regimeGroup) regimeGroup.hidden = true;
  if (regimeToggle) regimeToggle.setAttribute('aria-expanded', 'false');
}

function onGearKeydown(e) {
  const items = focusableGearItems();
  const idx = items.indexOf(document.activeElement);
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (items.length) items[(idx + 1 + items.length) % items.length].focus();
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (items.length) items[(idx - 1 + items.length) % items.length].focus();
      break;
    case 'Home':
      e.preventDefault();
      if (items[0]) items[0].focus();
      break;
    case 'End':
      e.preventDefault();
      if (items.length) items[items.length - 1].focus();
      break;
    case 'ArrowLeft':
      if (modelExpanded) { e.preventDefault(); collapseModel(); modelToggle.focus(); }
      else if (regimeExpanded) { e.preventDefault(); collapseRegime(); regimeToggle.focus(); }
      break;
    case 'Escape':
      e.preventDefault();
      closeGear(true);
      break;
    case 'Tab':
      closeGear(false); // let focus move on naturally
      break;
  }
}

// ---- async send + settle (shared shape for the runner + the provider) ----

function sendRunner(target) {
  const c = runnerCtl;
  if (c.phase === 'pending') return;
  if (c.confirmed === target && c.phase === 'idle') return; // already there
  c.phase = 'pending';
  c.target = target;
  c.error = '';
  clearTimeout(c.timer);
  c.timer = setTimeout(() => failCtl(c, 'Timed out - not saved yet.'), CONFIRM_TIMEOUT_MS);
  renderGear();
  postAdmin({ action: target === 'paused' ? 'pause' : 'resume' }, c, target);
}

function sendProvider(target) {
  const c = providerCtl;
  if (c.phase === 'pending') return;
  if (target === 'deepseek' && !c.available) return;
  if (c.confirmed === target && c.phase === 'idle') return;
  c.phase = 'pending';
  c.target = target;
  c.error = '';
  clearTimeout(c.timer);
  c.timer = setTimeout(() => failCtl(c, 'Timed out - not saved yet.'), CONFIRM_TIMEOUT_MS);
  renderGear();
  postAdmin({ action: 'provider', provider: target }, c, target);
}

function sendRegime(target) {
  const c = regimeCtl;
  if (c.phase === 'pending') return;
  if (c.locked) return; // the owner is forcing the regime; the control is shown locked
  if (c.confirmed === target && c.phase === 'idle') return; // already there
  c.phase = 'pending';
  c.target = target;
  c.error = '';
  clearTimeout(c.timer);
  c.timer = setTimeout(() => failCtl(c, 'Timed out - not saved yet.'), CONFIRM_TIMEOUT_MS);
  renderGear();
  // Owner set = sticky (admin.php); public set = a lease (regime.php). Either way the
  // item settles only when the runner echoes the new regime on the stream.
  if (gearAdmin) postAdmin({ action: 'regime', regime: target }, c, target);
  else postRegime(target);
}

// The PUBLIC regime lease POST. On success starts the compact countdown from the
// server's remaining time; a 403 with { locked:true } means the owner is forcing the
// regime, so we show the control LOCKED rather than as a failure.
function postRegime(target) {
  const c = regimeCtl;
  fetch(CFG.regime, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regime: target }),
  })
    .then(async (res) => {
      const d = await res.json().catch(() => ({}));
      if (res.status === 403 && d && d.locked) {
        if (c.phase === 'pending' && c.target === target) {
          clearTimeout(c.timer);
          c.phase = 'idle';
          c.target = null;
        }
        applyRegimeMeta(d); // reflect the lock; not a failure
        return;
      }
      if (!res.ok || (d && d.ok === false)) throw new Error((d && d.error) || 'HTTP ' + res.status);
      // accepted + leased: begin the countdown now; the select still settles only
      // when the runner echoes the new regime on the stream (syncRegimeState).
      applyRegimeMeta(d);
    })
    .catch((err) => {
      if (c.phase === 'pending' && c.target === target) failCtl(c, String((err && err.message) || err));
    });
}

// Fold a regime.php response's lease/lock facts into the control: whether the owner
// is forcing it (locked), and how long a live PUBLIC lease has left (countdown).
function applyRegimeMeta(d) {
  if (!d) return;
  regimeCtl.locked = !!d.locked;
  const rem = typeof d.lease_remaining === 'number' ? d.lease_remaining : 0;
  if (d.source === 'public' && rem > 0) startLease(rem);
  else stopLease();
  renderGearIfPresent();
}

function fmtLease(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function stopLease() {
  if (leaseTimerId) {
    clearInterval(leaseTimerId);
    leaseTimerId = null;
  }
  if (gearItems.leaseBadge) gearItems.leaseBadge.hidden = true;
}

// Show + tick down the compact lease countdown. Purely a display; the authoritative
// value always comes from the stream, so when it reaches 0 we just hide it and let
// the external-change path settle the select back to Auto.
function startLease(seconds) {
  if (!gearItems.leaseBadge || !(seconds > 0)) {
    stopLease();
    return;
  }
  const until = Date.now() + seconds * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    if (left <= 0) {
      stopLease();
      return;
    }
    gearItems.leaseTime.textContent = fmtLease(left);
    gearItems.leaseBadge.hidden = false;
    gearItems.leaseBadge.title = 'Public regime lease: ' + fmtLease(left) + ' left';
  };
  if (leaseTimerId) clearInterval(leaseTimerId);
  tick();
  leaseTimerId = setInterval(tick, 1000);
}

function postAdmin(body, c, target) {
  fetch(CFG.admin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      const d = await res.json().catch(() => ({}));
      if (!res.ok || (d && d.ok === false)) throw new Error((d && d.error) || 'HTTP ' + res.status);
      // accepted + persisted: keep waiting for the runner's real state on the stream
    })
    .catch((err) => {
      // only fail if this is still the in-flight request (not already settled)
      if (c.phase === 'pending' && c.target === target) failCtl(c, String((err && err.message) || err));
    });
}

function failCtl(c, msg) {
  clearTimeout(c.timer);
  c.phase = 'failed';
  c.error = msg;
  renderGearIfPresent();
}

// The runner's REAL mode off the live stream (fed from setMode). Settles a pending
// pause/resume once the runner reaches the requested state, and otherwise adopts the
// authoritative value. Any non-'paused' mode = active.
function syncRunnerState(mode) {
  if (mode == null) return;
  const value = mode === 'paused' ? 'paused' : 'active';
  const c = runnerCtl;
  c.confirmed = value;
  if (c.phase === 'pending' && c.target === value) {
    clearTimeout(c.timer);
    c.phase = 'idle';
    c.target = null;
  }
  renderGearIfPresent();
}

// The runner's REAL active provider off the frequent `vitals` field (and the
// `provider` event). Settles a pending model switch so the gear menu's Model
// group stays honest.
function syncProviderState(provider) {
  if (provider !== 'ollama' && provider !== 'deepseek') return;
  const c = providerCtl;
  c.confirmed = provider;
  if (c.phase === 'pending' && c.target === provider) {
    clearTimeout(c.timer);
    c.phase = 'idle';
    c.target = null;
  }
  renderGearIfPresent();
}

// The runner's REAL regime override off the frequent `vitals` field. Settles a
// pending force-day/night once the runner reports it has picked the change up off
// its tempo poll (the exact counterpart of syncProviderState).
function syncRegimeState(regime) {
  if (regime !== 'auto' && regime !== 'day' && regime !== 'night') return;
  const c = regimeCtl;
  c.confirmed = regime;
  if (c.phase === 'pending' && c.target === regime) {
    clearTimeout(c.timer);
    c.phase = 'idle';
    c.target = null;
  }
  // 'auto' off the stream means the lease lapsed (or the owner released): the select
  // settles back to Auto via this external-change path, so drop any countdown + lock.
  if (regime === 'auto') {
    c.locked = false;
    stopLease();
  }
  renderGearIfPresent();
}

function syncCapability(deepseekAvailable) {
  providerCtl.available = !!deepseekAvailable;
  renderGearIfPresent();
}

function renderGearIfPresent() {
  if (gearBuilt) renderGear();
}

function renderGear() {
  if (!gearBuilt) return;
  paintItem(gearItems.active, runnerCtl, 'active', false);
  paintItem(gearItems.paused, runnerCtl, 'paused', false);

  const dsUnavail = !providerCtl.available;
  paintItem(gearItems.ollama, providerCtl, 'ollama', false);
  paintItem(gearItems.deepseek, providerCtl, 'deepseek', dsUnavail);
  if (gearItems.deepseekNote) {
    gearItems.deepseekNote.hidden = !dsUnavail;
    gearItems.deepseekNote.textContent = dsUnavail ? 'unavailable - no API key on the runner' : '';
  }

  paintItem(gearItems.auto, regimeCtl, 'auto', false);
  paintItem(gearItems.day, regimeCtl, 'day', false);
  paintItem(gearItems.night, regimeCtl, 'night', false);
  // When the OWNER is forcing the regime, the public control is LOCKED, not silently
  // failing: disable all three and mark them so the lock reads clearly.
  const regimeItems = [gearItems.auto, gearItems.day, gearItems.night];
  if (regimeCtl.locked) {
    for (const el of regimeItems) {
      if (!el) continue;
      el.disabled = true;
      el.classList.add('is-locked');
      el.title = 'Locked - the owner has set the regime';
    }
    if (regimeToggle) regimeToggle.classList.add('is-locked');
  } else if (regimeToggle) {
    regimeToggle.classList.remove('is-locked');
  }

  // If the focused item just became inert, keep focus usable inside the open menu.
  if (menuOpen) {
    const a = document.activeElement;
    if (a && gearMenu.contains(a) && (a.disabled || a.hidden)) {
      const items = focusableGearItems();
      if (items[0]) items[0].focus();
    }
  }
}

// One item's visual state from its control. `unavail` forces a disabled,
// reason-titled state (DeepSeek with no key on the runner).
function paintItem(el, c, val, unavail) {
  if (!el) return;
  el.classList.remove('is-current', 'is-pending', 'is-failed', 'is-unavail', 'is-locked');
  el.disabled = false;
  el.removeAttribute('title');

  if (unavail) {
    el.classList.add('is-unavail');
    el.disabled = true;
    el.title = 'DeepSeek unavailable - no API key on the runner';
    return;
  }
  if (c.phase === 'pending' && c.target === val) {
    el.classList.add('is-pending');
    el.disabled = true;
    el.title = 'Waiting for the runner to confirm...';
  } else if (c.phase === 'failed' && c.target === val) {
    el.classList.add('is-failed');
    el.title = (c.error || 'Change failed') + ' - click to retry';
  } else if (c.confirmed === val) {
    el.classList.add('is-current');
    el.disabled = true; // the current state is inert; only the other item acts
  } else if (c.phase === 'pending') {
    el.disabled = true; // a change is in flight; hold the rest of the pair/group
  }
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
