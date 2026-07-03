# Webhook Gateway (Node.js / Express)

Receives, verifies, deduplicates, and logs payment webhooks — the receiving
end of the HMAC-signed webhooks the PHP Payment Gateway Simulator sends out.

This is the **third service in a 3-language simulated payment ecosystem**:

```
[PHP Gateway] --HMAC-signed webhook--> [Node.js Webhook Gateway] (this project)
                                              |
                                        verify signature
                                              |
                                     Redis fast-path dedup
                                              |
                                     Postgres event log (audit trail)
```

Together with the PHP Payment Gateway Simulator and Java Settlement &
Reconciliation Microservice, these three form one coherent simulated
payment platform spanning charge creation → settlement → merchant
notification — not three disconnected toy apps.

## Why these design decisions

**Raw body is captured before JSON parsing.**
HMAC verification has to run against the *exact bytes* the sender signed.
If you `JSON.parse()` then re-`JSON.stringify()` the body before hashing,
key ordering or whitespace differences can silently produce a different
byte string and break every signature check. Express's `verify` hook on
`express.json()` captures `req.rawBody` before any parsing happens.

**Signature comparison uses `timingSafeEqual`, not `===`.**
A plain string/buffer comparison short-circuits on the first mismatched
byte, which leaks timing information an attacker could use to guess a
valid signature byte-by-byte. `crypto.timingSafeEqual` takes constant time
regardless of where the mismatch occurs.

**Invalid signatures are logged, not silently dropped.**
A request with a bad signature still gets written to the event log with
`signature_valid: false` before being rejected with 401. In a real gateway
you want visibility into spoofing/probing attempts against your webhook
endpoint, not just a silent 401 with zero trace.

**Dedup happens at two layers: Redis fast-path, then Postgres as source of truth.**
The PHP gateway's `DispatchWebhook` job retries failed deliveries up to 5
times with backoff — so this endpoint *will* receive the same webhook more
than once by design. A Redis `SET NX EX` check catches the common case
(redelivery within seconds) cheaply; the Postgres `event_id` unique
constraint is the actual source of truth if the Redis check ever misses
(e.g. after a Redis restart).

**Redis instance is shared with the PHP project, not a separate one.**
Deliberate infrastructure reuse — this project connects to the same Redis
container (port 6380) the PHP gateway already runs, namespacing its own
keys under `webhook_gw:` to avoid collisions. Demonstrates thinking about a
multi-service system as one environment rather than every service having
its own redundant infra.

## Stack

- Node.js, Express
- PostgreSQL (event log / audit trail)
- Redis (shared with the PHP Payment Gateway Simulator — reused, not duplicated)

## Local setup

```bash
cp .env.example .env
npm install
docker compose up -d          # starts this project's Postgres

# Make sure the PHP project's Redis (port 6380) is already running —
# either start the PHP project's docker-compose first, or run:
docker compose -f ../php-payment-gateway-simulator/docker-compose.yml up -d redis

npm run migrate               # creates the webhook_events table
npm run dev
```

Server runs on `http://localhost:3000`.

To connect this project's containers to the PHP project's Docker network so
they can resolve each other by container name instead of `localhost` ports:

```bash
docker network connect pgs_net webhook_postgres
```

## Wiring it to the PHP gateway end-to-end

1. Register this gateway as a webhook endpoint on the PHP project:
   ```bash
   curl -X POST http://localhost:8080/api/webhooks/endpoints \
     -H "X-Api-Key: sk_test_123" -H "Content-Type: application/json" \
     -d '{"url": "http://host.docker.internal:3000/api/webhooks/incoming"}'
   ```
2. Copy the returned `signing_secret` into this project's `.env` as
   `WEBHOOK_SIGNING_SECRET`.
3. Create a charge on the PHP gateway — once it succeeds/fails, this
   service should receive and log the webhook.

## Example requests

```bash
# Health check
curl http://localhost:3000/health

# View recent events
curl http://localhost:3000/api/events

# Filter by status
curl "http://localhost:3000/api/events?status=received"
```

## Next steps to extend

- [ ] Add outbound re-delivery to a downstream merchant-configured URL (currently this project only ingests + logs; it doesn't yet forward)
- [ ] Add exponential backoff retry queue for outbound forwarding (BullMQ + the shared Redis instance would fit naturally here)
- [ ] Add a small dashboard route that renders `webhook_events` as an HTML table for quick visual inspection
- [ ] Add integration test that spins up the PHP gateway + this service together and asserts an end-to-end signed delivery
