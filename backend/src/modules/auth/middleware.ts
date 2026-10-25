import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { UserDTO } from '@notifeye/shared';
import { config } from '../../config';
import { pool } from '../../db';
import { HttpError } from '../../shared/errors';
import { CSRF_HEADER, CSRF_HEADER_VALUE, SESSION_COOKIE, verifyToken } from './tokens';

export interface AuthContext {
  user: UserDTO;
  /** `cookie` = dashboard (httpOnly cookie), `bearer` = extension (Authorization header). */
  via: 'cookie' | 'bearer';
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Throws if the request is not authenticated; use inside handlers that sit behind `authenticate`. */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw new HttpError(401, 'unauthorized', 'Please sign in.');
  return req.auth;
}

/**
 * Authenticates a request from EITHER an `Authorization: Bearer` token (extension) OR the httpOnly
 * session cookie (dashboard). It re-reads the user from the database every time, so a deleted
 * account's token stops working immediately. It does not look at roles: those come from
 * enrollments, per class, in the access-control helpers.
 *
 * Cookie-authenticated requests are open to CSRF, so state-changing ones must also carry the custom
 * header (a cross-site page cannot send it without a CORS preflight, which the allow-list denies)
 * and, if the browser sent an Origin, it must be on the allow-list. Bearer requests are immune
 * (the browser never attaches the token automatically).
 */
export const authenticate: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  let token: string | undefined;
  let via: AuthContext['via'];

  if (header !== undefined) {
    // An Authorization header was supplied: it must be valid. Never silently fall back to the cookie.
    if (!/^Bearer\s+\S+$/i.test(header)) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    token = header.replace(/^Bearer\s+/i, '');
    via = 'bearer';
  } else {
    token = req.cookies?.[SESSION_COOKIE];
    via = 'cookie';
  }
  if (!token) throw new HttpError(401, 'unauthorized', 'Please sign in.');

  const userId = verifyToken(token);
  if (!userId) throw new HttpError(401, 'unauthorized', 'Your session has expired. Please sign in again.');

  if (via === 'cookie' && !SAFE_METHODS.has(req.method)) {
    const origin = req.headers.origin;
    const originOk = origin === undefined || config.corsOrigins.includes(origin);
    if (!originOk || req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
      throw new HttpError(403, 'csrf_check_failed', 'Request blocked by CSRF protection.');
    }
  }

  const { rows } = await pool.query<UserDTO>(
    'SELECT id, email, name, consent_at FROM users WHERE id = $1',
    [userId],
  );
  const user = rows[0];
  if (!user) throw new HttpError(401, 'unauthorized', 'Please sign in.');

  req.auth = { user, via };
  next();
};
