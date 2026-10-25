import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ZodType } from 'zod';
import type { ApiError, ApiErrorCode } from '@notifeye/shared';

/** An error that maps directly to an HTTP response. Anything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly issues?: ApiError['issues'],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Validates an untrusted value against a zod schema; throws a 400 with per-field issues. */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'validation_error',
    'Some fields are invalid.',
    result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiError = { error: 'not_found', message: 'Not found' };
  res.status(404).json(body);
};

/**
 * Central error handler. It deliberately logs only the error name/message: never the request body
 * (it may hold passwords or a Discord webhook URL) and never pg's `detail` (it can echo emails).
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiError = { error: err.code, message: err.message };
    if (err.issues) body.issues = err.issues;
    res.status(err.status).json(body);
    return;
  }

  // body-parser failures (malformed JSON, payload too large)
  const status = typeof err?.status === 'number' ? err.status : undefined;
  if (status === 400 || status === 413) {
    const body: ApiError = {
      error: 'validation_error',
      message: status === 413 ? 'Request body is too large.' : 'Request body is not valid JSON.',
    };
    res.status(status).json(body);
    return;
  }

  console.error('[error]', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error');
  const body: ApiError = { error: 'internal_error', message: 'Something went wrong.' };
  res.status(500).json(body);
};
