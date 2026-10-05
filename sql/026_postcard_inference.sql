-- Additive postcard-only routing, reservations and immutable attempt accounting.
CREATE TABLE IF NOT EXISTS postcard_inference_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  settings JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
INSERT IGNORE INTO postcard_inference_settings (id, settings) VALUES (1,
  '{"enabled":true,"route":"AUTO","concurrency":1,"requests_hour":20,"requests_day":100,"requests_month":1000,"gbp_hour":0.10,"gbp_day":1,"gbp_month":5}');
CREATE TABLE IF NOT EXISTS postcard_inference_settings_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  previous_settings JSON NOT NULL,
  settings JSON NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS postcard_inference_turns (
  postcard_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  route VARCHAR(12) NOT NULL,
  provider VARCHAR(16) NULL,
  model VARCHAR(120) NULL,
  status VARCHAR(32) NOT NULL,
  reason VARCHAR(64) NOT NULL,
  fallback_reason VARCHAR(64) NULL,
  publication_result VARCHAR(24) NULL,
  publication_event_id BIGINT UNSIGNED NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS postcard_inference_attempts (
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  postcard_id BIGINT UNSIGNED NOT NULL,
  attempt VARCHAR(12) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  settled_at DATETIME(3) NULL,
  provider VARCHAR(16) NOT NULL,
  model VARCHAR(120) NOT NULL,
  route VARCHAR(12) NOT NULL,
  status VARCHAR(32) NOT NULL,
  input_tokens INT UNSIGNED NULL,
  output_tokens INT UNSIGNED NULL,
  cached_tokens INT UNSIGNED NULL,
  uncached_tokens INT UNSIGNED NULL,
  estimated_gbp DECIMAL(16,10) NOT NULL DEFAULT 0,
  actual_gbp DECIMAL(16,10) NULL,
  pricing JSON NOT NULL,
  latency_ms BIGINT UNSIGNED NULL,
  validation_failure TINYINT(1) NOT NULL DEFAULT 0,
  provider_error VARCHAR(64) NULL,
  UNIQUE KEY postcard_attempt (postcard_id, provider, attempt),
  KEY attempts_created (created_at),
  KEY attempts_active (provider, settled_at)
) ENGINE=InnoDB;
