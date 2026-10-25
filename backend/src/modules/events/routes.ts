import { Router } from 'express';
import { postEventsSchema } from '@notifeye/shared';
import { parse } from '../../shared/errors';
import { authenticate, requireAuth } from '../auth/middleware';
import { ingestEvents } from './service';

export function createEventsRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.post('/', async (req, res) => {
    const userId = requireAuth(req).user.id;
    const input = parse(postEventsSchema, req.body);
    const result = await ingestEvents(userId, input.events);
    res.status(201).json(result);
  });

  return router;
}
