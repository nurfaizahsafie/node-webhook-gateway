import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * This connects to the SAME Redis instance the PHP Payment Gateway
 * Simulator uses (port 6380), reusing infrastructure across the two
 * services rather than spinning up a separate Redis just for this project.
 * Keys are namespaced under `webhook_gw:` to avoid colliding with the
 * PHP project's own keys (rate_limit:*, merchant:*, reconciliation:*).
 */
export const redisClient = createClient({ url: process.env.REDIS_URL });

redisClient.on('error', (err) => console.error('Redis Client Error', err));

let connected = false;
export async function ensureRedisConnected() {
  if (!connected) {
    await redisClient.connect();
    connected = true;
  }
}

const DEDUP_WINDOW_SECONDS = 300;

/**
 * Fast in-memory duplicate check ahead of the Postgres lookup — most
 * redelivered webhooks arrive within seconds of the original, so this
 * catches the common case cheaply before touching the DB at all.
 */
export async function isDuplicateEvent(eventId) {
  const key = `webhook_gw:seen:${eventId}`;
  const wasSet = await redisClient.set(key, '1', { NX: true, EX: DEDUP_WINDOW_SECONDS });
  return wasSet === null; // null means the key already existed
}
