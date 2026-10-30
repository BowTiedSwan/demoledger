import type { Guard, GuardFailMode, GuardProviderName } from '@demoledger/shared';
import { HeuristicGuard } from './heuristic';
import { NoopGuard } from './noop';
import { SystemOneGuard } from './system-one';

export { GUARD_MESSAGES, GUARD_THRESHOLDS, type GuardThresholds } from './config';
export { HeuristicGuard, hasWriteVerb, heuristicVerdict, scanQuestion } from './heuristic';
export { NoopGuard } from './noop';
export { type GuardRunResult, runGuard } from './runner';
export {
  buildSystemOneBody,
  decideFromSystemOne,
  parseSystemOneResponse,
  SystemOneGuard,
  type SystemOneResult,
} from './system-one';

export interface GuardConfig {
  /** Empty/undefined = clef when CF credentials exist, otherwise heuristic. */
  provider?: GuardProviderName | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  accountId?: string | undefined;
  apiToken?: string | undefined;
  failMode?: GuardFailMode | undefined;
  timeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
  /** clef only: also apply the local heuristic (default true). */
  heuristic?: boolean | undefined;
}

export const DEFAULT_GUARD_MODEL = '@cf/cloudflare/clef-flash';

/** Factory for the configured guard. Throws on `clef` without credentials (misconfiguration). */
export function createGuard(config: GuardConfig): Guard {
  const hasCreds = Boolean(config.accountId && config.apiToken);
  const provider: GuardProviderName = config.provider ?? (hasCreds ? 'clef' : 'heuristic');
  switch (provider) {
    case 'none':
      return new NoopGuard();
    case 'heuristic':
      return new HeuristicGuard();
    case 'clef': {
      if (!config.apiToken || (!config.baseUrl && !config.accountId)) {
        throw new Error(
          'GUARD_PROVIDER=clef needs CF_ACCOUNT_ID and CF_API_TOKEN (or GUARD_BASE_URL + CF_API_TOKEN).',
        );
      }
      return new SystemOneGuard({
        baseUrl: config.baseUrl ?? `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run`,
        model: config.model ?? DEFAULT_GUARD_MODEL,
        apiToken: config.apiToken,
        ...(config.fetch ? { fetch: config.fetch } : {}),
        ...(config.heuristic === undefined ? {} : { heuristic: config.heuristic }),
      });
    }
  }
}
