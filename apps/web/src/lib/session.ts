import { type MeResponse, meResponse } from '@demoledger/shared';
import { api } from './api';

export type SessionResult =
  | { status: 'ok'; me: MeResponse }
  | { status: 'signed-out' }
  /** Signed in, but the session has no active organization (403 from /api/me). */
  | { status: 'no-organization' };

/** Current session via the typed client. */
export async function fetchSession(): Promise<SessionResult> {
  const res = await api.me.$get();
  const status: number = res.status;
  if (status === 403) return { status: 'no-organization' };
  if (!res.ok) return { status: 'signed-out' };
  const parsed = meResponse.safeParse(await res.json());
  return parsed.success ? { status: 'ok', me: parsed.data } : { status: 'signed-out' };
}
