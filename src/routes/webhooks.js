import { Router } from 'express';
import { verifySignature } from '../middleware/verifySignature.js';
import { recordEvent } from '../services/eventLog.js';
import { isDuplicateEvent } from '../services/dedupCache.js';

const signingSecret = process.env.WEBHOOK_SIGNING_SECRET;

export const webhookRouter = Router();

/**
 * Receives webhooks dispatched by the PHP Payment Gateway Simulator's
 * DispatchWebhook job. Flow:
 *   1. Verify HMAC signature (middleware) — flag but don't hard-block invalid ones
 *   2. Redis fast-path dedup check
 *   3. Postgres event log write (source of truth, also catches dedup misses)
 *   4. 200 OK back to the sender
 *
 * Returning 200 quickly matters here — this endpoint IS the thing the PHP
 * gateway's Guzzle client is waiting on inside a queued job with retry/backoff.
 */
webhookRouter.post('/webhooks/incoming', verifySignature(signingSecret), async (req, res) => {
  const rawBody = req.rawBody;
  const signature = req.get('X-Signature');
  let parsedPayload;

  try {
    parsedPayload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  if (!req.signatureValid) {
    // Still logged for audit visibility, but rejected.
    await recordEvent({ rawBody, signature, signatureValid: false, parsedPayload });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const eventIdCandidate = `${rawBody}${signature}`;
  const duplicate = await isDuplicateEvent(eventIdCandidate).catch(() => false);

  const { isDuplicate } = await recordEvent({
    rawBody,
    signature,
    signatureValid: true,
    parsedPayload,
  });

  if (duplicate || isDuplicate) {
    return res.status(200).json({ status: 'duplicate_ignored' });
  }

  return res.status(200).json({ status: 'received' });
});
