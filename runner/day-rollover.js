import { createHash } from 'node:crypto';

const LONDON_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function initialRolloverDate(persistedLastRolloverDate, nowDate) {
  return LONDON_DATE_RE.test(String(persistedLastRolloverDate || '')) ? persistedLastRolloverDate : nowDate;
}

export function applyDayRollover(vitals, date) {
  vitals.day = (vitals.day || 1) + 1;
  vitals.lastRolloverDate = date;
  return vitals.day;
}

// One logical transition has one identity even if a checkpoint is restored and
// the event has to be enqueued again. Ingest receipts remain the final authority
// for whether that identified delivery was already committed.
export function dayRolloverDeliveryId(date) {
  if (!LONDON_DATE_RE.test(String(date))) throw new Error('invalid day rollover date');
  const hex = createHash('sha256').update(`cy:day-rollover:v1:${date}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function pendingDayRollovers(vitals) {
  return Array.isArray(vitals.pendingDayRollovers) ? vitals.pendingDayRollovers : [];
}

// Stage in the same persisted state as day/lastRolloverDate. The staged event
// is a tiny outbox: it is never sent until that coherent checkpoint commits.
export function stageDayRollover(vitals, date, ts) {
  const existing = pendingDayRollovers(vitals).find((event) => event.payload?.date === date);
  if (existing) return existing;
  if (vitals.lastRolloverDate === date) return null;
  const n = applyDayRollover(vitals, date);
  const event = { kind: 'day', ts, payload: { n, date }, delivery_id: dayRolloverDeliveryId(date) };
  vitals.pendingDayRollovers = [...pendingDayRollovers(vitals), event];
  return event;
}

export async function persistDayRollover(vitals, date, ts, checkpoint, enqueue) {
  const event = stageDayRollover(vitals, date, ts);
  await checkpoint();
  if (event) enqueue(event);
  return event;
}

export function acknowledgeDayRollovers(vitals, delivered) {
  const ids = new Set(delivered.filter((event) => event.kind === 'day').map((event) => event.delivery_id));
  if (!ids.size) return false;
  const pending = pendingDayRollovers(vitals);
  const remaining = pending.filter((event) => !ids.has(event.delivery_id));
  if (remaining.length === pending.length) return false;
  vitals.pendingDayRollovers = remaining;
  return true;
}
