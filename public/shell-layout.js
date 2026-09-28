// Keep normal page flow below the fixed header even when its controls wrap.
export function syncTopbarHeight(topbar, root) {
  if (!topbar || !root || !root.style) return 0;
  const rect = topbar.getBoundingClientRect();
  const height = Math.max(0, Math.ceil(Number(rect.height) || 0));
  if (height > 0) root.style.setProperty('--cy-topbar-height', height + 'px');
  return height;
}

export function watchTopbar(topbar, root, browserWindow = window) {
  const sync = () => syncTopbarHeight(topbar, root);
  sync();

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(sync);
    observer.observe(topbar);
    return () => observer.disconnect();
  }

  browserWindow.addEventListener('resize', sync);
  browserWindow.addEventListener('load', sync, { once: true });
  return () => browserWindow.removeEventListener('resize', sync);
}

// The Soma column defaults to a compact width (see .layout in style.css) so
// the three-column instrument board fits comfortably. There is too much
// promoted content - four subsystems plus history charts - to read
// comfortably at that width, so a visitor can expand it for a session; the
// choice persists across reloads via localStorage, degrading silently to a
// non-persistent toggle if storage is unavailable (private browsing, etc.).
export const SOMA_EXPANDED_STORAGE_KEY = 'cy-soma-expanded';

function readStoredExpanded(storage) {
  try {
    return storage ? storage.getItem(SOMA_EXPANDED_STORAGE_KEY) === '1' : false;
  } catch {
    return false;
  }
}

function writeStoredExpanded(storage, expanded) {
  try {
    if (storage) storage.setItem(SOMA_EXPANDED_STORAGE_KEY, expanded ? '1' : '0');
  } catch {
    // Storage unavailable (private browsing, quota) - the toggle still works
    // for this page load, it just will not persist across reloads.
  }
}

export function initSomaExpandToggle(button, { layout = null, storage = null } = {}) {
  if (!button || !layout) return null;
  let expanded = readStoredExpanded(storage);
  const apply = () => {
    layout.classList.toggle('soma-expanded', expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'COLLAPSE' : 'EXPAND';
  };
  apply();
  const onClick = () => {
    expanded = !expanded;
    writeStoredExpanded(storage, expanded);
    apply();
  };
  button.addEventListener('click', onClick);
  return () => button.removeEventListener('click', onClick);
}

if (typeof document !== 'undefined') {
  const topbar = document.getElementById('topbar');
  if (topbar) watchTopbar(topbar, document.documentElement);

  const somaToggle = document.getElementById('soma-expand-toggle');
  const layout = document.querySelector('.layout');
  if (somaToggle && layout) {
    let storage = null;
    try { storage = window.localStorage; } catch { storage = null; }
    initSomaExpandToggle(somaToggle, { layout, storage });
  }
}
