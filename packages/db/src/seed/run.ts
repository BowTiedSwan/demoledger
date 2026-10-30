import { createDb, createPool } from '../client';
import { loadDbEnv } from '../env';
import { seedDatabase } from './seed';

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadDbEnv();
  const pool = createPool(env.ownerUrl, { statementTimeoutMs: 60_000, max: 2 });
  try {
    const r = await seedDatabase(createDb(pool), { anchor: env.anchor, authSecret: env.authSecret });
    console.log(
      `seeded ${r.transactions} transactions, ${r.users} users (anchor ${env.anchor.toISOString()})`,
    );
  } finally {
    await pool.end();
  }
}
