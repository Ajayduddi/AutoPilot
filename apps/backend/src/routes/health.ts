import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'chat-automation-backend' });
});

export { router as healthRouter };
