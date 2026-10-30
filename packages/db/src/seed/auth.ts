import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, organization } from 'better-auth/plugins';
import type { Database } from '../client';
import * as schema from '../schema';

/**
 * Minimal Better Auth instance used only to create seed users, so passwords are hashed
 * with Better Auth's default scrypt exactly as the API's instance will verify them.
 */
export function createSeedAuth(db: Database, secret: string) {
  return betterAuth({
    secret,
    baseURL: 'http://localhost:3001',
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true, autoSignIn: false },
    plugins: [organization(), bearer()],
  });
}
