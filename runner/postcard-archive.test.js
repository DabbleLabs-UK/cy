import assert from 'node:assert/strict';
import {
  postcardArchiveUrl,
  postcardRelativeAge,
  postcardStatusNote,
} from '../public/assets/postcard-archive.js';

const url = postcardArchiveUrl('/api/postcard-archive.php', 'waiting', 72, 20);
assert.equal(url, '/api/postcard-archive.php?status=waiting&limit=20&cursor=72');
assert.equal(
  postcardArchiveUrl('/api/postcard-archive.php?111', 'made_up', null, 10),
  '/api/postcard-archive.php?111&status=all&limit=10',
);

const now = Date.parse('2026-09-10T19:00:00Z');
assert.equal(postcardRelativeAge('2026-09-10T18:59:40Z', now), 'received just now');
assert.equal(postcardRelativeAge('2026-09-10T18:46:00Z', now), 'received 14 minutes ago');
assert.equal(postcardRelativeAge('2026-09-09T18:30:00Z', now), 'received yesterday');

assert.equal(
  postcardStatusNote({ status: 'fan_mail', fan_mail_may_reply: true }),
  'Kept as fan mail. It may be chosen later, but a reply is not promised.',
);
assert.equal(
  postcardStatusNote({ status: 'fan_mail', fan_mail_may_reply: false }),
  "Kept as fan mail. It is not in Cy's active reply queue.",
);
assert.equal(
  postcardStatusNote({ status: 'waiting', was_fan_mail: true }),
  'Chosen from fan mail and now waiting for Cy.',
);
assert.equal(
  postcardStatusNote({ status: 'not_delivered' }),
  'This postcard was screened out and did not reach Cy.',
);

console.log('postcard-archive.test.js: all checks passed');
