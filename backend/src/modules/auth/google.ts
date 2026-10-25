import { OAuth2Client } from 'google-auth-library';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/** Verifies a Google ID token and returns the identity. Throws if the token is invalid. */
export type GoogleVerifier = (credential: string) => Promise<GoogleIdentity>;

/**
 * Production verifier: checks the token signature, expiry and that `aud` is OUR client id.
 * Injected into the app so tests can stub it (no network, no real Google account).
 */
export function createGoogleVerifier(clientId: string): GoogleVerifier {
  const client = new OAuth2Client(clientId);
  return async (credential) => {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error('Google token is missing required claims');
    return {
      sub: p.sub,
      email: p.email.toLowerCase(),
      emailVerified: p.email_verified === true,
      name: p.name?.trim() || p.email,
    };
  };
}
