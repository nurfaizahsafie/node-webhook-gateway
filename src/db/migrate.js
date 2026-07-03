import { pool } from './pool.js';

/**
 * Event log schema. `event_id` is a hash of the raw payload + signature,
 * used to dedupe redelivered webhooks (the PHP gateway retries failed
 * webhook jobs up to 5 times — this table is what makes those retries
 * safe to receive without double-processing on this side too).
 */
const SQL = `
CREATE TABLE IF NOT EXISTS webhook_events (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(64) UNIQUE NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  merchant_reference VARCHAR(64),
  payload JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'received', -- received | delivered | failed
  delivery_attempts INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_type ON webhook_events(event_type);
`;

async function migrate() {
  await pool.query(SQL);
  console.log('Migration complete: webhook_events table ready.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
