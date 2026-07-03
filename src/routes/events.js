import { Router } from 'express';
import { pool } from '../db/pool.js';

export const eventsRouter = Router();

eventsRouter.get('/events', async (req, res) => {
  const { status, event_type: eventType } = req.query;

  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (eventType) {
    params.push(eventType);
    conditions.push(`event_type = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT event_id, event_type, merchant_reference, signature_valid, status, delivery_attempts, created_at
     FROM webhook_events ${where}
     ORDER BY created_at DESC
     LIMIT 100`,
    params
  );

  res.json(result.rows);
});
