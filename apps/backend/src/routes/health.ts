import { Router, Request, Response } from 'express';
import { db } from '../db';
import { sql } from 'drizzle-orm';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'chat-automation-backend' });
});

router.get('/ready', async (req: Request, res: Response) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ status: 'ok', service: 'chat-automation-backend', database: 'ok' });
  } catch (err: any) {
    res.status(503).json({
      status: 'error',
      error: { code: 'DB_UNAVAILABLE', message: err?.message || 'Database unavailable' },
    });
  }
});

export { router as healthRouter };
