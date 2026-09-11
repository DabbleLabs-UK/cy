// postcard-archive.js - focused, paged correspondence history.
//
// The archive reads queue state; it does not infer or alter it. Newest postcards
// load first and "Load older" advances an id cursor without fetching the whole
// database. User-provided text is always assigned with textContent.

export const POSTCARD_ARCHIVE_FILTERS = ['all', 'replied', 'waiting', 'fan_mail'];

// Keep the browser's native fetch attached to its global receiver. Storing the
// native function directly on a PostcardArchive instance makes the later method
// call use that instance as `this`, which Chromium rejects as an illegal
// invocation. Tests can still inject a plain fetch-compatible function.
export function postcardArchiveFetch(...args) {
  return globalThis.fetch(...args);
}

export function postcardArchiveUrl(endpoint, filter, cursor = null, limit = 20) {
  const query = new URLSearchParams();
  query.set('status', POSTCARD_ARCHIVE_FILTERS.includes(filter) ? filter : 'all');
  query.set('limit', String(limit));
  if (Number(cursor) > 0) query.set('cursor', String(Math.floor(Number(cursor))));
  return endpoint + (endpoint.includes('?') ? '&' : '?') + query.toString();
}

export function postcardRelativeAge(iso, now = Date.now()) {
  const time = Date.parse(String(iso || ''));
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 45) return 'received just now';
  if (seconds < 90) return 'received 1 minute ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `received ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'received 1 hour ago';
  if (hours < 24) return `received ${hours} hours ago`;
  if (hours < 48) return 'received yesterday';
  return '';
}

export function postcardExactTime(iso) {
  const time = Date.parse(String(iso || ''));
  if (!Number.isFinite(time)) return 'time unavailable';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  }).format(new Date(time));
}

export function postcardStatusNote(item) {
  if (!item || !item.status) return '';
  if (item.status === 'not_delivered') return 'This postcard was screened out and did not reach Cy.';
  if (item.status === 'fan_mail') {
    return item.fan_mail_may_reply
      ? 'Kept as fan mail. It may be chosen later, but a reply is not promised.'
      : 'Kept as fan mail. It is not in Cy\'s active reply queue.';
  }
  if (item.status === 'waiting') {
    return item.was_fan_mail
      ? 'Chosen from fan mail and now waiting for Cy.'
      : 'Received and waiting for Cy.';
  }
  if (item.status === 'replied' && item.was_fan_mail) return 'Chosen from fan mail, then replied to.';
  return '';
}

function make(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

export class PostcardArchive {
  constructor({ dialog, openButton, closeButton, filterRoot, list, status, moreButton, endpoint, fetchImpl = postcardArchiveFetch }) {
    this.dialog = dialog;
    this.openButton = openButton;
    this.closeButton = closeButton;
    this.filterRoot = filterRoot;
    this.list = list;
    this.status = status;
    this.moreButton = moreButton;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.filter = 'all';
    this.cursor = null;
    this.loading = false;
    this.controller = null;

    this.openButton.addEventListener('click', () => this.open());
    this.closeButton.addEventListener('click', () => this.close());
    this.moreButton.addEventListener('click', () => this.loadOlder());
    this.filterRoot.addEventListener('click', (event) => {
      const button = event.target.closest('[data-archive-filter]');
      if (!button) return;
      const next = String(button.dataset.archiveFilter || 'all');
      if (!POSTCARD_ARCHIVE_FILTERS.includes(next) || next === this.filter) return;
      this.filter = next;
      this._syncFilters();
      this.refresh();
    });
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close();
    });
  }

  open() {
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    this.refresh();
  }

  close() {
    if (this.controller) this.controller.abort();
    if (typeof this.dialog.close === 'function') this.dialog.close();
    else this.dialog.removeAttribute('open');
    this.openButton.focus();
  }

  _syncFilters() {
    for (const button of this.filterRoot.querySelectorAll('[data-archive-filter]')) {
      const active = button.dataset.archiveFilter === this.filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  refresh() {
    if (this.controller) this.controller.abort();
    this.list.replaceChildren();
    this.cursor = null;
    this.moreButton.hidden = true;
    this.status.textContent = 'Opening the archive...';
    return this._load(false);
  }

  loadOlder() {
    return this._load(true);
  }

  async _load(append) {
    if (this.loading && append) return;
    this.loading = true;
    this.moreButton.disabled = true;
    this.status.textContent = append ? 'Loading older postcards...' : 'Opening the archive...';
    const controller = new AbortController();
    this.controller = controller;
    try {
      const url = postcardArchiveUrl(this.endpoint, this.filter, append ? this.cursor : null);
      const response = await this.fetchImpl(url, { cache: 'no-store', signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `archive request failed (${response.status})`);
      if (controller !== this.controller) return;

      const items = Array.isArray(data.items) ? data.items : [];
      for (const item of items) this.list.appendChild(this._entry(item));
      const page = data.page || {};
      this.cursor = Number(page.next_cursor) > 0 ? Number(page.next_cursor) : null;
      this.moreButton.hidden = !page.has_more;
      this.status.textContent = this.list.children.length
        ? `${this.list.children.length} postcard${this.list.children.length === 1 ? '' : 's'} shown, newest first.`
        : 'No postcards match this view.';
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      this.status.textContent = error && error.message ? error.message : 'Could not open the archive.';
      if (!append) this.list.replaceChildren();
    } finally {
      if (controller === this.controller) {
        this.loading = false;
        this.moreButton.disabled = false;
      }
    }
  }

  _entry(item) {
    const article = make('article', `pcar-item status-${item.status || 'waiting'}`);
    const head = make('div', 'pcar-item-head');
    const sender = make('div', 'pcar-sender', item.from ? `from ${item.from}` : 'from anonymous');
    const badges = make('div', 'pcar-badges');
    if (item.your_postcard) badges.appendChild(make('span', 'pcar-own', 'YOUR POSTCARD'));
    if (item.was_fan_mail && item.status !== 'fan_mail') badges.appendChild(make('span', 'pcar-history-badge', 'CHOSEN FROM FAN MAIL'));
    badges.appendChild(make('span', 'pcar-status', item.status_label || 'RECEIVED'));
    head.append(sender, badges);
    article.appendChild(head);

    const exact = postcardExactTime(item.received_at);
    const age = postcardRelativeAge(item.received_at);
    article.appendChild(make('div', 'pcar-time', age ? `${exact} - ${age}` : exact));

    const content = make('div', 'pcar-content');
    if (item.image) {
      const image = make('img', 'pcar-image');
      image.loading = 'lazy';
      image.alt = 'picture attached to this postcard';
      image.src = item.image;
      content.appendChild(image);
      if (item.image_attrib) content.appendChild(make('div', 'pcar-attrib', item.image_attrib));
    } else if (item.has_image) {
      content.appendChild(make('div', 'pcar-attachment', 'PICTURE ATTACHED'));
    }
    if (item.body) content.appendChild(make('div', 'pcar-body', item.body));
    article.appendChild(content);

    const note = postcardStatusNote(item);
    if (note) article.appendChild(make('div', 'pcar-note', note));

    if (item.reply) {
      const reply = make('section', 'pcar-reply');
      const replyHead = make('div', 'pcar-reply-head');
      replyHead.appendChild(make('span', 'pcar-reply-label', '7734 REPLIED'));
      replyHead.appendChild(make('time', 'pcar-reply-time', postcardExactTime(item.reply.replied_at)));
      reply.append(replyHead, make('div', 'pcar-reply-body', item.reply.body || ''));
      article.appendChild(reply);
    } else if (item.status === 'replied') {
      article.appendChild(make('div', 'pcar-note', 'The reply record is unavailable.'));
    }
    return article;
  }
}
