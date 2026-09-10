-- 012_postcard_event_provenance.sql - restore delivery provenance in history.
--
-- The postcard table is authoritative for original posting time and whether a
-- reply item was promoted out of fan mail. Older runners omitted those fields
-- from postcard_in events, which made delayed mail look newly submitted.

UPDATE events e
JOIN postcards p
  ON p.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(e.payload, '$.id')) AS UNSIGNED)
SET e.payload = JSON_SET(
    e.payload,
    '$.promoted', IF(p.promoted_at IS NULL, 0, 1),
    '$.posted_at', CONCAT(DATE_FORMAT(p.posted_at, '%Y-%m-%dT%H:%i:%s'), 'Z')
)
WHERE e.kind = 'postcard_in';
