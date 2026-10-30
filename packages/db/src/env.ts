export interface DbEnv {
  ownerUrl: string;
  readerUrl: string;
  appUrl: string;
  readerPassword: string;
  appPassword: string;
  anchor: Date;
  authSecret: string;
}

/** Start of the current UTC day. */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** SEED_ANCHOR (ISO) or the start of the current UTC day. */
export function resolveSeedAnchor(env: NodeJS.ProcessEnv = process.env, now = new Date()): Date {
  const raw = env.SEED_ANCHOR?.trim();
  if (!raw) return startOfUtcDay(now);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`SEED_ANCHOR is not a valid ISO timestamp: ${raw}`);
  return d;
}

export function loadDbEnv(env: NodeJS.ProcessEnv = process.env): DbEnv {
  const ownerUrl = env.DATABASE_URL;
  if (!ownerUrl) throw new Error('DATABASE_URL is required (owner connection; copy .env.example to .env)');
  return {
    ownerUrl,
    readerUrl: env.DATABASE_URL_READER ?? '',
    appUrl: env.DATABASE_URL_APP ?? '',
    readerPassword: env.LEDGER_READER_PASSWORD ?? 'ledger_reader_dev_pw',
    appPassword: env.LEDGER_APP_PASSWORD ?? 'ledger_app_dev_pw',
    anchor: resolveSeedAnchor(env),
    authSecret: env.BETTER_AUTH_SECRET ?? 'seed-only-secret-seed-only-secret-0123456789',
  };
}
