import { direction, period, transactionId, transactionStatus } from '@demoledger/shared';
import { z } from 'zod';

/** `/transactions` search params. Invalid values are dropped rather than failing the page. */
export const transactionsSearch = z.object({
  id: transactionId.optional().catch(undefined),
  wallet: z.string().max(32).optional().catch(undefined),
  status: transactionStatus.optional().catch(undefined),
  direction: direction.optional().catch(undefined),
  period: period.optional().catch(undefined),
  offset: z.coerce.number().int().min(0).max(10_000).optional().catch(undefined),
});

/** `/assistant` search params: `q` hands a question over from the command menu. */
export const assistantSearch = z.object({
  q: z.string().max(2000).optional().catch(undefined),
});
