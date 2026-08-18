// hud.js - host telemetry panel + the delivered-mail side column.
//
// The host panel reads the `host` event (cpu %, memory % and MB) and renders it
// like a machine readout. The mail column renders delivered inbound letters,
// CY's outbound replies, delivered images and news items as a shared feed
// so every viewer sees what the others sent and how 7734 answered.

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export class Hud {
  constructor({ host, mail }) {
    this.hostEl = host;
    this.mailEl = mail;
    this._seen = new Set(); // dedupe by kind:id so replays do not double up
    this._buildHost();
  }

  _buildHost() {
    this.hostEl.classList.add('hostpanel');
    this.hostEl.innerHTML = `
      <div class="hp-title">HMP ThinkPad &middot; Host</div>
      <div class="hp-row"><span class="hp-k">CPU</span>
        <span class="hp-bar"><i id="hp-cpu-bar"></i></span>
        <span class="hp-v" id="hp-cpu">--%</span></div>
      <div class="hp-row"><span class="hp-k">MEM</span>
        <span class="hp-bar"><i id="hp-mem-bar"></i></span>
        <span class="hp-v" id="hp-mem">--%</span></div>
      <div class="hp-row hp-sub"><span class="hp-k">RSS</span>
        <span class="hp-v2" id="hp-memmb">---- MB</span></div>`;
    this.cpu = this.hostEl.querySelector('#hp-cpu');
    this.cpuBar = this.hostEl.querySelector('#hp-cpu-bar');
    this.mem = this.hostEl.querySelector('#hp-mem');
    this.memBar = this.hostEl.querySelector('#hp-mem-bar');
    this.memMb = this.hostEl.querySelector('#hp-memmb');
  }

  setHost(p) {
    if (!p) return;
    // accept both runner (camelCase) and spec (snake_case) shapes
    const cpu = num(p.cpu);
    const memPct = num(p.memPct ?? p.mem_pct);
    const memMb = num(p.memMB ?? p.mem_mb);
    if (cpu != null) {
      this.cpu.textContent = cpu.toFixed(0) + '%';
      this.cpuBar.style.width = clampPct(cpu) + '%';
      this.cpuBar.classList.toggle('hot', cpu > 85);
    }
    if (memPct != null) {
      this.mem.textContent = memPct.toFixed(0) + '%';
      this.memBar.style.width = clampPct(memPct) + '%';
      this.memBar.classList.toggle('hot', memPct > 85);
    }
    if (memMb != null) this.memMb.textContent = Math.round(memMb).toLocaleString() + ' MB';
  }

  // ---- mail column ------------------------------------------------------

  _once(kind, id) {
    if (id == null) return true; // no id -> always show
    const key = kind + ':' + id;
    if (this._seen.has(key)) return false;
    this._seen.add(key);
    return true;
  }

  _push(node) {
    // newest at the top; cap the column so a long-open tab stays bounded
    this.mailEl.insertBefore(node, this.mailEl.firstChild);
    while (this.mailEl.children.length > 60) this.mailEl.lastChild.remove();
  }

  // An incoming postcard: text on one side, an image on the other (either may
  // be absent). image is a webroot-relative path; attrib is any credit line.
  addPostcardIn(p) {
    if (!this._once('postcard_in', p.id)) return;
    const el = document.createElement('div');
    el.className = 'mail postcard-in';
    const img = p.image
      ? `<img class="mail-img" loading="lazy" alt="a postcard picture" src="${esc(p.image)}">`
      : '';
    const attrib = p.image && p.attrib ? `<div class="mail-cap">${esc(p.attrib)}</div>` : '';
    const body = p.body ? `<div class="mail-body">${esc(p.body)}</div>` : '';
    el.innerHTML =
      `<div class="mail-h"><span class="mail-tag">POSTCARD</span>` +
      `<span class="mail-from">from ${esc(p.from || 'anonymous')}</span></div>` +
      img + attrib + body;
    this._push(el);
  }

  addPostcardOut(p) {
    if (!this._once('postcard_out', p.id)) return;
    const el = document.createElement('div');
    el.className = 'mail letter-out';
    el.innerHTML =
      `<div class="mail-h"><span class="mail-tag out">7734 REPLIES</span></div>` +
      `<div class="mail-body">${esc(p.body)}</div>`;
    this._push(el);
  }

  addNewsIn(p) {
    if (!this._once('news_in', p.id)) return;
    const el = document.createElement('div');
    el.className = 'mail news-in';
    el.innerHTML =
      `<div class="mail-h"><span class="mail-tag">NEWS</span>` +
      `<span class="mail-from">${esc(p.source || '')}</span></div>` +
      `<div class="mail-body">${esc(p.headline)}</div>`;
    this._push(el);
  }
}

function num(x) {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(+x)) return +x;
  return null;
}
function clampPct(x) {
  return Math.max(0, Math.min(100, x));
}
