import { Router } from 'express';
import { authenticate, requireAuth } from '../auth/middleware';
import { parseId } from '../../shared/access-control';
import { getAlertsForProfessor, markAlertRead, markAllAlertsRead } from './service';

export const alertsRouter = Router();

alertsRouter.use(authenticate);

/**
 * GET /alerts
 * Returns alerts for classes the authenticated professor owns / teaches.
 * Optional query parameter: ?class_id=<uuid>
 */
alertsRouter.get('/', async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const classId = req.query.class_id ? parseId(req.query.class_id) : undefined;
    const alerts = await getAlertsForProfessor(user.id, classId);
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /alerts/:id/read
 * Mark an alert as read.
 */
alertsRouter.patch('/:id/read', async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const alertId = parseId(req.params.id);
    const alert = await markAlertRead(alertId, user.id);
    res.json({ alert });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /alerts/:id
 * Synonym for mark-as-read.
 */
alertsRouter.patch('/:id', async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const alertId = parseId(req.params.id);
    const alert = await markAlertRead(alertId, user.id);
    res.json({ alert });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /alerts/mark-all-read
 * Marks all alerts as read for the professor or class.
 */
alertsRouter.post('/mark-all-read', async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const classId = req.body?.class_id ? parseId(req.body.class_id) : undefined;
    const result = await markAllAlertsRead(user.id, classId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
