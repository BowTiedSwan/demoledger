import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import * as schema from '../schema';
import { createSeedAuth } from './auth';
import { SEED_TENANTS, SEED_USERS } from './constants';
import { generateTransactions } from './generate';

export interface SeedResult {
  transactions: number;
  users: number;
}

/**
 * Seed organizations (fixed ids), users (via Better Auth signUpEmail), memberships and the
 * 100 deterministic transactions. Expects an empty schema; run via `pnpm db:reset`.
 * Uses the owner connection. No sessions are created: the first login sets the active org.
 */
export async function seedDatabase(
  db: Database,
  opts: { anchor: Date; authSecret: string },
): Promise<SeedResult> {
  const existing = await db.select({ id: schema.organization.id }).from(schema.organization).limit(1);
  if (existing.length > 0) throw new Error('database already seeded; run `pnpm db:reset` for a clean slate');

  await db
    .insert(schema.organization)
    .values(SEED_TENANTS.map((t) => ({ id: t.id, name: t.name, slug: t.slug, createdAt: opts.anchor })));

  const auth = createSeedAuth(db, opts.authSecret);
  for (const u of SEED_USERS) {
    const res = await auth.api.signUpEmail({ body: { name: u.name, email: u.email, password: u.password } });
    const row = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, res.user.id))
      .limit(1);
    if (!row[0]) throw new Error(`seed user ${u.email} was not created`);
    await db.insert(schema.member).values({
      id: `member_${u.tenantId}_${u.role}`,
      organizationId: u.tenantId,
      userId: res.user.id,
      role: u.role,
      createdAt: opts.anchor,
    });
  }

  const txns = generateTransactions(opts.anchor);
  await db.insert(schema.transactions).values(txns);
  return { transactions: txns.length, users: SEED_USERS.length };
}
