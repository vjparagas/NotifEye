import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { config } from './config';
import { pool } from './db';
import { errorHandler, notFoundHandler } from './shared/errors';
import { createGoogleVerifier, type GoogleVerifier } from './modules/auth/google';
import { createAuthRouter } from './modules/auth/routes';
import { createClassesRouter } from './modules/classes/routes';
import { createEventsRouter } from './modules/events/routes';

interface LimitOptions {
  limit: number;
  windowMs: number;
}

export interface AppOptions {
  /**
   * Google ID-token verifier. Defaults to the real one when GOOGLE_CLIENT_ID is set. Pass `null` to
   * force "Google sign-in disabled"; tests pass a stub so no network or real account is needed.
   */
  googleVerifier?: GoogleVerifier | null;
  /** Override the rate limits (tests use tiny limits). Defaults come from the environment. */
  rateLimits?: { auth?: LimitOptions; join?: LimitOptions };
}

function limiter(opts: LimitOptions, keyGenerator?: (req: express.Request) => string): RateLimitRequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, res) => {
      res.status(429).json({
        error: 'rate_limited',
        message: 'Too many attempts. Please wait a few minutes and try again.',
      });
    },
  });
}

/**
 * Builds the Express app. Kept separate from server.ts so integration tests can
 * mount it with supertest without opening a port.
 * Phase 2: health, auth (register/login/google/logout/me) and classes (create, list, join by code,
 * roster, approve/remove). Rate limiters are created per app instance so tests stay isolated.
 */
export function createApp(options: AppOptions = {}): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  // Credentialed CORS for an exact allow-list of origins (never "*"): the dashboard cookie needs it.
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const googleVerifier =
    options.googleVerifier === null
      ? undefined
      : (options.googleVerifier ??
        (config.GOOGLE_CLIENT_ID ? createGoogleVerifier(config.GOOGLE_CLIENT_ID) : undefined));

  const authLimiter = limiter(
    options.rateLimits?.auth ?? {
      limit: config.AUTH_RATE_LIMIT_MAX,
      windowMs: config.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000,
    },
  );
  // Keyed per signed-in user (the route runs after `authenticate`), so one user cannot brute-force codes.
  const joinLimiter = limiter(
    options.rateLimits?.join ?? {
      limit: config.JOIN_RATE_LIMIT_MAX,
      windowMs: config.JOIN_RATE_LIMIT_WINDOW_MINUTES * 60_000,
    },
    (req) => `user:${req.auth?.user.id ?? 'anonymous'}`,
  );

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  app.use(createAuthRouter({ googleVerifier, authLimiter }));
  app.use('/classes', createClassesRouter({ joinLimiter }));
  app.use('/events', createEventsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
