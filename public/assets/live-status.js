// live-status.js - small, testable facts for the deliberately unobtrusive live pill.

function eventTime(event) {
  const payloadTime = Number(event && event.payload && event.payload.t_ms);
  if (Number.isFinite(payloadTime) && payloadTime > 0) return payloadTime;
  const ts = event && event.ts;
  if (typeof ts !== 'string' || !ts) return NaN;
  return new Date(ts.replace(' ', 'T')).getTime();
}

export function newestLiveEventMs(events) {
  let newest = NaN;
  for (const event of events || []) {
    const time = eventTime(event);
    if (Number.isFinite(time) && (!Number.isFinite(newest) || time > newest)) newest = time;
  }
  return newest;
}

function formatWhen(ms) {
  if (!Number.isFinite(ms)) return 'no live update received';
  const date = new Date(ms);
  const p = (value) => String(value).padStart(2, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function liveStatusTitle(text, lastEventMs) {
  const update = formatWhen(lastEventMs);
  if (text === 'Live') return `Live. Last live update: ${update}.`;
  if (text === 'reconnecting') return `Reconnecting. Last live update: ${update}. Retrying automatically.`;
  return `${text}. Last live update: ${update}.`;
}
