import { createDb, createPool } from '@demoledger/db';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createAuth } from './auth';
import { createAiDeps } from './lib/ai-wiring';
import { loadConfig } from './lib/config';
import type { AppDeps } from './lib/deps';
import { createLogger } from './lib/logger';

const { app: config, env } = loadConfig(process.env);
const logger = createLogger(config.logLevel);

const poolOpts = { statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS };
const readerPool = createPool(env.DATABASE_URL_READER, { ...poolOpts, applicationName: 'demoledger-reader' });
const appPool = createPool(env.DATABASE_URL_APP, { ...poolOpts, applicationName: 'demoledger-app' });
const db = { reader: createDb(readerPool), app: createDb(appPool) };

const { authLike } = createAuth({
  db: db.app,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: config.trustedOrigins,
});

const { llm, guard } = createAiDeps(env);

const deps: AppDeps = { config, db, auth: authLike, llm, guard, now: () => new Date(), logger };

const server = serve({ fetch: createApp(deps).fetch, port: config.port }, (info) => {
  logger.info(
    { port: info.port, llm: llm ? llm.modelId : 'unconfigured', guard: guard.provider },
    'api listening',
  );
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close();
  await Promise.allSettled([readerPool.end(), appPool.end()]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
