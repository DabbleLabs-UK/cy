// composed-feed.js - the default handwritten view as a chronology of objects.
//
// Each writing burst gets its own Pen surface. Stream events, postcards and day
// boundaries are ordinary DOM siblings between those surfaces, so their order is
// preserved during live viewing and historical replay.

import { Pen } from './pen.js';
import { clockOf, dayLabel, formatDuration, sinceLabel, timestampMs } from './timeline.js';

export class ComposedFeed {
  constructor(root, font) {
    this.root = root;
    this.font = font;
    this.instant = false;
    this.current = null;
    this.pens = [];
    this.vitals = null;
    this.lastMomentMs = null;
    this.following = true;
    this.loadingEarlier = null;
    this.loadingLater = null;
    this.scrollSettleToken = 0;
    this.suppressPaging = false;

    this.flow = document.createElement('div');
    this.flow.className = 'cy-flow';
    this.root.appendChild(this.flow);
    this.root.addEventListener('scroll', () => {
      if (this.root.hidden || this.suppressPaging) return;
      const gap = this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight;
      this.following = gap < 48;
      if (this.root.scrollTop < 80 && this.loadingEarlier) this.loadingEarlier();
      if (gap < 80 && this.loadingLater) this.loadingLater();
    });
  }

  contentRoot() {
    return this.flow;
  }

  onNearStart(fn) {
    this.loadingEarlier = typeof fn === 'function' ? fn : null;
  }

  onNearEnd(fn) {
    this.loadingLater = typeof fn === 'function' ? fn : null;
  }

  beginDay(date) {
    this.closeEntry();
    const banner = document.createElement('div');
    banner.className = 'cy-day-banner';
    banner.dataset.date = String(date || '');
    const cap = document.createElement('span');
    cap.className = 'cy-day-cap';
    cap.textContent = 'VIEWING';
    const label = document.createElement('strong');
    label.textContent = dayLabel(date);
    banner.appendChild(cap);
    banner.appendChild(label);
    this.flow.appendChild(banner);
  }

  beginEntry(ts, mode) {
    this.closeEntry();
    const block = document.createElement('article');
    block.className = 'cy-writing-segment';
    block.dataset.kind = mode || 'journal';
    this._appendMoment(block, ts, mode === 'dream' ? 'dream' : mode === 'warden' ? 'notice' : 'writing');
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
      this.current = { block, surface, text: '', mode: mode || 'journal', static: true };
      this._follow();
      return;
    }

    const pen = new Pen(surface, this.font);
    pen.setInstant(this.instant);
    if (this.vitals) pen.setVitals(this.vitals);
    pen.beginEntry('', mode || 'journal');
    this.pens.push(pen);
    this.current = { block, pen, mode: mode || 'journal' };
    this._follow();
  }

  write(text, mode, lucid, shout) {
    if (!text) return;
    if (!this.current) this.beginEntry('', mode);
    if (this.current.static) {
      this.current.text += String(text);
      this.current.surface.textContent = this.current.text;
    } else {
      this.current.pen.write(text, mode, lucid, shout);
    }
    this._follow();
  }

  closeEntry() {
    this.current = null;
  }

  event(label, detail, ts, kind = 'event', image = '') {
    this.closeEntry();
    const block = document.createElement('section');
    block.className = 'cy-event-block cy-event-' + kind;
    block.dataset.kind = kind;
    this._appendMoment(block, ts, 'event');
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
    this.event('inmate silent for ' + formatDuration(secs), '', ts, 'silence');
  }

  draw(drawing, ts) {
    this.closeEntry();
    const block = document.createElement('section');
    block.className = 'cy-writing-segment cy-drawing-segment';
    block.dataset.kind = 'drawing';
    this._appendMoment(block, ts, drawing && drawing.dream ? 'dream drawing' : 'drawing');
    const surface = document.createElement('div');
    surface.className = 'cy-writing-surface cy-drawing-surface';
    block.appendChild(surface);
    this.flow.appendChild(block);
    const pen = new Pen(surface, this.font);
    pen.setInstant(this.instant);
    if (this.vitals) pen.setVitals(this.vitals);
    pen.draw(drawing);
    this.pens.push(pen);
    this._follow();
  }

  abort() {
    if (this.current && !this.current.static && this.current.pen) this.current.pen.abort();
    this.closeEntry();
  }

  setVitals(payload) {
    this.vitals = payload || null;
    if (this.current && !this.current.static && this.current.pen) this.current.pen.setVitals(payload);
  }

  setMode(mode) {
    // A mode boundary ends the current object. The next token creates a fresh
    // surface in the new mode; mutating the previous segment would rewrite history.
    this.closeEntry();
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

  reset() {
    for (const pen of this.pens) {
      try { pen.abort(); pen.destroy(); } catch { /* best effort */ }
    }
    this.pens = [];
    this.current = null;
    this.lastMomentMs = null;
    this.flow.textContent = '';
    this._setScrollTop(0, true);
  }

  whenIdle() {
    return Promise.all(this.pens.map((pen) => pen.whenIdle()));
  }

  scrollToStart() {
    this._setScrollTop(0, false);
  }

  scrollToEnd() {
    this._setScrollTop(this.root.scrollHeight, true);
  }

  scrollState() {
    return { top: this.root.scrollTop, height: this.root.scrollHeight };
  }

  restoreAfterPrepend(state) {
    if (!state) return;
    this._setScrollTop(Math.max(0, this.root.scrollHeight - state.height + state.top), false);
  }

  restorePosition(state) {
    if (!state) return;
    this._setScrollTop(Math.max(0, state.top), false);
  }

  _appendMoment(block, ts, label) {
    const meta = document.createElement('div');
    meta.className = 'cy-moment-meta';
    const time = document.createElement('time');
    time.textContent = clockOf(ts) || '--:--';
    meta.appendChild(time);
    if (label) {
      const kind = document.createElement('span');
      kind.textContent = label;
      meta.appendChild(kind);
    }
    const since = sinceLabel(ts, this.lastMomentMs);
    if (since) {
      const elapsed = document.createElement('span');
      elapsed.className = 'cy-moment-since';
      elapsed.textContent = '+' + since;
      meta.appendChild(elapsed);
    }
    block.appendChild(meta);
    const ms = timestampMs(ts);
    if (ms != null) this.lastMomentMs = ms;
  }

  _follow() {
    if (this.following) this.root.scrollTop = this.root.scrollHeight;
  }

  _setScrollTop(top, following) {
    const token = ++this.scrollSettleToken;
    this.following = !!following;
    this.suppressPaging = true;
    this.root.scrollTop = top;
    const release = () => {
      if (token === this.scrollSettleToken) this.suppressPaging = false;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(release);
    else setTimeout(release, 0);
  }
}
