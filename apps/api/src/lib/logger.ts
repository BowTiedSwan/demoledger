import type { AppConfig, Logger } from './deps';

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;

/** JSON-lines logger on stdout/stderr. Never log secrets, tokens or full question text. */
export function createLogger(level: AppConfig['logLevel'], base: Record<string, unknown> = {}): Logger {
  const min = LEVELS.indexOf(level);
  const emit = (lvl: (typeof LEVELS)[number], obj: Record<string, unknown>, msg?: string) => {
    if (LEVELS.indexOf(lvl) < min) return;
    const line = JSON.stringify({ level: lvl, time: new Date().toISOString(), msg, ...base, ...obj });
    (lvl === 'error' || lvl === 'warn' ? console.error : console.log)(line);
  };
  return {
    debug: (o, m) => emit('debug', o, m),
    info: (o, m) => emit('info', o, m),
    warn: (o, m) => emit('warn', o, m),
    error: (o, m) => emit('error', o, m),
    child: (b) => createLogger(level, { ...base, ...b }),
  };
}
