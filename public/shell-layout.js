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

if (typeof document !== 'undefined') {
  const topbar = document.getElementById('topbar');
  if (topbar) watchTopbar(topbar, document.documentElement);
}
