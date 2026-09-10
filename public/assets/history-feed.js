// history-feed.js - bounded day replay over the public range endpoint.
//
// The server owns calendar boundaries. This client only follows the returned
// forward cursor until the selected day is exhausted, deduplicating by seq so a
// defensive overlapping page can never paint the same event twice.

export const NARRATIVE_KINDS = [
  'text', 'mode', 'gen', 'abort', 'silence', 'draw', 'postcard_in',
  'postcard_out', 'fan_mail_in', 'news_in', 'event', 'day',
];

export const SNAPSHOT_KINDS = [
  'vitals', 'host', 'power', 'tempo', 'capability', 'inference',
];

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''));
}

export function narrativeEventsForDate(events, date, kinds = NARRATIVE_KINDS) {
  if (!validDate(date)) return [];
  const allowed = new Set(kinds);
  return (events || []).filter((event) =>
    allowed.has(event && event.kind) && String((event && event.ts) || '').slice(0, 10) === date
  );
}

// A stream response can be capped while `now` points far beyond its final row.
// Advance only through events the client actually rendered, or the remaining
// capped rows are skipped forever on the next poll.
export function advanceStreamCursor(current, events) {
  let cursor = Number(current) || 0;
  for (const event of events || []) {
    const seq = Number(event && event.seq);
    if (Number.isFinite(seq) && seq > cursor) cursor = seq;
  }
  return cursor;
}

function endpoint(rangeUrl, params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') q.set(key, String(value));
  }
  return `${rangeUrl}?${q.toString()}`;
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`history range ${res.status}`);
  const data = await res.json();
  if (!data || data.ok === false || !Array.isArray(data.events)) {
    throw new Error('history range returned an invalid page');
  }
  return data;
}

export async function fetchDayPage({
  rangeUrl,
  date,
  after = null,
  before = null,
  kinds = NARRATIVE_KINDS,
  fetchImpl = fetch,
  limit = 500,
} = {}) {
  if (!validDate(date)) throw new Error('history date must be YYYY-MM-DD');
  if (!rangeUrl) throw new Error('history range URL is required');
  if (after != null && before != null) throw new Error('history page accepts after or before, not both');

  const data = await getJson(fetchImpl, endpoint(rangeUrl, {
    date,
    after,
    before,
    limit,
    kinds: kinds.join(','),
  }));
  const events = [...data.events].sort((a, b) => Number(a.seq) - Number(b.seq));
  const cursors = data.cursors || {};
  return {
    events,
    head: Number(data.now) || 0,
    firstSeq: events.length ? Number(events[0].seq) : null,
    lastSeq: events.length ? Number(events[events.length - 1].seq) : null,
    hasMoreBackward: !!cursors.has_more_backward,
    hasMoreForward: !!cursors.has_more_forward,
  };
}

export async function fetchDayEvents({
  rangeUrl,
  date,
  kinds = NARRATIVE_KINDS,
  fetchImpl = fetch,
  limit = 500,
  onPage = null,
} = {}) {
  if (!validDate(date)) throw new Error('history date must be YYYY-MM-DD');
  if (!rangeUrl) throw new Error('history range URL is required');

  const out = [];
  const seen = new Set();
  let after = 0;
  let head = 0;
  let pages = 0;

  while (true) {
    const data = await getJson(fetchImpl, endpoint(rangeUrl, {
      date,
      after,
      limit,
      kinds: kinds.join(','),
    }));
    pages++;
    head = Math.max(head, Number(data.now) || 0);

    for (const ev of data.events) {
      const seq = Number(ev && ev.seq);
      if (!Number.isFinite(seq) || seen.has(seq)) continue;
      seen.add(seq);
      out.push(ev);
    }
    if (typeof onPage === 'function') onPage(data.events, data);

    const cursors = data.cursors || {};
    const next = Number(cursors.next);
    if (!cursors.has_more_forward || !Number.isFinite(next) || next <= after) break;
    after = next;
    if (pages > 1000) throw new Error('history pagination did not terminate');
  }

  out.sort((a, b) => Number(a.seq) - Number(b.seq));
  return { events: out, head, pages };
}

export async function fetchDaySnapshot({
  rangeUrl,
  date,
  head = Number.MAX_SAFE_INTEGER,
  kinds = SNAPSHOT_KINDS,
  fetchImpl = fetch,
  limit = 500,
} = {}) {
  if (!validDate(date)) throw new Error('history date must be YYYY-MM-DD');
  const before = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Number(head) + 1));
  const data = await getJson(fetchImpl, endpoint(rangeUrl, {
    date,
    before,
    limit,
    kinds: kinds.join(','),
  }));
  return {
    events: data.events,
    // This snapshot was explicitly anchored to `head`. A newer server `now`
    // belongs to the next live poll and must not advance the stream cursor.
    head: Number(head) || 0,
  };
}
