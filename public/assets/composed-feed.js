// composed-feed.js - the default handwritten view as a chronology of objects.
//
// Each writing burst gets its own Pen surface. Stream events, postcards and day
// boundaries are ordinary DOM siblings between those surfaces, so their order is
// preserved during live viewing and historical replay.

import { Pen } from './pen.js';
import { bindEndpointTime, dayLabel, formatDuration, isLiveDate, shiftDate, shiftTimestamp, timestampMs } from './timeline.js';
import { createJumpToLatest } from './jump-to-latest.js';

// One person has one hand. Each visible writing object owns its own Pen renderer,
// but they all reserve this shared lane so only the earliest unfinished object can
// animate. Historical/static objects never enter the lane.
export class HandwritingLane {
  constructor() {
    this.tail = Promise.resolve();
    this.generation = 0;
  }

  begin(pen) {
    const before = this.tail;
    const generation = this.generation;
    if (pen && typeof pen.waitFor === 'function') pen.waitFor(before);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (generation !== this.generation || !pen || typeof pen.whenIdle !== 'function') return;
      this.tail = before.then(() => pen.whenIdle()).catch(() => undefined);
    };
  }

  whenIdle() {
    return this.tail;
  }

  reset() {
    this.generation++;
    this.tail = Promise.resolve();
  }
}

export class ComposedFeed {
  constructor(root, font) {
    this.root = root;
    this.font = font;
    this.instant = false;
    this.current = null;
    this.pens = [];
    this.lane = new HandwritingLane();
    this.vitals = null;
    this.following = true;
    this.loadingEarlier = null;
    this.loadingLater = null;
    this.chooseDay = null;
    this.changeDay = null;
    this.goLive = null;
    this.scrollSettleToken = 0;
    this.suppressPaging = false;

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'cy-scroll';
    this.flow = document.createElement('div');
    this.flow.className = 'cy-flow';
    this.scrollEl.appendChild(this.flow);
    this.root.appendChild(this.scrollEl);
    this.jumpControl = createJumpToLatest(this.root, this.scrollEl, () => this.scrollToEnd());
    this.scrollEl.addEventListener('scroll', () => {
      if (this.root.hidden || this.suppressPaging) return;
      const gap = this.scrollEl.scrollHeight - this.scrollEl.scrollTop - this.scrollEl.clientHeight;
      this.following = gap < 48;
      this.jumpControl.sync(this.following);
      if (this.scrollEl.scrollTop < 80 && this.loadingEarlier) this.loadingEarlier();
      if (gap < 80 && this.loadingLater) this.loadingLater();
    });
  }

  contentRoot() {
    return this.flow;
  }

  animationLane() {
    return this.lane;
  }

  onNearStart(fn) {
    this.loadingEarlier = typeof fn === 'function' ? fn : null;
  }

  onNearEnd(fn) {
    this.loadingLater = typeof fn === 'function' ? fn : null;
  }

  onChooseDay(fn) {
    this.chooseDay = typeof fn === 'function' ? fn : null;
  }

  onChangeDay(fn) {
    this.changeDay = typeof fn === 'function' ? fn : null;
  }

  onGoLive(fn) {
    this.goLive = typeof fn === 'function' ? fn : null;
  }

  beginDay(date, today = '') {
    this.closeEntry();
    const banner = document.createElement('div');
    banner.className = 'cy-day-banner';
    banner.dataset.date = String(date || '');

    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'cy-day-step';
    previous.textContent = 'Previous day';
    previous.addEventListener('click', () => {
      if (this.changeDay) this.changeDay(-1);
    });

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'cy-day-choose';
    choose.setAttribute('aria-label', 'Choose another day');
    const cap = document.createElement('span');
    cap.className = 'cy-day-cap';
    const liveDay = isLiveDate(date, today);
    cap.textContent = liveDay ? 'LIVE' : 'VIEWING';
    const label = document.createElement('strong');
    label.textContent = dayLabel(date);
    choose.appendChild(cap);
    choose.appendChild(label);
    choose.addEventListener('click', () => {
      if (this.chooseDay) this.chooseDay();
    });

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'cy-day-step';
    const nextDate = shiftDate(date, 1);
    next.textContent = !liveDay && nextDate === today ? 'Live today' : 'Next day';
    next.disabled = liveDay || (!!today && String(date) >= String(today));
    next.addEventListener('click', () => {
      if (this.changeDay) this.changeDay(1);
    });

    const actions = document.createElement('div');
    actions.className = 'cy-day-actions';
    actions.appendChild(next);
    if (!liveDay && today && nextDate !== today) {
      const live = document.createElement('button');
      live.type = 'button';
      live.className = 'cy-day-step cy-day-live';
      live.textContent = 'Live now';
      live.addEventListener('click', () => {
        if (this.goLive) this.goLive();
      });
      actions.appendChild(live);
    }

    banner.appendChild(previous);
    banner.appendChild(choose);
    banner.appendChild(actions);
    this.flow.appendChild(banner);
  }

  beginEntry(ts, mode) {
    this.finishAnimations();
    this.closeEntry(ts);
    const entryMode = mode || 'journal';
    const block = document.createElement('article');
    block.className = 'cy-writing-segment ' + (entryMode === 'journal' ? 'cy-journal-entry' : 'cy-writing-note');
    block.dataset.kind = entryMode;
    const label = mode === 'dream' ? 'dream' : mode === 'warden' ? 'notice' : 'writing';
    this._appendEndpoint(block, ts, label + ' starts', 'start');
    const surface = document.createElement('div');
    surface.className = 'cy-writing-surface';
    block.appendChild(surface);
    this.flow.appendChild(block);

    // A complete-day replay can contain hundreds of thousands of characters.
    // Building Hershey SVG strokes for all of them creates millions of DOM nodes
    // and can make the browser declare the page unresponsive. Historical prose
    // remains handwriting-styled and selectable, but only genuinely live prose
    // pays for the animated vector pen.
    if (this.instant) {
      surface.classList.add('cy-writing-static');
      this.current = {
        block, surface, text: '', mode: entryMode, label,
        startMs: timestampMs(ts), static: true,
      };
      this._follow();
      return;
    }

    const pen = new Pen(surface, this.font);
    pen.setInstant(this.instant);
    if (this.vitals) pen.setVitals(this.vitals);
    const finishLane = this.lane.begin(pen);
    pen.beginEntry('', entryMode);
    this.pens.push(pen);
    this.current = { block, pen, mode: entryMode, label, startMs: timestampMs(ts), finishLane };
    this._follow();
  }

  write(text, mode, lucid, shout, ts = '') {
    if (!text) return;
    // The replay-to-live transition deliberately closes its lightweight static
    // segment before animated tokens resume. The app-level boundary flag can
    // still describe that same logical generation as open, so write() must be
    // able to recreate the physical card from the token's own timestamp. Never
    // manufacture an undated "--:--:--" endpoint when the event supplied one.
    if (!this.current) this.beginEntry(ts, mode);
    if (this.current.static) {
      this.current.text += String(text);
      this.current.surface.textContent = this.current.text;
    } else {
      this.current.pen.write(text, mode, lucid, shout);
    }
    this._follow();
  }

  closeEntry(endTs = '') {
    const entry = this.current;
    const endMs = timestampMs(endTs);
    if (entry && endMs != null && (entry.startMs == null || endMs >= entry.startMs)) {
      this._appendEndpoint(entry.block, endTs, entry.label + ' ends', 'end');
    }
    if (entry && entry.finishLane) entry.finishLane();
    this.current = null;
  }

  event(label, detail, ts, kind = 'event', image = '') {
    this.finishAnimations();
    this.closeEntry(ts);
    const block = document.createElement('section');
    block.className = 'cy-event-block cy-event-' + kind;
    block.dataset.kind = kind;
    this._appendEndpoint(block, ts, 'event', 'point');
    const title = document.createElement('div');
    title.className = 'cy-event-title';
    title.textContent = '[' + String(label || 'event') + ']';
    block.appendChild(title);
    if (detail) {
      const body = document.createElement('div');
      body.className = 'cy-event-detail';
      body.textContent = String(detail);
      block.appendChild(body);
    }
    if (image) {
      const img = document.createElement('img');
      img.className = 'cy-event-image';
      img.loading = 'lazy';
      img.alt = 'image included with the postcard';
      img.src = String(image);
      block.appendChild(img);
    }
    this.flow.appendChild(block);
    this._follow();
    return block;
  }

  postcard(payload, ts) {
    const p = payload || {};
    const from = p.from || 'someone';
    const label = p.promoted ? 'fan mail chosen for Cy from ' + from : 'postcard received from ' + from;
    return this.event(label, p.body || '', ts, 'postcard', p.image || '');
  }

  fanMail(payload, ts) {
    const p = payload || {};
    const from = p.from || 'someone';
    return this.event('fan mail bag - kept from ' + from, p.body || '', ts, 'fan-mail', p.image || '');
  }

  silence(seconds, ts) {
    const secs = Math.max(0, Number(seconds) || 0);
    if (!secs) return;
    this.finishAnimations();
    this.closeEntry(shiftTimestamp(ts, -secs));
    const block = document.createElement('section');
    block.className = 'cy-event-block cy-event-silence';
    block.dataset.kind = 'silence';
    this._appendEndpoint(block, shiftTimestamp(ts, -secs), 'silence starts', 'start');
    const title = document.createElement('div');
    title.className = 'cy-event-title';
    title.textContent = '[inmate silent for ' + formatDuration(secs) + ']';
    block.appendChild(title);
    this._appendEndpoint(block, ts, 'silence ends', 'end');
    this.flow.appendChild(block);
    this._follow();
  }

  draw(drawing, ts) {
    this.finishAnimations();
    this.closeEntry(ts);
    const block = document.createElement('section');
    block.className = 'cy-writing-segment cy-drawing-segment';
    block.dataset.kind = 'drawing';
    this._appendEndpoint(block, ts, drawing && drawing.dream ? 'dream drawing' : 'drawing', 'point');
    const surface = document.createElement('div');
    surface.className = 'cy-writing-surface cy-drawing-surface';
    block.appendChild(surface);
    this.flow.appendChild(block);
    const pen = new Pen(surface, this.font);
    pen.setInstant(this.instant);
    if (this.vitals) pen.setVitals(this.vitals);
    const finishLane = this.instant ? null : this.lane.begin(pen);
    pen.draw(drawing);
    if (finishLane) finishLane();
    this.pens.push(pen);
    this._follow();
  }

  abort(ts = '') {
    if (this.current && !this.current.static && this.current.pen) this.current.pen.abort();
    this.closeEntry(ts);
  }

  setVitals(payload) {
    this.vitals = payload || null;
    if (this.current && !this.current.static && this.current.pen) this.current.pen.setVitals(payload);
  }

  setMode(mode, ts = '') {
    // A mode boundary ends the current object. The next token creates a fresh
    // surface in the new mode; mutating the previous segment would rewrite history.
    this.closeEntry(ts);
    this.mode = mode;
  }

  setInstant(on) {
    const wasInstant = this.instant;
    this.instant = !!on;
    // Do not append new live tokens to a lightweight historical segment. The
    // next live token opens a real animated pen surface.
    if (wasInstant && !this.instant && this.current && this.current.static) this.closeEntry();
    for (const pen of this.pens) pen.setInstant(this.instant);
  }

  // A later visible object has taken the bottom of the chronology. Preserve all
  // earlier ink, but stop those older surfaces owning a moving pen.
  finishAnimations() {
    for (const pen of this.pens) {
      if (pen && typeof pen.finishImmediately === 'function') pen.finishImmediately();
    }
  }

  reset() {
    for (const pen of this.pens) {
      try { pen.abort(); pen.destroy(); } catch { /* best effort */ }
    }
    this.pens = [];
    this.current = null;
    this.lane.reset();
    this.flow.textContent = '';
    this._setScrollTop(0, true);
    this.jumpControl.hide();
  }

  whenIdle() {
    return Promise.all([this.lane.whenIdle(), ...this.pens.map((pen) => pen.whenIdle())]);
  }

  scrollToStart() {
    this._setScrollTop(0, false);
    this.jumpControl.show();
  }

  scrollToEnd() {
    this._setScrollTop(this.scrollEl.scrollHeight, true);
    this.jumpControl.hide();
  }

  scrollState() {
    return { top: this.scrollEl.scrollTop, height: this.scrollEl.scrollHeight };
  }

  restoreAfterPrepend(state) {
    if (!state) return;
    this._setScrollTop(Math.max(0, this.scrollEl.scrollHeight - state.height + state.top), false);
    this.jumpControl.show();
  }

  restorePosition(state) {
    if (!state) return;
    this._setScrollTop(Math.max(0, state.top), false);
    this.jumpControl.show();
  }

  _appendEndpoint(block, ts, label, edge) {
    const meta = document.createElement('div');
    meta.className = 'cy-moment-meta cy-moment-' + edge;
    const time = document.createElement('time');
    bindEndpointTime(time, ts);
    meta.appendChild(time);
    if (label) {
      const kind = document.createElement('span');
      kind.textContent = label;
      meta.appendChild(kind);
    }
    block.appendChild(meta);
  }

  _follow() {
    if (this.following) this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
  }

  _setScrollTop(top, following) {
    const token = ++this.scrollSettleToken;
    this.following = !!following;
    this.suppressPaging = true;
    this.scrollEl.scrollTop = top;
    const release = () => {
      if (token === this.scrollSettleToken) this.suppressPaging = false;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(release);
    else setTimeout(release, 0);
  }
}
