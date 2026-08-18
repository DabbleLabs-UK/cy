// postcard.js - the reply rendered as a real object: a franked prison postcard.
//
// When 7734 replies to a postcard the answer is NOT written on the journal sheet.
// It is written on a distinct card element - landscape, a divided back (message
// left, address panel right), a stamp with an HMP THINKPAD franking mark, a
// crooked purple censor stamp, and the sender's handle in the address panel. If
// the incoming postcard carried a picture it is pinned to the card as a photo.
//
// The reply is drawn LIVE on the card, stroke by stroke, by a dedicated Pen
// instance constrained to the card's message area (small hand, tight leading,
// cram-to-fit). When the reply is done the card settles into place and the
// journal resumes on the paper beneath.
//
// Lifecycle, driven by app.js from the event stream:
//   incoming(p)  - a postcard_in: stash the sender + any picture
//   begin()      - mode flips to 'letter': create the card + its pen
//   write(s)     - each 'letter' text token: hand it to the card pen
//   abort()      - an interrupt lands mid-reply: trail the card's stroke off
//   reply(body)  - a postcard_out: the authoritative full reply text
//   settle()     - mode flips back to 'journal': the card settles, journal resumes
//
// Backlog fill (setInstant(true)) lays a completed card down flat - a reply that
// finished before you arrived appears complete, not re-animated.

import { Pen } from './pen.js';

const HANDS = -2.4; // base tilt (deg); each card jitters around it for an object feel
const MAX_CARDS = 6; // keep a short stack of recent cards; prune the oldest

export class Postcards {
  constructor(root, font) {
    this.root = root; // #postcards overlay container over the paper
    this.font = font;
    this.instant = false;
    this.active = null; // { el, pen, body, fullBody }
    this.cards = []; // settled/active cards, newest last; capped at MAX_CARDS
    this._pending = null; // the incoming postcard awaiting its reply
    this._rotSeed = 1; // deterministic-ish per-card jitter (no Math.random dependency)
  }

  setInstant(on) {
    this.instant = !!on;
    if (this.active && this.active.pen) this.active.pen.setInstant(this.instant);
  }

  // A postcard_in arrived: remember who sent it and any picture. Order-agnostic -
  // the runner emits `mode letter` BEFORE postcard_in, while the test feed emits
  // postcard_in first. If a reply card is already open (runner order), address it
  // in place and pin the photo now; otherwise stash it for the next begin().
  incoming(p) {
    const info = {
      id: p ? p.id : null,
      from: (p && p.from) || 'a stranger',
      image: p && p.image ? String(p.image) : '',
      attrib: (p && p.attrib) || '',
    };
    if (this.active) {
      if (this.active.handleEl) this.active.handleEl.textContent = info.from;
      if (info.image && !this.active.hasPic) {
        this.active.el.insertBefore(this._buildPic(info.image), this.active.el.firstChild);
        this.active.hasPic = true;
      }
      this.active.id = info.id;
    } else {
      this._pending = info;
    }
  }

  // Build the pinned-photo element for an incoming picture.
  _buildPic(image) {
    const pic = document.createElement('div');
    pic.className = 'pcard-pic';
    const img = document.createElement('img');
    img.className = 'pcard-pic-img';
    img.setAttribute('loading', 'lazy');
    img.setAttribute('alt', 'the picture that came with the postcard');
    img.setAttribute('src', image);
    pic.appendChild(img);
    return pic;
  }

  // Build a fresh card for the reply now being written. Idempotent within a reply:
  // if a card is already active, keep it.
  begin() {
    if (this.active) return this.active;
    const pend = this._pending || { from: 'a stranger', image: '', id: null };
    const rot = HANDS + this._tilt();
    const el = document.createElement('div');
    el.className = 'pcard-obj writing';
    el.style.setProperty ? el.style.setProperty('--rot', rot.toFixed(2) + 'deg') : (el.style.transform = `rotate(${rot}deg)`);

    // an optional pinned photo, overlapping the top-left corner of the card
    let hasPic = false;
    if (pend.image) {
      el.appendChild(this._buildPic(pend.image));
      hasPic = true;
    }

    const card = document.createElement('div');
    card.className = 'pcard';

    // ---- message side (left) ----
    const msgSide = document.createElement('div');
    msgSide.className = 'pcard-msg-side';
    const msg = document.createElement('div');
    msg.className = 'pcard-msg';
    msgSide.appendChild(msg);
    card.appendChild(msgSide);

    // ---- divide ----
    const divide = document.createElement('div');
    divide.className = 'pcard-divide';
    divide.setAttribute('aria-hidden', 'true');
    card.appendChild(divide);

    // ---- address side (right): stamp + franking, then the address lines ----
    const addrSide = document.createElement('div');
    addrSide.className = 'pcard-addr-side';

    const stamp = document.createElement('div');
    stamp.className = 'pcard-stamp';
    const stampInner = document.createElement('div');
    stampInner.className = 'pcard-stamp-inner';
    stampInner.textContent = '7734';
    stamp.appendChild(stampInner);
    const frank = document.createElement('div');
    frank.className = 'pcard-frank';
    frank.setAttribute('aria-hidden', 'true');
    for (const w of ['HMP', 'THINKPAD']) {
      const s = document.createElement('span');
      s.textContent = w;
      frank.appendChild(s);
    }
    stamp.appendChild(frank);
    addrSide.appendChild(stamp);

    const addr = document.createElement('div');
    addr.className = 'pcard-addr';
    const to = document.createElement('div');
    to.className = 'pcard-to';
    to.textContent = 'To';
    addr.appendChild(to);
    const handle = document.createElement('div');
    handle.className = 'pcard-handle';
    handle.textContent = pend.from; // textContent: user handle never becomes markup
    addr.appendChild(handle);
    for (let i = 0; i < 3; i++) {
      const r = document.createElement('div');
      r.className = 'pcard-rule';
      addr.appendChild(r);
    }
    addrSide.appendChild(addr);
    card.appendChild(addrSide);

    el.appendChild(card);

    // ---- the censor's mark: crooked purple rubber stamp over the text edge ----
    const censor = document.createElement('div');
    censor.className = 'pcard-censor';
    censor.setAttribute('aria-hidden', 'true');
    const c1 = document.createElement('span');
    c1.className = 'pcard-censor-l1';
    c1.textContent = 'PASSED BY CENSOR';
    const c2 = document.createElement('span');
    c2.className = 'pcard-censor-l2';
    c2.textContent = 'No. 7734';
    censor.appendChild(c1);
    censor.appendChild(c2);
    el.appendChild(censor);

    this.root.appendChild(el);

    // the card's own pen, constrained to the message area
    const pen = new Pen(msg, this.font);
    pen.setCardLayout();
    pen.setInstant(this.instant);

    this.active = { el, pen, msg, handleEl: handle, hasPic, body: '', fullBody: '', id: pend.id };
    this.cards.push(this.active);
    this._prune();
    this._pending = null;
    return this.active;
  }

  // A reply token: write it live onto the active card. Auto-begins if a card was
  // not opened first (defensive - a stray letter token without a mode flip).
  write(s) {
    if (!s) return;
    if (!this.active) this.begin();
    this.active.body += s;
    this.active.pen.write(s);
  }

  // An interrupt landed mid-reply: trail the card's current stroke off (a scar),
  // exactly like the journal pen.
  abort() {
    if (this.active && this.active.pen) this.active.pen.abort();
  }

  // The authoritative full reply text (postcard_out). Kept so a backlog card whose
  // per-token text scrolled out of the window can still be laid down complete.
  reply(body) {
    if (this.active) this.active.fullBody = body || this.active.fullBody;
  }

  // The reply is done: settle the card into place. If nothing was written to it
  // (a partial backlog window that only carried the postcard_out), lay the full
  // reply down instantly so the card is never blank.
  settle() {
    const a = this.active;
    if (!a) return;
    if (!a.body && a.fullBody) {
      const wasInstant = a.pen.instant;
      a.pen.setInstant(true); // a settle-time backfill is never re-animated
      a.pen.write(a.fullBody);
      a.pen.setInstant(wasInstant);
      a.body = a.fullBody;
    }
    a.el.classList.remove('writing');
    a.el.classList.add('settled');
    this.active = null;
  }

  // deterministic small per-card tilt in [-1.4, +1.4] deg, no Math.random so a
  // headless replay is stable.
  _tilt() {
    this._rotSeed = (this._rotSeed * 1103515245 + 12345) & 0x7fffffff;
    return ((this._rotSeed % 281) / 100) - 1.4;
  }

  _prune() {
    while (this.cards.length > MAX_CARDS) {
      const dead = this.cards.shift();
      if (dead === this.active) {
        this.cards.unshift(dead);
        break;
      }
      try { dead.pen.destroy(); } catch { /* ignore */ }
      if (dead.el && dead.el.remove) dead.el.remove();
    }
  }
}
