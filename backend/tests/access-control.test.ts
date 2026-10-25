import { beforeEach, describe, expect, it } from 'vitest';
import type { ClassDetailDTO } from '@notifeye/shared';
import { createClass, join, makeApp, resetDb, signUp, type Client } from './helpers';

beforeEach(resetDb);

/** Two classes with their own professors and students, to prove nothing leaks between them. */
async function world() {
  const app = makeApp();
  const profA = await signUp(app, 'Prof A');
  const profB = await signUp(app, 'Prof B');
  const studentA = await signUp(app, 'Student A');
  const studentB = await signUp(app, 'Student B');
  const outsider = await signUp(app, 'Outsider');
  const classA = await createClass(profA, { name: 'Class A' });
  const classB = await createClass(profB, { name: 'Class B' });
  await join(studentA, classA.class_code!);
  await join(studentB, classB.class_code!);
  return { app, profA, profB, studentA, studentB, outsider, classA, classB };
}

async function enrollmentIdOf(prof: Client, cls: ClassDetailDTO, userId: string): Promise<string> {
  const res = await prof.get(`/classes/${cls.id}/enrollments`);
  return res.body.enrollments.find((e: { user_id: string }) => e.user_id === userId).id;
}

describe('cross-class access is denied', () => {
  it("professor A cannot see, list or modify class B (404, indistinguishable from 'no such class')", async () => {
    const w = await world();
    const eidB = await enrollmentIdOf(w.profB, w.classB, w.studentB.user.id);

    for (const res of [
      await w.profA.get(`/classes/${w.classB.id}`),
      await w.profA.get(`/classes/${w.classB.id}/enrollments`),
      await w.profA.patch(`/classes/${w.classB.id}/enrollments/${eidB}`, { status: 'approved' }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
    }

    // ...and it really did nothing: student B is still pending.
    const roster = await w.profB.get(`/classes/${w.classB.id}/enrollments`);
    expect(roster.body.enrollments.find((e: { id: string }) => e.id === eidB).status).toBe('pending');

    // The denial looks exactly like a class that does not exist.
    const missing = await w.profA.get('/classes/00000000-0000-4000-8000-000000000000');
    expect((await w.profA.get(`/classes/${w.classB.id}`)).body).toEqual(missing.body);
  });

  it('a student of class B cannot read class A, its roster, or approve anyone', async () => {
    const w = await world();
    const eidA = await enrollmentIdOf(w.profA, w.classA, w.studentA.user.id);

    expect((await w.studentB.get(`/classes/${w.classA.id}`)).status).toBe(404);
    expect((await w.studentB.get(`/classes/${w.classA.id}/enrollments`)).status).toBe(404);
    expect((await w.studentB.patch(`/classes/${w.classA.id}/enrollments/${eidA}`, { status: 'removed' })).status).toBe(404);
  });

  it('a student inside their OWN class is forbidden (403) from the professor-only endpoints', async () => {
    const w = await world();
    const eidA = await enrollmentIdOf(w.profA, w.classA, w.studentA.user.id);

    const roster = await w.studentA.get(`/classes/${w.classA.id}/enrollments`);
    expect(roster.status).toBe(403);
    expect(roster.body.error).toBe('forbidden');
    const approve = await w.studentA.patch(`/classes/${w.classA.id}/enrollments/${eidA}`, { status: 'approved' });
    expect(approve.status).toBe(403); // a student cannot approve themselves
  });

  it('a user with no relation to a class gets 404 everywhere', async () => {
    const w = await world();
    expect((await w.outsider.get(`/classes/${w.classA.id}`)).status).toBe(404);
    expect((await w.outsider.get(`/classes/${w.classA.id}/enrollments`)).status).toBe(404);
  });

  it('there is no global role: being a professor elsewhere grants nothing in a class where you are a student', async () => {
    const w = await world();
    // Prof A joins class B as a student.
    await join(w.profA, w.classB.class_code!);
    const eidB = await enrollmentIdOf(w.profB, w.classB, w.studentB.user.id);

    const roster = await w.profA.get(`/classes/${w.classB.id}/enrollments`);
    expect(roster.status).toBe(403); // member of B, but only as a student
    const approve = await w.profA.patch(`/classes/${w.classB.id}/enrollments/${eidB}`, { status: 'approved' });
    expect(approve.status).toBe(403);
    // ...while in their own class they are still the professor.
    expect((await w.profA.get(`/classes/${w.classA.id}/enrollments`)).status).toBe(200);
  });

  it('a pending student of class A cannot approve via an enrollment id from another class', async () => {
    const w = await world();
    const eidB = await enrollmentIdOf(w.profB, w.classB, w.studentB.user.id);
    // Prof A is a real professor of class A, but the enrollment belongs to class B.
    const res = await w.profA.patch(`/classes/${w.classA.id}/enrollments/${eidB}`, { status: 'approved' });
    expect(res.status).toBe(404);
    const roster = await w.profB.get(`/classes/${w.classB.id}/enrollments`);
    expect(roster.body.enrollments.find((e: { id: string }) => e.id === eidB).status).toBe('pending');
  });

  it("the class code is only shown to the class's professor, never to a student or an outsider", async () => {
    const w = await world();
    expect((await w.profA.get(`/classes/${w.classA.id}`)).body.class.class_code).toBe(w.classA.class_code);
    expect((await w.studentA.get(`/classes/${w.classA.id}`)).body.class.class_code).toBeNull();
    expect(JSON.stringify((await w.studentA.get('/classes')).body)).not.toContain(w.classA.class_code!);
  });

  it('malformed ids are a 404 (and never reach the database)', async () => {
    const w = await world();
    for (const path of ['/classes/not-a-uuid', "/classes/1'%20OR%20'1'='1", '/classes/123/enrollments']) {
      expect((await w.profA.get(path)).status).toBe(404);
    }
    expect((await w.profA.patch(`/classes/${w.classA.id}/enrollments/nope`, { status: 'approved' })).status).toBe(404);
  });

  it('requires authentication on every class endpoint', async () => {
    const w = await world();
    const { default: request } = await import('supertest');
    for (const [method, path] of [
      ['get', '/classes'],
      ['get', `/classes/${w.classA.id}`],
      ['get', `/classes/${w.classA.id}/enrollments`],
    ] as const) {
      expect((await request(w.app)[method](path)).status).toBe(401);
    }
  });
});

describe('professor roster management', () => {
  it('lists the roster, then approves and removes a student; a removed student loses access', async () => {
    const w = await world();
    const eid = await enrollmentIdOf(w.profA, w.classA, w.studentA.user.id);

    const roster = await w.profA.get(`/classes/${w.classA.id}/enrollments`);
    expect(roster.body.enrollments.map((e: { role: string }) => e.role)).toEqual(['professor', 'student']);
    expect(roster.body.enrollments[1]).toMatchObject({ name: 'Student A', status: 'pending' });
    expect(roster.body.enrollments[1].consent_at).not.toBeNull(); // consent recorded at join

    const approved = await w.profA.patch(`/classes/${w.classA.id}/enrollments/${eid}`, { status: 'approved' });
    expect(approved.status).toBe(200);
    expect(approved.body.enrollment.status).toBe('approved');
    expect((await w.studentA.get('/classes')).body.classes[0].status).toBe('approved');

    await w.profA.patch(`/classes/${w.classA.id}/enrollments/${eid}`, { status: 'removed' });
    expect((await w.studentA.get(`/classes/${w.classA.id}`)).status).toBe(404);
    expect((await w.studentA.get('/classes')).body.classes).toEqual([]);
  });

  it('cannot change a professor enrollment, and validates the status value', async () => {
    const w = await world();
    const profEid = await enrollmentIdOf(w.profA, w.classA, w.profA.user.id);
    expect((await w.profA.patch(`/classes/${w.classA.id}/enrollments/${profEid}`, { status: 'removed' })).status).toBe(404);

    const eid = await enrollmentIdOf(w.profA, w.classA, w.studentA.user.id);
    for (const status of ['pending', 'admin', '', undefined]) {
      const res = await w.profA.patch(`/classes/${w.classA.id}/enrollments/${eid}`, { status });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
  });
});
