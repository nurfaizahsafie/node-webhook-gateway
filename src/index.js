import express from 'express';
import dotenv from 'dotenv';
import { webhookRouter } from './routes/webhooks.js';
import { eventsRouter } from './routes/events.js';
import { ensureRedisConnected } from './services/dedupCache.js';

dotenv.config();

const app = express();

// Capture the raw request body BEFORE JSON parsing — HMAC verification
// must run against the exact bytes the sender signed, not a
// re-serialized/re-ordered JSON.parse(...) + JSON.stringify(...) roundtrip,
// which can silently produce a different byte string and break every
// signature check.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

app.use('/api', webhookRouter);
app.use('/api', eventsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const port = process.env.PORT || 3000;

async function start() {
  await ensureRedisConnected();
  app.listen(port, () => {
    console.log(`Webhook Gateway listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
