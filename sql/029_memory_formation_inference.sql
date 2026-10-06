-- Separate sender-formation accounting; canonical memories and queue stay put.
CREATE TABLE IF NOT EXISTS memory_formation_inference_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  settings JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
INSERT IGNORE INTO memory_formation_inference_settings (id, settings) VALUES (1,
  '{"mode":"DEEPSEEK","concurrency":1,"requests_hour":20,"requests_day":100,"requests_month":1000,"gbp_hour":0.05,"gbp_day":0.25,"gbp_month":2}');
CREATE TABLE IF NOT EXISTS memory_formation_inference_settings_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  previous_settings JSON NOT NULL,
  settings JSON NOT NULL,
  changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS memory_formation_inference_attempts (
  request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  queue_id BIGINT UNSIGNED NOT NULL,
  claim_token CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  settled_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  mode VARCHAR(12) NOT NULL,
  provider VARCHAR(16) NULL,
  configured_model VARCHAR(160) NOT NULL,
  actual_model VARCHAR(160) NULL,
  status VARCHAR(24) NOT NULL,
  reason VARCHAR(64) NOT NULL,
  reserved_input_tokens INT UNSIGNED NOT NULL,
  reserved_output_tokens INT UNSIGNED NOT NULL,
  input_tokens INT UNSIGNED NULL,
  output_tokens INT UNSIGNED NULL,
  cached_tokens INT UNSIGNED NULL,
  uncached_tokens INT UNSIGNED NULL,
  estimated_gbp DECIMAL(16,10) NOT NULL DEFAULT 0,
  actual_gbp DECIMAL(16,10) NULL,
  pricing JSON NOT NULL,
  latency_ms BIGINT UNSIGNED NULL,
  decision VARCHAR(24) NULL,
  rejection_code VARCHAR(32) NULL,
  application_outcome VARCHAR(24) NULL,
  UNIQUE KEY memory_formation_inference_claim (claim_token),
  KEY memory_formation_inference_created (created_at),
  KEY memory_formation_inference_active (provider, settled_at),
  CONSTRAINT fk_memory_formation_inference_queue FOREIGN KEY (queue_id)
    REFERENCES autobiographical_memory_formation_queue(id)
) ENGINE=InnoDB;
