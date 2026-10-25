import { Router, type RequestHandler } from 'express';
import { createClassSchema, joinClassSchema, updateEnrollmentSchema } from '@notifeye/shared';
import { HttpError, parse } from '../../shared/errors';
import { parseId, requireMember, requireProfessor } from '../../shared/access-control';
import { authenticate, requireAuth } from '../auth/middleware';
import {
  createClass,
  getClassDetail,
  joinClass,
  listEnrollments,
  listMyClasses,
  updateStudentEnrollment,
} from './service';

interface Deps {
  /** Rate limiter for POST /classes/join (runs AFTER authenticate, keyed per user). */
  joinLimiter: RequestHandler;
}

export function createClassesRouter({ joinLimiter }: Deps): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', async (req, res) => {
    res.json({ classes: await listMyClasses(requireAuth(req).user.id) });
  });

  // Any signed-in user can create a class; they become the professor of THAT class only.
  router.post('/', async (req, res) => {
    const input = parse(createClassSchema, req.body);
    res.status(201).json({ class: await createClass(requireAuth(req).user.id, input) });
  });

  // Declared before /:id so "join" is never treated as an id. (Router is mounted at /classes.)
  router.post('/join', joinLimiter, async (req, res) => {
    const input = parse(joinClassSchema, req.body);
    if (!input.consent) {
      throw new HttpError(400, 'consent_required', 'You must accept the consent notice to join a class.');
    }
    const result = await joinClass(requireAuth(req).user.id, input.class_code);
    res.status(result.created ? 201 : 200).json({ class: result.class });
  });

  router.get('/:id', async (req, res) => {
    const userId = requireAuth(req).user.id;
    const classId = parseId(req.params.id);
    await requireMember(userId, classId);
    const detail = await getClassDetail(userId, classId);
    if (!detail) throw new HttpError(404, 'not_found', 'Not found');
    res.json({ class: detail });
  });

  router.get('/:id/enrollments', async (req, res) => {
    const classId = parseId(req.params.id);
    await requireProfessor(requireAuth(req).user.id, classId);
    res.json({ enrollments: await listEnrollments(classId) });
  });

  router.patch('/:id/enrollments/:eid', async (req, res) => {
    const classId = parseId(req.params.id);
    const enrollmentId = parseId(req.params.eid);
    await requireProfessor(requireAuth(req).user.id, classId);
    const input = parse(updateEnrollmentSchema, req.body);
    res.json({ enrollment: await updateStudentEnrollment(classId, enrollmentId, input) });
  });

  return router;
}
