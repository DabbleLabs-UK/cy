-- Additive replay protection for runner deliveries. Apply before deploying
-- ingest.php support; the old runner continues to work without delivery IDs.
CREATE TABLE IF NOT EXISTS ingest_delivery_receipts (
    delivery_id BINARY(16) PRIMARY KEY,
    kind VARCHAR(24) NOT NULL,
    accepted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
