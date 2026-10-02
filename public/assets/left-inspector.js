// Compact left-pane index. Existing Soma/memory DOM is moved, not copied, so
// its live bindings, history charts and nested diagnostic controls keep working.
const PROMOTED = [
  ['.soma-anxiety-promoted', 'ANXIETY', '.soma-state-value'],
  ['.soma-sleep-pressure-promoted', 'SLEEP PRESSURE', '.sleep-pressure-value'],
  ['.soma-satiety-promoted', 'SATIETY', '.soma-state-value'],
  ['.soma-harm-promoted', 'HARM', '.soma-state-value'],
];

export class LeftInspector {
  constructor(root, browserWindow = window) {
    this.root = root;
    this.browserWindow = browserWindow;
    this.items = [];
    this.active = null;
    this.nextId = 0;
    this.onKeyDown = (event) => {
      if (event.key !== 'Escape' || !this.active) return;
      const head = this.active.head;
      this.close();
      head.focus();
    };
    this.onPointerDown = (event) => {
      if (this.active && !this.active.wrapper.contains(event.target)) this.close();
    };
    this.onViewportChange = () => this.positionActive();
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('pointerdown', this.onPointerDown);
    browserWindow.addEventListener('resize', this.onViewportChange);
    browserWindow.addEventListener('scroll', this.onViewportChange, { passive: true });
    root.querySelector('.col-brain')?.addEventListener('scroll', this.onViewportChange, { passive: true });
    this.refresh();
  }

  refresh() {
    for (const item of this.items) if (!item.wrapper.isConnected) item.observer.disconnect();
    this.items = this.items.filter((item) => item.wrapper.isConnected);
    if (this.active && !this.active.wrapper.isConnected) this.active = null;
    const brain = this.root.querySelector('#brain');
    if (!brain) return;

    for (const [selector, label, valueSelector] of PROMOTED) {
      this.wrap(brain.querySelector(selector), label, valueSelector);
    }

    // Keep non-promoted readings inspectable without presenting them as peers
    // of the four current inner-state readings. Move the original DOM, not a
    // copy, so live values and the existing detail/history bindings survive.
    const legacy = brain.querySelector('.soma-legacy-quarantine');
    const readout = legacy?.querySelector('.soma-public-readout');
    if (readout) {
      let section = brain.querySelector('.cy-supporting-readings');
      if (!section) {
        section = document.createElement('details');
        section.className = 'cy-supporting-readings';
        const summary = document.createElement('summary');
        summary.textContent = 'SUPPORTING STATE / DIAGNOSTICS';
        const index = document.createElement('div');
        index.className = 'cy-other-readings';
        section.append(summary, index);
        brain.insertBefore(section, brain.querySelector('.soma-how-it-works-link'));
        section.addEventListener('toggle', () => {
          if (!section.open && this.active && section.contains(this.active.wrapper)) this.close();
        });
      }
      const index = section.querySelector('.cy-other-readings');
      for (const entry of [...readout.querySelectorAll(':scope > .soma-state-entry')]) {
        index.appendChild(entry);
        const label = entry.querySelector('.soma-state-label')?.textContent.trim() || entry.dataset.metric;
        this.wrap(entry, label, '.soma-state-value');
      }
      this.wrap(legacy, 'PREVIOUS MODELS / DIAGNOSTICS', null, 'PROVISIONAL');
      const legacyItem = legacy.closest('.cy-inspector-item');
      if (legacyItem && legacyItem.parentNode !== index) index.appendChild(legacyItem);
    } else {
      this.wrap(legacy, 'PREVIOUS MODELS / DIAGNOSTICS', null, 'PROVISIONAL');
    }

    this.wrap(this.root.querySelector('#memory'), 'AUTOBIOGRAPHICAL MEMORY', '.memory-status strong', 'MEMORY');
    this.wrap(this.root.querySelector('.world-inspection-panel'), 'CONTEXT / WORLD INSPECTION', null, 'ADMIN');
    document.body.classList.add('cy-left-inspector-ready');
  }

  wrap(content, label, valueSelector, fallback = '--') {
    if (!content || content.closest('.cy-inspector-item')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'cy-inspector-item';
    const id = `cy-inspector-body-${++this.nextId}`;
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'cy-inspector-head';
    head.title = label;
    head.id = `${id}-head`;
    head.setAttribute('aria-controls', id);
    head.setAttribute('aria-expanded', 'false');
    const name = document.createElement('span');
    name.className = 'cy-inspector-name';
    name.textContent = label;
    const value = document.createElement('strong');
    value.className = 'cy-inspector-value';
    head.append(name, value);
    const body = document.createElement('div');
    body.id = id;
    body.className = 'cy-inspector-body';
    body.setAttribute('role', 'region');
    body.setAttribute('aria-labelledby', head.id);
    body.hidden = true;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cy-inspector-close';
    close.textContent = 'CLOSE';
    close.setAttribute('aria-label', `Close ${label.toLowerCase()} details`);
    const parent = content.parentNode;
    parent.insertBefore(wrapper, content);
    body.append(close, content);
    wrapper.append(head, body);

    const item = { wrapper, head, body, content, value, valueSelector, fallback };
    const syncValue = () => {
      const reading = valueSelector && content.querySelector(valueSelector)?.textContent.trim();
      value.textContent = reading || fallback;
    };
    item.observer = new MutationObserver(syncValue);
    item.observer.observe(content, { childList: true, characterData: true, subtree: true });
    syncValue();
    head.addEventListener('click', () => this.select(item));
    close.addEventListener('click', () => {
      this.close();
      head.focus();
    });
    this.items.push(item);
  }

  select(item) {
    if (this.active === item) {
      this.close();
      return;
    }
    this.close();
    this.active = item;
    item.wrapper.classList.add('is-active');
    item.head.setAttribute('aria-expanded', 'true');
    item.body.hidden = false;
    // The existing details toggle is what requests stored history. It remains
    // inside the inspector, so no second chart-loading implementation is needed.
    if (item.content.tagName === 'DETAILS') item.content.open = true;
    else item.content.querySelector(':scope > .soma-anxiety-readout > details, :scope > .soma-satiety-readout > details, :scope > .soma-harm-readout > details')?.setAttribute('open', '');
    this.positionActive();
    this.browserWindow.requestAnimationFrame(() => this.positionActive());
  }

  close() {
    if (!this.active) return;
    this.active.wrapper.classList.remove('is-active');
    this.active.head.setAttribute('aria-expanded', 'false');
    this.active.body.hidden = true;
    this.active = null;
  }

  positionActive() {
    if (!this.active || this.browserWindow.innerWidth <= 1180) return;
    const rect = this.active.head.getBoundingClientRect();
    const headerBottom = this.root.querySelector('#topbar')?.getBoundingClientRect().bottom || 0;
    if (rect.bottom <= headerBottom || rect.top >= this.browserWindow.innerHeight) {
      this.close();
      return;
    }
    const layoutTop = this.root.querySelector('.layout')?.getBoundingClientRect().top ?? headerBottom;
    const usableTop = Math.max(14, headerBottom + 14, layoutTop + 14);
    // A nearby top row keeps its tab-like alignment. Lower rows no longer
    // sacrifice the panel's usable height just because their heads sit low.
    const panelTop = Math.max(usableTop, Math.min(rect.top, usableTop + 16));
    this.active.body.style.setProperty('--cy-inspector-left', `${Math.round(rect.right - 1)}px`);
    this.active.body.style.setProperty('--cy-inspector-top', `${Math.round(panelTop)}px`);
  }

  destroy() {
    this.close();
    for (const item of this.items) item.observer.disconnect();
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('pointerdown', this.onPointerDown);
    this.browserWindow.removeEventListener('resize', this.onViewportChange);
    this.browserWindow.removeEventListener('scroll', this.onViewportChange);
    this.root.querySelector('.col-brain')?.removeEventListener('scroll', this.onViewportChange);
  }
}
