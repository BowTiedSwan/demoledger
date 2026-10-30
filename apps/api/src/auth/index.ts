import { type Database, schema } from '@demoledger/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, organization } from 'better-auth/plugins';
import { asc, eq } from 'drizzle-orm';
import type { AuthLike } from '../lib/deps';

export interface CreateAuthOptions {
  /** `ledger_app` Database (Better Auth tables). Never the reader pool. */
  db: Database;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
}

/**
 * Better Auth: email + password, organization (= tenant) and bearer plugins.
 *  - Browser: httpOnly session cookie. Programmatic clients: the sign-in response carries the
 *    session token in the `set-auth-token` header; send it back as `Authorization: Bearer`.
 *  - Self-service sign-up and organization creation are disabled; users and tenants are seeded.
 *  - On session creation the user's (oldest) organization becomes the active organization.
 *    requireTenant still re-checks membership on every request.
 */
export function createAuth(opts: CreateAuthOptions) {
  const { db } = opts;
  const auth = betterAuth({
    appName: 'DemoLedger',
    baseURL: opts.baseURL,
    basePath: '/api/auth',
    secret: opts.secret,
    trustedOrigins: opts.trustedOrigins,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true, disableSignUp: true },
    plugins: [organization({ allowUserToCreateOrganization: false }), bearer()],
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const [first] = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .orderBy(asc(schema.member.createdAt))
              .limit(1);
            return { data: { ...session, activeOrganizationId: first?.organizationId ?? null } };
          },
        },
      },
    },
  });

  const authLike: AuthLike = {
    handler: (request) => auth.handler(request),
    async getSession(headers) {
      const result = await auth.api.getSession({ headers });
      if (!result) return null;
      const active = (result.session as { activeOrganizationId?: string | null }).activeOrganizationId;
      return {
        user: { id: result.user.id, email: result.user.email, name: result.user.name },
        activeOrganizationId: active ?? null,
      };
    },
  };
  return { auth, authLike };
}
