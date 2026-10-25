import { Router, type Response } from 'express';
import {
  CONSENT_VERSION,
  googleSignInSchema,
  loginSchema,
  registerSchema,
  type AuthResponse,
  type ClientKind,
  type UserDTO,
} from '@notifeye/shared';
import { pool } from '../../db';
import { HttpError, parse } from '../../shared/errors';
import type { GoogleVerifier } from './google';
import { authenticate, requireAuth } from './middleware';
import { hashPassword, verifyPassword } from './passwords';
import { SESSION_COOKIE, sessionCookieOptions, signToken } from './tokens';

const USER_COLUMNS = 'id, email, name, consent_at';

/**
 * Dashboard clients get the session as an httpOnly cookie (token NOT in the body, so page scripts can
 * never read it). Extension clients get the bearer token in the body and keep it in chrome.storage.
 */
function respondWithSession(res: Response, user: UserDTO, client: ClientKind, status = 200): void {
  const token = signToken(user.id);
  const body: AuthResponse = { user };
  if (client === 'dashboard') {
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  } else {
    body.token = token;
  }
  res.status(status).json(body);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

interface Deps {
  googleVerifier?: GoogleVerifier;
  /** Rate limiter applied to register / login / google. */
  authLimiter: import('express').RequestHandler;
}

export function createAuthRouter({ googleVerifier, authLimiter }: Deps): Router {
  const router = Router();

  // Email + password, for everyone (dashboard and extension).
  router.post('/auth/register', authLimiter, async (req, res) => {
    const input = parse(registerSchema, req.body);
    if (!input.consent) {
      throw new HttpError(400, 'consent_required', 'You must accept the consent notice to create an account.');
    }
    const passwordHash = await hashPassword(input.password);
    try {
      const { rows } = await pool.query<UserDTO>(
        `INSERT INTO users (email, password_hash, name, consent_at, consent_version)
         VALUES ($1, $2, $3, now(), $4)
         RETURNING ${USER_COLUMNS}`,
        [input.email, passwordHash, input.name, CONSENT_VERSION],
      );
      respondWithSession(res, rows[0]!, input.client, 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
      throw err;
    }
  });

  router.post('/auth/login', authLimiter, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const { rows } = await pool.query<UserDTO & { password_hash: string | null }>(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE lower(email) = lower($1)`,
      [input.email],
    );
    const row = rows[0];
    // Same response (and similar timing) for unknown email, wrong password and Google-only accounts.
    const ok = await verifyPassword(input.password, row?.password_hash ?? null);
    if (!row || !ok) throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password.');
    const { password_hash: _omit, ...user } = row;
    respondWithSession(res, user, input.client);
  });

  // Google sign-in: DASHBOARD ONLY. The extension has no Google flow and gets no token from here.
  router.post('/auth/google', authLimiter, async (req, res) => {
    if (!googleVerifier) {
      throw new HttpError(501, 'google_sign_in_disabled', 'Google sign-in is not configured on this server.');
    }
    const input = parse(googleSignInSchema, req.body);

    let identity;
    try {
      identity = await googleVerifier(input.credential);
    } catch {
      throw new HttpError(401, 'google_token_invalid', 'Google sign-in failed. Please try again.');
    }
    if (!identity.emailVerified) {
      throw new HttpError(401, 'google_token_invalid', 'Your Google email address is not verified.');
    }

    // 1) Returning Google user.
    let found = await pool.query<UserDTO>(`SELECT ${USER_COLUMNS} FROM users WHERE google_sub = $1`, [identity.sub]);
    // 2) Existing password account with the same VERIFIED email: link it.
    if (!found.rows[0]) {
      found = await pool.query<UserDTO>(
        `UPDATE users SET google_sub = $1
          WHERE lower(email) = lower($2) AND google_sub IS NULL
          RETURNING ${USER_COLUMNS}`,
        [identity.sub, identity.email],
      );
    }
    if (found.rows[0]) {
      respondWithSession(res, found.rows[0], 'dashboard');
      return;
    }

    // 3) Brand-new account: consent is required (stored with a timestamp).
    if (!input.consent) {
      throw new HttpError(400, 'consent_required', 'You must accept the consent notice to create an account.');
    }
    try {
      const { rows } = await pool.query<UserDTO>(
        `INSERT INTO users (email, google_sub, name, consent_at, consent_version)
         VALUES ($1, $2, $3, now(), $4)
         RETURNING ${USER_COLUMNS}`,
        [identity.email, identity.sub, identity.name.slice(0, 100), CONSENT_VERSION],
      );
      respondWithSession(res, rows[0]!, 'dashboard', 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
      throw err;
    }
  });

  // Clearing a cookie is harmless, so logout needs no CSRF header. Extension "logout" is just
  // forgetting the token in chrome.storage.
  router.post('/auth/logout', (_req, res) => {
    const { maxAge: _maxAge, ...options } = sessionCookieOptions();
    res.clearCookie(SESSION_COOKIE, options);
    res.status(204).end();
  });

  router.get('/me', authenticate, (req, res) => {
    res.json({ user: requireAuth(req).user });
  });

  router.get('/me/schedule', authenticate, async (req, res) => {
    const { getStudentSchedule } = await import('../classes/service');
    const schedule = await getStudentSchedule(requireAuth(req).user.id);
    res.json({ schedule });
  });

  router.get('/me/data', authenticate, async (req, res, next) => {
    try {
      const { getUserDataExport } = await import('../privacy/service');
      const data = await getUserDataExport(requireAuth(req).user.id);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

