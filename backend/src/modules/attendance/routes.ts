import { Router } from 'express';
import { overrideAttendanceSchema } from '@notifeye/shared';
import { parse } from '../../shared/errors';
import { parseId } from '../../shared/access-control';
import { authenticate, requireAuth } from '../auth/middleware';
import { getSessionAttendance, overrideAttendance, getAttendanceAudit } from './service';

export function createSessionsAttendanceRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/:id/attendance', async (req, res) => {
    const sessionId = parseId(req.params.id);
    const userId = requireAuth(req).user.id;
    const result = await getSessionAttendance(userId, sessionId);
    res.json(result);
  });

  return router;
}

export function createAttendanceRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.patch('/:id', async (req, res) => {
    const attendanceId = parseId(req.params.id);
    const userId = requireAuth(req).user.id;
    const input = parse(overrideAttendanceSchema, req.body);
    const attendance = await overrideAttendance(userId, attendanceId, input);
    res.json({ attendance });
  });

  router.get('/:id/audit', async (req, res) => {
    const attendanceId = parseId(req.params.id);
    const userId = requireAuth(req).user.id;
    const audit = await getAttendanceAudit(userId, attendanceId);
    res.json({ audit });
  });

  return router;
}
