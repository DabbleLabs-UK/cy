// timeline.js - pure presentation helpers for CY's chronological feed.
//
// These functions deliberately describe only facts present in the event stream.
// They do not infer an emotion or a mental event from generated prose.

export function formatDuration(seconds) {
  let left = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(left / 3600);
  left -= hours * 3600;
  const minutes = Math.floor(left / 60);
  const secs = left - minutes * 60;
  const parts = [];
  if (hours) parts.push(hours + 'h');
  if (minutes) parts.push(minutes + 'm');
  if (secs || !parts.length) parts.push(secs + 's');
  return parts.join(' ');
}

export function previousDate(date) {
  const m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('date must be YYYY-MM-DD');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  return d.toISOString().slice(0, 10);
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
  const m = String(ts || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
}

export function sinceLabel(ts, previousMs) {
  const now = timestampMs(ts);
  if (now == null || previousMs == null || now < previousMs) return '';
  return formatDuration((now - previousMs) / 1000) + ' since previous';
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
