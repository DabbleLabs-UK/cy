// timeline.js - pure presentation helpers for CY's chronological feed.
//
// These functions deliberately describe only facts present in the event stream.
// They do not infer an emotion or a mental event from generated prose.

export function formatDuration(seconds) {
  let left = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(left / 86400);
  left -= days * 86400;
  const hours = Math.floor(left / 3600);
  left -= hours * 3600;
  const minutes = Math.floor(left / 60);
  const secs = left - minutes * 60;
  const parts = [];
  if (days) parts.push(days + 'd');
  if (hours) parts.push(hours + 'h');
  if (minutes) parts.push(minutes + 'm');
  if (secs || !parts.length) parts.push(secs + 's');
  return parts.join(' ');
}

export function shiftDate(date, days) {
  const m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('date must be YYYY-MM-DD');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(days || 0)));
  return d.toISOString().slice(0, 10);
}

export function previousDate(date) {
  return shiftDate(date, -1);
}

export function dayLabel(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return String(date || '');
  const d = new Date(date + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function clockOf(ts) {
  const m = String(ts || '').match(/(?:^|[ T])(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return '';
  return m[1] + ':' + m[2] + (m[3] ? ':' + m[3] : '');
}

export function timestampMs(ts) {
  const m = String(ts || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?/);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  let epoch = wall - londonOffsetAt(wall);
  epoch = wall - londonOffsetAt(epoch);
  return epoch + Number(String(m[7] || '').padEnd(3, '0') || 0);
}

export function endpointLabel(ts, nowMs = Date.now()) {
  const clock = clockOf(ts);
  const at = timestampMs(ts);
  if (!clock || at == null) return clock || '--:--:--';
  const ageSeconds = Math.max(0, Math.floor((Number(nowMs) - at) / 1000));
  return clock + ' (' + formatDuration(ageSeconds) + ')';
}

export function shiftTimestamp(ts, seconds) {
  const at = timestampMs(ts);
  if (at == null) return String(ts || '');
  return londonTimestamp(at + Number(seconds || 0) * 1000);
}

const endpointNodes = new Set();
const visibleEndpointNodes = new Set();
let endpointTimer = null;
let endpointObserver = null;

export function bindEndpointTime(el, ts, nowMs = Date.now()) {
  if (!el) return;
  const at = timestampMs(ts);
  const clock = clockOf(ts);
  el.textContent = endpointLabel(ts, nowMs);
  if (at == null || !el.dataset) return;
  el.dataset.cyEndpointMs = String(at);
  el.dataset.cyEndpointClock = clock;
  if (typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function') {
    if (endpointObserver === null) {
      endpointObserver = new window.IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visibleEndpointNodes.add(entry.target);
          else visibleEndpointNodes.delete(entry.target);
        }
      }, { rootMargin: '120px 0px' });
    }
    endpointObserver.observe(el);
  } else {
    endpointNodes.add(el);
  }
  if (typeof window !== 'undefined' && endpointTimer === null) {
    endpointTimer = setInterval(() => refreshEndpointTimes(), 1000);
    if (endpointTimer && typeof endpointTimer.unref === 'function') endpointTimer.unref();
  }
}

export function refreshEndpointTimes(nowMs = Date.now()) {
  const nodes = endpointObserver === null ? endpointNodes : visibleEndpointNodes;
  for (const el of nodes) {
    if (el.isConnected === false) {
      nodes.delete(el);
      if (endpointObserver) endpointObserver.unobserve(el);
      continue;
    }
    const at = Number(el.dataset && el.dataset.cyEndpointMs);
    const clock = el.dataset && el.dataset.cyEndpointClock;
    if (!Number.isFinite(at) || !clock) continue;
    const ageSeconds = Math.max(0, Math.floor((Number(nowMs) - at) / 1000));
    el.textContent = clock + ' (' + formatDuration(ageSeconds) + ')';
  }
}

const londonFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function londonPartsAt(ms) {
  const out = {};
  for (const part of londonFormatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out;
}

function londonOffsetAt(ms) {
  const p = londonPartsAt(ms);
  const rounded = Math.floor(ms / 1000) * 1000;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - rounded;
}

function londonTimestamp(ms) {
  const p = londonPartsAt(ms);
  return [
    String(p.year).padStart(4, '0'), '-',
    String(p.month).padStart(2, '0'), '-',
    String(p.day).padStart(2, '0'), ' ',
    String(p.hour).padStart(2, '0'), ':',
    String(p.minute).padStart(2, '0'), ':',
    String(p.second).padStart(2, '0'),
  ].join('');
}

export function ambientEventLabel(payload) {
  const p = payload || {};
  const name = String(p.name || '');
  if (!name || ['provider', 'provider_refused', 'regime'].includes(name)) return '';
  if (name === 'social') {
    const who = p.who || 'someone';
    const grudge = p.standing && Number(p.standing.grudge);
    return grudge > 0.7 ? 'bad blood with ' + who : who + ' on the spur';
  }
  if (name === 'officer') {
    const who = p.who || 'an officer';
    const grudge = p.standing && Number(p.standing.grudge);
    return grudge > 0.7 ? 'bad blood with ' + who : who + ' on the wing';
  }
  if (name === 'overheard') {
    return p.misheard ? 'something half-heard, and he thinks it is about him' : 'something half-heard down the wing';
  }
  const labels = {
    letter_arrives: p.from ? 'mail from ' + p.from : 'mail arrives',
    letter_hostile: 'hostile mail arrives',
    image_arrives: p.caption ? 'an image arrives: ' + p.caption : 'an image arrives',
    news_arrives: p.headline ? 'news arrives: ' + p.headline : 'news arrives',
    warden: 'a notice from Warden Florian',
    meal: 'a meal arrives',
    lights_out: 'lights out',
    lights_on: 'lights on',
    noise_night: 'noise in the night',
    injury: 'an injury',
    cell_search: 'the cell is searched',
    no_mail_24h: 'no mail for 24 hours',
    no_eggs: 'no eggs on the tray',
    cold_tea: 'the tea came cold',
    delayed_unlock: 'unlock came late',
    assoc_cancelled: 'association was cancelled',
    lockdown: 'the wing went into lockdown',
  };
  return labels[name] || name.replace(/_/g, ' ');
}
