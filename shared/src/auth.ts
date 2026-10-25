import { z } from 'zod';

/**
 * Auth request schemas and response types shared by the backend, dashboard and extension.
 *
 * Decisions (docs/implementation_plan.md):
 *  - Email/password works for EVERYONE (dashboard and extension).
 *  - Google sign-in is DASHBOARD ONLY (professors). The extension never sees Google tokens.
 *  - The dashboard session is an httpOnly cookie; the extension gets a bearer token in the response
 *    body and keeps it in chrome.storage. `client` tells the API which one to use.
 */

/** Bump when the consent text changes; stored next to `users.consent_at`. */
export const CONSENT_VERSION = '2026-10-v1';

export const CLIENT_KINDS = ['dashboard', 'extension'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

/** bcrypt only uses the first 72 BYTES of a password, so longer inputs are rejected, not truncated. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;

const emailField = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));

const newPasswordField = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .refine((p) => new TextEncoder().encode(p).length <= PASSWORD_MAX_BYTES, {
    message: `Password must be at most ${PASSWORD_MAX_BYTES} bytes`,
  });

export const registerSchema = z.object({
  email: emailField,
  password: newPasswordField,
  name: z.string().trim().min(1, 'Name is required').max(100),
  /** Must be true; the API rejects with `consent_required` otherwise. Stored as users.consent_at. */
  consent: z.boolean().default(false),
  client: z.enum(CLIENT_KINDS),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailField,
  // No policy check on login: never reveal the policy or hint at which part failed.
  password: z.string().min(1).max(1024),
  client: z.enum(CLIENT_KINDS),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Dashboard only. `credential` is the Google ID token (JWT) from Google Identity Services. */
export const googleSignInSchema = z.object({
  credential: z.string().min(1).max(8192),
  /** Needed only when this sign-in creates a new account. */
  consent: z.boolean().default(false),
});
export type GoogleSignInInput = z.infer<typeof googleSignInSchema>;

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  consent_at: string | null;
}

/** Response of register / login / google. `token` is present ONLY for client = 'extension'. */
export interface AuthResponse {
  user: UserDTO;
  token?: string;
}

/** Stable machine-readable error codes (the `error` field of every error response). */
export type ApiErrorCode =
  | 'validation_error'
  | 'consent_required'
  | 'invalid_credentials'
  | 'email_taken'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'removed_from_class'
  | 'csrf_check_failed'
  | 'rate_limited'
  | 'google_sign_in_disabled'
  | 'google_token_invalid'
  | 'out_of_session'
  | 'internal_error';

export interface ApiError {
  error: ApiErrorCode;
  message: string;
  issues?: { path: string; message: string }[];
}
