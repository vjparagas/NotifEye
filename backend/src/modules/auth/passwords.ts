import bcrypt from 'bcrypt';
import { config } from '../../config';

/** Hashes with bcrypt (salted; cost from config). Plain passwords never leave this module. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.BCRYPT_ROUNDS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Compares a password with a stored hash. When there is no stored hash (unknown email, or a
 * Google-only account) it still runs one bcrypt comparison against a dummy hash, so the response
 * time does not reveal whether the account exists.
 */
export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (hash) return bcrypt.compare(plain, hash);
  dummyHash ??= bcrypt.hash('not-a-real-password', config.BCRYPT_ROUNDS);
  await bcrypt.compare(plain, await dummyHash);
  return false;
}
