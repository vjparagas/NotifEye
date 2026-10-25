import jwt from 'jsonwebtoken';
import type { CookieOptions } from 'express';
import { config } from '../../config';

export const SESSION_COOKIE = 'notifeye_session';

/** Required on state-changing requests that authenticate with the cookie (CSRF defence). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'NotifEye-Dashboard';

/** "12h", "30m", "7d", "45s" or plain seconds -> milliseconds. */
export function durationToMs(value: string): number {
  const m = /^(\d+)\s*([smhd]?)$/i.exec(value.trim());
  if (!m) throw new Error(`Invalid JWT_EXPIRES_IN: "${value}" (use e.g. 12h, 30m, 7d)`);
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}

const expiresInSeconds = Math.floor(durationToMs(config.JWT_EXPIRES_IN) / 1000);

export function signToken(userId: string): string {
  return jwt.sign({}, config.JWT_SECRET, { algorithm: 'HS256', subject: userId, expiresIn: expiresInSeconds });
}

/** Returns the user id, or null for any invalid/expired/forged token. */
export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** httpOnly: scripts (and XSS) can never read the dashboard session. */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction || config.COOKIE_SAMESITE === 'none',
    sameSite: config.COOKIE_SAMESITE,
    path: '/',
    maxAge: expiresInSeconds * 1000,
  };
}
