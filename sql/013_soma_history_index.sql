-- Support bounded 1H/24H/7D Soma history reads from the existing event log.
ALTER TABLE events ADD INDEX idx_kind_ts (kind, ts);
