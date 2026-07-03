import crypto from 'crypto';
import { pool } from '../db/pool.js';

/**
 * Derives a stable event_id from the raw payload + signature so the exact
 * same redelivered webhook (PHP gateway retries up to 5 times on failure)
 * always maps to the same row instead of creating duplicates.
 */
function deriveEventId(rawBody, signature) {
  return crypto.createHash('sha256').update(rawBody + signature).digest('hex');
}

export async function recordEvent({ rawBody, signature, signatureValid, parsedPayload }) {
  const eventId = deriveEventId(rawBody, signature || '');

  const existing = await pool.query(
    'SELECT id, status FROM webhook_events WHERE event_id = $1',
    [eventId]
  );

  if (existing.rows.length > 0) {
    // Already seen this exact webhook delivery — treat as idempotent no-op.
    return { eventId, isDuplicate: true, row: existing.rows[0] };
  }

  const result = await pool.query(
    `INSERT INTO webhook_events (event_id, event_type, merchant_reference, payload, signature_valid, status)
     VALUES ($1, $2, $3, $4, $5, 'received')
     RETURNING id, event_id, status`,
    [
      eventId,
      parsedPayload?.event ?? 'unknown',
      parsedPayload?.data?.reference ?? null,
      parsedPayload ?? {},
      signatureValid,
    ]
  );

  return { eventId, isDuplicate: false, row: result.rows[0] };
}

export async function markDeliveryAttempt(eventId, status) {
  await pool.query(
    `UPDATE webhook_events
     SET status = $2, delivery_attempts = delivery_attempts + 1, last_attempt_at = now()
     WHERE event_id = $1`,
    [eventId, status]
  );
}
