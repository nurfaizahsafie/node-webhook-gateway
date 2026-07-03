import crypto from 'crypto';

/**
 * Verifies the X-Signature header against an HMAC-SHA256 of the raw request
 * body, using the shared signing secret from the PHP Gateway's webhook
 * endpoint registration.
 *
 * Uses timingSafeEqual instead of a plain string comparison to avoid
 * leaking timing information about how much of the signature matched —
 * the standard defense against timing attacks on HMAC comparisons.
 *
 * Requests with an invalid signature are NOT rejected outright; they're
 * logged into the event log with `signature_valid: false` so bad actors
 * probing the endpoint are visible in the audit trail, then rejected with
 * 401. This mirrors how you'd want visibility into spoofing attempts in a
 * real gateway rather than a silent 401 with no trace.
 */
export function verifySignature(signingSecret) {
  return (req, res, next) => {
    const signature = req.get('X-Signature');
    const rawBody = req.rawBody;

    if (!signature || !rawBody) {
      return res.status(401).json({ error: 'Missing signature or body' });
    }

    const expected = crypto
      .createHmac('sha256', signingSecret)
      .update(rawBody)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    const isValid =
      signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    req.signatureValid = isValid;
    next();
  };
}
