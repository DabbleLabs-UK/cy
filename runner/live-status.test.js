import assert from 'node:assert/strict';
import { liveStatusTitle, newestLiveEventMs } from '../public/assets/live-status.js';

assert.equal(newestLiveEventMs([
  { ts: '2026-09-15 04:02:00.000' },
  { ts: '2026-09-15 04:03:00.000' },
]), new Date('2026-09-15T04:03:00.000').getTime());

assert.equal(newestLiveEventMs([
  { ts: '2026-09-15 04:02:00.000', payload: { t_ms: 1789444980000 } },
]), 1789444980000, 'measured time wins over ingest time for meter events');

assert.match(liveStatusTitle('Live', new Date('2026-09-15T17:35:41').getTime()),
  /^Live\. Last live update: 17:35:41\.$/);
assert.match(liveStatusTitle('reconnecting', NaN),
  /^Reconnecting\. Last live update: no live update received\. Retrying automatically\.$/);

console.log('live-status.test.js: all checks passed');
