import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

// Load the repo-root .env (two levels up from backend/src). Real env vars always win.
const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, '../../.env') });

/**
 * All configuration comes from environment variables (secrets never live in code).
 * Validated once at startup so a misconfigured deploy fails fast and loudly.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DASHBOARD_URL: z.string().default('http://localhost:5173'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['smtp', 'sendgrid']).default('smtp'),
  EMAIL_FROM: z.string().default('NotifEye <no-reply@notifeye.local>'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  // ── Phase 2: auth ──
  /** bcrypt cost factor. Tests lower it (4) purely for speed; never below 10 in production. */
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  /** Applies to register / login / google. Counted per client IP. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  /** Applies to POST /classes/join. Counted per signed-in user (stops class-code guessing). */
  JOIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  JOIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  /** Dashboard cookie SameSite. Use `none` only if dashboard and API are on different sites (needs HTTPS). */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${problems}\n(See .env.example)`);
}

const env = parsed.data;

if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('change-me')) {
  throw new Error('Invalid environment configuration: set a real JWT_SECRET before running in production.');
}

export const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  demoMode: env.DEMO_MODE === 'true',
  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
} as const;
