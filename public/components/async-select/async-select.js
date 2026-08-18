// async-select - a framework-free <async-select> custom element.
//
// The idea: choosing a value is a REQUEST, not a fact. The control never lets
// the UI claim a value is set until the host's async `commit` confirms it. It
// distinguishes the authoritative (server-confirmed) value from the one the
// user just asked for while a round trip is in flight, and it stays honest
// through rejection, network failure, timeout, the user changing their mind
// mid-flight (supersede), and the value changing elsewhere (external change).
//
// It is deliberately dependency-free: one ES module, one stylesheet, a shadow
// root, standard ARIA. Theme it with CSS custom properties (see async-select.css)
// and ::part(). See README.md for the full API.

const CSS_HREF = new URL('./async-select.css', import.meta.url).href;

// Thrown from a commit() to signal a business rejection (server refused) rather
// than a transport failure. Carries a human reason and, optionally, the value
// the server considers authoritative (so the control reverts to the truth).
export class AsyncSelectRejection extends Error {
  constructor(reason, value) {
    super(reason || 'Change was rejected');
    this.name = 'AsyncSelectRejection';
    this.rejected = true;
    this.reason = reason || 'Change was rejected';
    if (arguments.length > 1) this.value = value;
  }
}

// Convenience so a host can `throw AsyncSelect.reject('not allowed')`.
export function reject(reason, value) {
  return arguments.length > 1
    ? new AsyncSelectRejection(reason, value)
    : new AsyncSelectRejection(reason);
}

const uid = (() => {
  let n = 0;
  return (p) => `${p}-${(++n).toString(36)}`;
})();

const template = document.createElement('template');
template.innerHTML = `
  <link rel="stylesheet" href="${CSS_HREF}">
  <div class="wrap" part="wrap">
    <button
      class="trigger"
      part="trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded="false"
      aria-autocomplete="none"
    >
      <span class="face" part="face">
        <span class="value" part="value"></span>
      </span>
      <span class="glyph" part="glyph" data-icon="chevron" aria-hidden="true"></span>
    </button>
    <!-- Interactive warning affordance: overlays the glyph slot in rejected/
         failed states only. Transparent hit area over the visible glyph; it adds
         no footprint, carries the reason as a tooltip, and is the retry control. -->
    <button class="action" part="action" type="button" tabindex="-1" hidden></button>
    <div class="listbox" part="listbox" role="listbox" tabindex="-1" hidden></div>
    <span class="desc"></span>
    <span class="live" aria-live="polite" role="status"></span>
    <span class="live-assertive" aria-live="assertive"></span>
  </div>
`;

export class AsyncSelect extends HTMLElement {
  static get observedAttributes() {
    return ['value', 'disabled', 'label', 'timeout', 'pending-delay', 'escalate-delay'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(template.content.cloneNode(true));

    this._trigger = root.querySelector('.trigger');
    this._valueEl = root.querySelector('.value');
    this._glyph = root.querySelector('.glyph');
    this._action = root.querySelector('.action');
    this._descEl = root.querySelector('.desc');
    this._listbox = root.querySelector('.listbox');
    this._live = root.querySelector('.live');
    this._liveAssertive = root.querySelector('.live-assertive');

    this._listbox.id = uid('as-listbox');
    this._trigger.setAttribute('aria-controls', this._listbox.id);
    this._descEl.id = uid('as-desc');
    this._trigger.setAttribute('aria-describedby', this._descEl.id);

    // Model ----------------------------------------------------------------
    this._options = [];
    this._confirmed = null;      // authoritative value
    this._requested = null;      // value asked for while pending/failed
    this._phase = 'idle';        // idle | pending | confirmed | rejected | failed
    this._statusMsg = '';
    this._commit = null;

    this._seq = 0;               // monotonic request id; guards stale responses
    this._req = null;            // { seq, value, controller, timers... }
    this._flashTimer = null;     // confirmed-tick fade
    this._extFlashTimer = null;  // external-change highlight

    this._open = false;
    this._activeIndex = -1;
    this._typeahead = '';
    this._typeaheadTimer = null;

    // Config (ms) ----------------------------------------------------------
    this._timeout = 10000;       // hard cap: past this, FAILED with retry
    this._pendingDelay = 150;    // below this latency, show no pending state
    this._escalateDelay = 3000;  // past this, "still trying" messaging

    // Bind handlers so add/removeEventListener pair up.
    this._onTriggerClick = this._onTriggerClick.bind(this);
    this._onTriggerKeydown = this._onTriggerKeydown.bind(this);
    this._onOptionClick = this._onOptionClick.bind(this);
    this._onOptionPointerMove = this._onOptionPointerMove.bind(this);
    this._onDocPointerDown = this._onDocPointerDown.bind(this);
    this._onAction = this._onAction.bind(this);
    this._onFocusOut = this._onFocusOut.bind(this);
  }

  connectedCallback() {
    // Adopt declarative <option> children as the simple, one-line-of-HTML case.
    if (!this._options.length) {
      const opts = this._optionsFromLightDom();
      if (opts.length) this._options = opts;
    }
    if (this._confirmed == null && this.hasAttribute('value')) {
      this._confirmed = this.getAttribute('value');
    }
    if (this._confirmed == null && this._options.length) {
      const first = this._options.find((o) => !o.disabled);
      this._confirmed = first ? first.value : this._options[0].value;
    }

    this._trigger.addEventListener('click', this._onTriggerClick);
    this._trigger.addEventListener('keydown', this._onTriggerKeydown);
    this._listbox.addEventListener('click', this._onOptionClick);
    this._listbox.addEventListener('pointermove', this._onOptionPointerMove);
    this._action.addEventListener('click', this._onAction);
    this.addEventListener('focusout', this._onFocusOut);

    if (!this.hasAttribute('role')) this.setAttribute('role', 'group');
    this._applyAccessibleName();
    this._renderOptions();
    this._render();
  }

  disconnectedCallback() {
    this._trigger.removeEventListener('click', this._onTriggerClick);
    this._trigger.removeEventListener('keydown', this._onTriggerKeydown);
    this._listbox.removeEventListener('click', this._onOptionClick);
    this._listbox.removeEventListener('pointermove', this._onOptionPointerMove);
    this._action.removeEventListener('click', this._onAction);
    this.removeEventListener('focusout', this._onFocusOut);
    document.removeEventListener('pointerdown', this._onDocPointerDown, true);
    this._clearRequestTimers();
    clearTimeout(this._flashTimer);
    clearTimeout(this._extFlashTimer);
    clearTimeout(this._typeaheadTimer);
  }

  attributeChangedCallback(name, _old, val) {
    switch (name) {
      case 'value':
        // Attribute-driven value change is an EXTERNAL (authoritative) update.
        if (val !== this._confirmed) this.setConfirmed(val);
        break;
      case 'disabled':
        this._render();
        break;
      case 'label':
        this._applyAccessibleName();
        break;
      case 'timeout':
        this._timeout = clampMs(val, this._timeout);
        break;
      case 'pending-delay':
        this._pendingDelay = clampMs(val, this._pendingDelay);
        break;
      case 'escalate-delay':
        this._escalateDelay = clampMs(val, this._escalateDelay);
        break;
    }
  }

  // === Public API ==========================================================

  get options() { return this._options.slice(); }
  set options(list) {
    this._options = normalizeOptions(list);
    if (this._confirmed != null && !this._optionByValue(this._confirmed)) {
      // Confirmed value no longer offered; keep it but it will render as-is.
    }
    this._renderOptions();
    this._render();
  }

  // The confirmed, authoritative value. Reading never returns a provisional one.
  get value() { return this._confirmed; }
  set value(v) { this.setConfirmed(v); }

  // The value the user is currently requesting (null when idle/settled).
  get requestedValue() { return this._phase === 'pending' || this._phase === 'failed' ? this._requested : null; }

  get phase() { return this._phase; }

  get commit() { return this._commit; }
  set commit(fn) { this._commit = typeof fn === 'function' ? fn : null; }

  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }

  // Initiate a change as if the user chose `value`. Public so a host can drive
  // it programmatically (and so the demo can script supersede/external cases).
  requestValue(value) {
    if (this.disabled) return;
    const opt = this._optionByValue(value);
    if (!opt) return;
    if (opt.disabled) {
      this._announce(`${opt.label} is not available.`, true);
      return;
    }

    // A LOCAL option needs no server confirmation - apply instantly. It also
    // supersedes any in-flight server request (the user's newer intent wins).
    if (opt.local) {
      this._supersedeInFlight();
      const previous = this._confirmed;
      this._confirmed = value;
      this._requested = null;
      this._phase = 'idle';
      this._statusMsg = '';
      this._reflectValueAttr();
      this._render();
      this._announce(`${this._labelOf(value)} selected.`);
      this._emit('confirmed', { value, previous, local: true });
      return;
    }

    // Already there and settled: nothing to do.
    if (value === this._confirmed && this._phase === 'idle') return;

    if (typeof this._commit !== 'function') {
      // No commit supplied: treat every server option as instantly confirmed
      // so the component is still usable in the trivial synchronous case.
      const previous = this._confirmed;
      this._confirmed = value;
      this._phase = 'idle';
      this._reflectValueAttr();
      this._render();
      this._announce(`${this._labelOf(value)} selected.`);
      this._emit('confirmed', { value, previous, local: false });
      return;
    }

    this._supersedeInFlight();

    const seq = ++this._seq;
    const controller = new AbortController();
    const previous = this._confirmed;
    const req = { seq, value, controller, pendingShown: false, escalated: false };
    this._req = req;
    this._requested = value;
    this._phase = 'pending';
    this._statusMsg = '';

    this._emit('change-requested', { value, previous });

    // Latency-aware: hold the pending affordance back until pendingDelay so a
    // fast round trip produces no flicker at all.
    req.pendingTimer = setTimeout(() => {
      req.pendingShown = true;
      this._render();
    }, this._pendingDelay);

    req.escalateTimer = setTimeout(() => {
      req.escalated = true;
      if (this._req === req) {
        this._render();
        this._announce('Still trying to save your change...');
      }
    }, this._escalateDelay);

    // Race the commit against a hard timeout. We both abort (for a well-behaved
    // commit that honours the signal) and reject the race (so a commit that
    // ignores the signal can't hang the control forever).
    const timeoutErr = { __asTimeout: true };
    const timeoutP = new Promise((_res, rej) => {
      req.timeoutTimer = setTimeout(() => {
        try { controller.abort('timeout'); } catch (_) { /* older engines */ }
        rej(timeoutErr);
      }, this._timeout);
    });

    this._render();

    Promise.race([
      Promise.resolve().then(() => this._commit(value, {
        signal: controller.signal,
        previous,
        requestedValue: value,
      })),
      timeoutP,
    ]).then(
      (result) => {
        if (seq !== this._seq) return; // superseded - ignore stale success
        this._clearRequestTimers();
        this._req = null;
        this._settleConfirmed(value, previous, result);
      },
      (err) => {
        if (seq !== this._seq) return; // superseded - ignore stale failure
        this._clearRequestTimers();
        this._req = null;
        if (err && err.__asTimeout) {
          this._settleFailed(value, previous, err, true);
        } else if (isRejection(err)) {
          this._settleRejected(value, previous, err);
        } else {
          this._settleFailed(value, previous, err, false);
        }
      }
    );
  }

  // Authoritative value changed for a reason other than this control's own
  // request (another tab, another user, the backend). Reconcile WITHOUT
  // stealing focus and without discarding an in-flight user intent.
  setConfirmed(value, opts = {}) {
    const previous = this._confirmed;
    this._confirmed = value;
    this._reflectValueAttr();

    if (this._phase === 'pending') {
      // Keep the user's in-flight request intact; just note the baseline moved.
      // If the resolution later reverts, it reverts to this new truth.
      if (value !== this._requested && opts.silent !== true) {
        this._announce(`Heads up: this changed to ${this._labelOf(value)} elsewhere.`);
      }
      this._renderOptions();
      this._render();
      if (previous !== value) {
        this._flashExternal();
        this._emit('externalchange', { value, previous, duringPending: true });
      }
      return;
    }

    // Idle/settled: adopt the new value quietly.
    this._requested = null;
    if (this._phase !== 'idle') this._phase = 'idle';
    this._statusMsg = '';
    this._renderOptions();
    this._render();
    if (previous !== value) {
      this._flashExternal();
      if (opts.silent !== true) this._announce(`Changed to ${this._labelOf(value)} elsewhere.`);
      this._emit('externalchange', { value, previous, duringPending: false });
    }
  }

  // Momentary highlight for an authoritative value that moved elsewhere - no
  // text, no layout change. The CSS transition is dropped under reduced motion.
  _flashExternal() {
    this.classList.remove('as-flash');
    // Force reflow so re-adding the class restarts the highlight if it repeats.
    void this.offsetWidth;
    this.classList.add('as-flash');
    clearTimeout(this._extFlashTimer);
    this._extFlashTimer = setTimeout(() => this.classList.remove('as-flash'), 700);
  }

  // === Settlement ==========================================================

  _settleConfirmed(requested, previous, result) {
    // Interpret the resolution:
    //   undefined / requested value      -> server agreed
    //   a different value                -> server settled on something else
    //   { value, reason, ok }            -> explicit form
    let finalValue = requested;
    let reason = null;
    let agreed = true;

    if (result && typeof result === 'object' && 'value' in result) {
      finalValue = result.value;
      if (result.reason) reason = result.reason;
      agreed = finalValue === requested && result.ok !== false;
    } else if (result !== undefined && result !== null) {
      finalValue = result;
      agreed = finalValue === requested;
    }

    this._confirmed = finalValue;
    this._requested = null;
    this._reflectValueAttr();

    if (agreed) {
      this._phase = 'confirmed';
      this._statusMsg = 'Saved';
      this._render();
      this._announce(`${this._labelOf(finalValue)} confirmed.`);
      this._emit('confirmed', { value: finalValue, previous, local: false });
      // Quiet success: hold the tick briefly, then settle to idle.
      const seqAtFlash = this._seq;
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => {
        if (this._phase === 'confirmed' && this._seq === seqAtFlash) {
          this._phase = 'idle';
          this._statusMsg = '';
          this._render();
        }
      }, 1400);
    } else {
      // Server returned a DIFFERENT value than requested: honest rejection.
      this._phase = 'rejected';
      this._statusMsg = reason || `Set to ${this._labelOf(finalValue)} instead`;
      this._render();
      this._announce(`Change not applied. ${this._statusMsg}`);
      this._emit('rejected', { requested, value: finalValue, reason: this._statusMsg });
    }
  }

  _settleRejected(requested, previous, err) {
    // Business rejection. Revert to authoritative truth (err.value if the server
    // corrected it, otherwise the value we came from).
    const revertTo = 'value' in err ? err.value : previous;
    this._confirmed = revertTo;
    this._requested = null;
    this._reflectValueAttr();
    this._phase = 'rejected';
    this._statusMsg = err.reason || 'Change was rejected';
    this._render();
    this._announce(`Change rejected. ${this._statusMsg}`);
    this._emit('rejected', { requested, value: revertTo, reason: this._statusMsg });
  }

  _settleFailed(requested, previous, err, isTimeout) {
    // Transport failure: NEVER silently revert. Keep the attempted value visible
    // and offer retry so the user knows their intent wasn't lost.
    this._requested = requested;
    this._phase = 'failed';
    this._statusMsg = isTimeout
      ? 'Timed out - not saved yet.'
      : 'Could not reach the server - not saved.';
    this._render();
    this._announce(`Change failed. ${this._statusMsg} Retry available.`, true);
    this._emit('failed', { requested, previous, error: err, timeout: !!isTimeout });
  }

  // === Interaction =========================================================

  _onTriggerClick() {
    if (this.disabled) return;
    this._open ? this._close() : this._openList();
  }

  // The warning glyph is the recovery affordance. In FAILED it retries the
  // attempted value; in REJECTED (nothing to retry) it re-opens the list so the
  // user can choose again. Keyboard-reachable; focus returns to the trigger.
  _onAction(e) {
    e.stopPropagation();
    if (this._phase === 'failed' && this._requested != null) {
      const v = this._requested;
      this.requestValue(v);
      this._trigger.focus();
    } else {
      this._trigger.focus();
      this._openList();
    }
  }

  _onTriggerKeydown(e) {
    if (this.disabled) return;
    const key = e.key;

    if (!this._open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        this._openList();
        return;
      }
      if (key === 'Home' || key === 'End') {
        e.preventDefault();
        this._openList();
        this._moveActive(key === 'Home' ? 'first' : 'last');
        return;
      }
      if (isPrintable(key)) {
        this._openList();
        this._typeaheadSearch(key);
        return;
      }
      return;
    }

    // Open.
    switch (key) {
      case 'ArrowDown': e.preventDefault(); this._moveActive('next'); break;
      case 'ArrowUp': e.preventDefault(); this._moveActive('prev'); break;
      case 'Home': e.preventDefault(); this._moveActive('first'); break;
      case 'End': e.preventDefault(); this._moveActive('last'); break;
      case 'Enter':
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        this._chooseActive();
        break;
      case 'Escape':
        e.preventDefault();
        this._close();
        break;
      case 'Tab':
        this._close(); // let focus move naturally
        break;
      default:
        if (isPrintable(key)) this._typeaheadSearch(key);
    }
  }

  _onOptionClick(e) {
    const el = e.target.closest('[role="option"]');
    if (!el || el.getAttribute('aria-disabled') === 'true') return;
    const idx = Number(el.dataset.index);
    this._activeIndex = idx;
    this._chooseActive();
  }

  _onOptionPointerMove(e) {
    const el = e.target.closest('[role="option"]');
    if (!el) return;
    const idx = Number(el.dataset.index);
    if (idx !== this._activeIndex && el.getAttribute('aria-disabled') !== 'true') {
      this._activeIndex = idx;
      this._syncActiveDescendant();
    }
  }

  _onDocPointerDown(e) {
    if (this._open && !e.composedPath().includes(this)) this._close();
  }

  _onFocusOut(e) {
    // Close if focus left the component entirely. Focus itself always lives on
    // the trigger, so state changes never move or steal it.
    if (this._open && !this.contains(e.relatedTarget) && e.relatedTarget !== this) {
      // relatedTarget may be null (blur to nothing) - close in that case too.
      if (!e.relatedTarget || !this._shadowContains(e.relatedTarget)) this._close();
    }
  }

  _shadowContains(node) {
    return this.shadowRoot && this.shadowRoot.contains(node);
  }

  _openList() {
    if (this._open || this.disabled) return;
    this._open = true;
    // Start active on the confirmed option (the authoritative one), not a
    // provisional request.
    const idx = this._indexOfValue(this._confirmed);
    this._activeIndex = idx >= 0 ? idx : this._firstEnabledIndex();
    this._listbox.hidden = false;
    this._trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', this._onDocPointerDown, true);
    this._syncActiveDescendant();
    this._scrollActiveIntoView();
  }

  _close() {
    if (!this._open) return;
    this._open = false;
    this._listbox.hidden = true;
    this._trigger.setAttribute('aria-expanded', 'false');
    this._trigger.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown', this._onDocPointerDown, true);
    this._clearActiveDescendant();
  }

  _chooseActive() {
    const opt = this._options[this._activeIndex];
    this._close();
    this._trigger.focus();
    if (opt && !opt.disabled) this.requestValue(opt.value);
  }

  _moveActive(where) {
    const n = this._options.length;
    if (!n) return;
    let i = this._activeIndex;
    const step = (from, dir) => {
      let j = from;
      for (let k = 0; k < n; k++) {
        j = (j + dir + n) % n;
        if (!this._options[j].disabled) return j;
      }
      return from;
    };
    if (where === 'first') i = this._firstEnabledIndex();
    else if (where === 'last') i = this._lastEnabledIndex();
    else if (where === 'next') i = i < 0 ? this._firstEnabledIndex() : step(i, +1);
    else if (where === 'prev') i = i < 0 ? this._lastEnabledIndex() : step(i, -1);
    this._activeIndex = i;
    this._syncActiveDescendant();
    this._scrollActiveIntoView();
  }

  _typeaheadSearch(ch) {
    clearTimeout(this._typeaheadTimer);
    this._typeahead += ch.toLowerCase();
    this._typeaheadTimer = setTimeout(() => { this._typeahead = ''; }, 600);
    const start = Math.max(0, this._activeIndex);
    const n = this._options.length;
    for (let k = 1; k <= n; k++) {
      const j = (start + k) % n;
      const o = this._options[j];
      if (o.disabled) continue;
      if (o.label.toLowerCase().startsWith(this._typeahead)) {
        this._activeIndex = j;
        if (!this._open) this._openList();
        this._syncActiveDescendant();
        this._scrollActiveIntoView();
        return;
      }
    }
  }

  // === Rendering ===========================================================

  _renderOptions() {
    const lb = this._listbox;
    lb.textContent = '';
    this._options.forEach((o, i) => {
      const el = document.createElement('div');
      el.setAttribute('role', 'option');
      el.id = `${this._listbox.id}-opt-${i}`;
      el.dataset.index = String(i);
      el.dataset.value = o.value;
      el.className = 'option';
      el.setAttribute('part', 'option');
      if (o.disabled) el.setAttribute('aria-disabled', 'true');

      const main = document.createElement('span');
      main.className = 'option-main';
      const lbl = document.createElement('span');
      lbl.className = 'option-label';
      lbl.textContent = o.label;
      main.appendChild(lbl);

      if (o.local) {
        const tag = document.createElement('span');
        tag.className = 'option-tag';
        tag.setAttribute('part', 'option-tag');
        tag.textContent = 'instant';
        main.appendChild(tag);
      }
      el.appendChild(main);

      if (o.description) {
        const desc = document.createElement('span');
        desc.className = 'option-desc';
        desc.setAttribute('part', 'option-desc');
        desc.textContent = o.description;
        el.appendChild(desc);
      }
      lb.appendChild(el);
    });
    this._syncSelectedFlags();
  }

  _syncSelectedFlags() {
    const nodes = this._listbox.querySelectorAll('[role="option"]');
    nodes.forEach((el) => {
      const v = el.dataset.value;
      el.setAttribute('aria-selected', v === this._confirmed ? 'true' : 'false');
      el.classList.toggle('is-confirmed', v === this._confirmed);
      el.classList.toggle('is-requested', this._phase === 'pending' && v === this._requested);
    });
  }

  _syncActiveDescendant() {
    const nodes = this._listbox.querySelectorAll('[role="option"]');
    nodes.forEach((el, i) => el.classList.toggle('is-active', i === this._activeIndex));
    const active = nodes[this._activeIndex];
    if (active) this._trigger.setAttribute('aria-activedescendant', active.id);
    else this._trigger.removeAttribute('aria-activedescendant');
  }

  _clearActiveDescendant() {
    this._listbox.querySelectorAll('.is-active').forEach((el) => el.classList.remove('is-active'));
  }

  _scrollActiveIntoView() {
    const active = this._listbox.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  _render() {
    const disabled = this.disabled;
    this._trigger.disabled = disabled;
    this.classList.toggle('is-disabled', disabled);

    // Which value does the FACE show?
    //   pending (shown)  -> the requested value, styled provisional
    //   failed           -> the attempted value, styled provisional
    //   everything else  -> the confirmed, authoritative value
    const pendingShown = this._phase === 'pending' && this._req && this._req.pendingShown;
    let faceValue = this._confirmed;
    if (pendingShown) faceValue = this._requested;
    else if (this._phase === 'failed') faceValue = this._requested;

    this._valueEl.textContent = this._labelOf(faceValue);

    // The face itself carries "not yet true" - dashed + italic, no word tag.
    const provisional = pendingShown || this._phase === 'failed';

    // Data-phase drives all styling; the visible pending state only turns on
    // once pendingShown is true (latency guard), so a fast trip shows nothing.
    const visualPhase =
      this._phase === 'pending' && !pendingShown ? 'idle' : this._phase;
    this.dataset.phase = visualPhase;
    this._trigger.classList.toggle('is-provisional', provisional);

    // A single glyph in the chevron slot expresses state. No status row, no
    // reserved space beneath: the control never exceeds the select's footprint.
    //   idle      -> chevron        confirmed -> tick (fades to idle)
    //   pending   -> spinner        rejected/failed -> warning
    let icon = 'chevron';
    if (visualPhase === 'pending') icon = 'spin';
    else if (visualPhase === 'confirmed') icon = 'ok';
    else if (visualPhase === 'rejected' || visualPhase === 'failed') icon = 'warn';
    this._glyph.dataset.icon = icon;
    // Escalation is expressed by INTENSIFYING the spinner glyph, not adding words.
    this._glyph.dataset.escalated =
      visualPhase === 'pending' && this._req && this._req.escalated ? 'true' : 'false';

    // Warning states: reason lives ONLY in a tooltip + the accessible
    // description + the live region - never as visible layout. The glyph
    // doubles as the clickable/keyboard-reachable recovery control.
    const warn = visualPhase === 'rejected' || visualPhase === 'failed';
    const canRetry = visualPhase === 'failed' && this._requested != null;
    if (warn) {
      const reason = this._statusMsg || (visualPhase === 'failed' ? 'Change failed' : 'Change rejected');
      const hint = canRetry ? ' Activate to retry.' : ' Activate to choose again.';
      this._action.hidden = false;
      this._action.tabIndex = 0;
      this._action.setAttribute('aria-label', reason + hint);
      this._action.title = reason + hint;
      this._trigger.title = reason;
      this._descEl.textContent = reason;
    } else {
      this._action.hidden = true;
      this._action.tabIndex = -1;
      this._action.removeAttribute('aria-label');
      this._action.removeAttribute('title');
      this._trigger.removeAttribute('title');
      // Pending has no visible words, but a screen reader focusing the control
      // mid-flight still learns a change is in progress via the description.
      if (visualPhase === 'pending') {
        this._descEl.textContent = this._requested !== this._confirmed
          ? `Saving ${this._labelOf(this._requested)}; currently ${this._labelOf(this._confirmed)}.`
          : `Saving ${this._labelOf(this._requested)}.`;
      } else {
        this._descEl.textContent = '';
      }
    }

    this._syncSelectedFlags();
    this._applyAccessibleName();
  }

  _applyAccessibleName() {
    // Announce the control's purpose + current authoritative value on the
    // combobox. Provisional state is conveyed via the live region, not by
    // mutating the name on every keystroke.
    const label = this.getAttribute('label') || this.getAttribute('aria-label') || 'Select';
    this._trigger.setAttribute('aria-label', `${label}: ${this._labelOf(this._confirmed)}`);
  }

  _announce(msg, assertive = false) {
    const region = assertive ? this._liveAssertive : this._live;
    // Clear then set on a microtask so repeated identical messages re-announce.
    region.textContent = '';
    region.textContent = msg;
  }

  // === Helpers =============================================================

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  _supersedeInFlight() {
    if (this._req) {
      const stale = this._req;
      this._clearRequestTimers();
      try { stale.controller.abort('superseded'); } catch (_) { /* noop */ }
      this._emit('superseded', { supersededValue: stale.value });
      this._req = null;
    }
    // Bumping seq guarantees any in-flight promise resolution is ignored even
    // if it never observed the abort (we don't rely on ordering).
    this._seq++;
  }

  _clearRequestTimers() {
    if (!this._req) return;
    clearTimeout(this._req.pendingTimer);
    clearTimeout(this._req.escalateTimer);
    clearTimeout(this._req.timeoutTimer);
  }

  _reflectValueAttr() {
    // Keep the value attribute in sync with the confirmed value without
    // re-triggering attributeChangedCallback's external-change path.
    if (this.getAttribute('value') !== this._confirmed && this._confirmed != null) {
      this._settingOwnAttr = true;
      this.setAttribute('value', this._confirmed);
      this._settingOwnAttr = false;
    }
  }

  _optionByValue(v) { return this._options.find((o) => o.value === v) || null; }
  _optionsFromLightDom() { return normalizeOptions(Array.from(this.querySelectorAll('option')).map(optFromNode)); }
  _indexOfValue(v) { return this._options.findIndex((o) => o.value === v); }
  _firstEnabledIndex() { return this._options.findIndex((o) => !o.disabled); }
  _lastEnabledIndex() {
    for (let i = this._options.length - 1; i >= 0; i--) if (!this._options[i].disabled) return i;
    return -1;
  }
  _labelOf(v) {
    const o = this._optionByValue(v);
    return o ? o.label : (v == null ? '' : String(v));
  }
}

// === module-scope helpers ==================================================

function normalizeOptions(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(Boolean)
    .map((o) => ({
      value: String(o.value),
      label: o.label != null ? String(o.label) : String(o.value),
      description: o.description ? String(o.description) : '',
      disabled: !!o.disabled,
      local: !!o.local,
    }));
}

function optFromNode(node) {
  return {
    value: node.getAttribute('value') != null ? node.getAttribute('value') : node.textContent.trim(),
    label: node.textContent.trim(),
    description: node.getAttribute('data-description') || '',
    disabled: node.hasAttribute('disabled'),
    local: node.hasAttribute('data-local'),
  };
}

function isRejection(err) {
  return !!err && (err instanceof AsyncSelectRejection || err.rejected === true);
}

function isPrintable(key) {
  return typeof key === 'string' && key.length === 1 && !!key.trim();
}

function clampMs(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

AsyncSelect.Rejection = AsyncSelectRejection;
AsyncSelect.reject = reject;

if (!customElements.get('async-select')) {
  customElements.define('async-select', AsyncSelect);
}

export default AsyncSelect;
