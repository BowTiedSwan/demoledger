import { extractTransactionIds } from '@demoledger/shared';

export interface GroundingResult {
  /** Distinct transaction IDs cited in the answer. */
  cited: string[];
  /** Cited IDs that no tool call in this request returned. */
  ungrounded: string[];
}

/** Brief 7.3: every TXN-* in the answer must come from this request's tool results. */
export function checkGrounding(answer: string, evidence: ReadonlySet<string>): GroundingResult {
  const cited = extractTransactionIds(answer);
  return { cited, ungrounded: cited.filter((id) => !evidence.has(id)) };
}

const COUNT_CLAIM =
  /(?<![\d\-./])(\d{1,6})\s+(?:(?:completed|pending|failed|incoming|outgoing|matching|total|recent|such)\s+)*(?:transactions?|records?|rows?|payments?)\b/gi;

/**
 * Cheap deterministic check: a number stated as a count of transactions ("3 failed transactions")
 * that matches no server-computed count (returned, total_matching, aggregate group counts) was
 * probably counted by the model. Returns the distinct unverified numbers.
 */
export function checkCounts(answer: string, facts: ReadonlySet<number>): number[] {
  return [...new Set(checkCountClaims(answer, facts).map((c) => c.n))];
}

export interface CountClaim {
  n: number;
  /** Adjective right before "transactions" (completed, pending, failed, incoming, outgoing, ...), if any. */
  qualifier?: string;
}

const QUALIFIERS = new Set(['completed', 'pending', 'failed', 'incoming', 'outgoing']);

/** Like `checkCounts`, but keeps the status/direction word the answer attached to the number. */
export function checkCountClaims(answer: string, facts: ReadonlySet<number>): CountClaim[] {
  const out: CountClaim[] = [];
  for (const m of answer.matchAll(COUNT_CLAIM)) {
    const n = Number(m[1]);
    if (facts.has(n)) continue;
    const words = m[0].toLowerCase().split(/\s+/);
    const qualifier = words.find((w) => QUALIFIERS.has(w));
    if (!out.some((c) => c.n === n && c.qualifier === qualifier)) {
      out.push(qualifier ? { n, qualifier } : { n });
    }
  }
  return out;
}

export interface RowFact {
  status: string;
  failure_reason: string | null;
}

const NOT_RECORDED =
  /not recorded|no (?:failure )?reason|\bnull\b|unknown reason|reason (?:is )?(?:unavailable|missing)/i;
const NEGATED_PRESENCE =
  /(?:do(?:es)? not|don't|didn't|did not|cannot|can't|no longer|never) (?:appear|exist|show up|occur)|\bnot (?:found|present)\b|\babsent\b|\bmissing from\b/i;
const REASON_TOKEN = /\b[a-z]+(?:_[a-z]+)+\b/g;
const TXN = /TXN-[AB]-\d{4}/g;

/**
 * Deterministic check of what the answer says about failure reasons, against the rows this
 * request returned. Segments are lines/sentences. Flags:
 *  - "not recorded"/"null" about rows that do have a reason,
 *  - a reason value that differs from the cited row's reason,
 *  - a returned reason value claimed to be absent from the records.
 * Returns the distinct IDs (or `reason:<value>`) involved.
 */
export function checkFacts(answer: string, rows: ReadonlyMap<string, RowFact>): string[] {
  const reasons = new Set<string>();
  for (const r of rows.values()) if (r.failure_reason) reasons.add(r.failure_reason);
  const bad = new Set<string>();
  const segments = answer.split(/\n+|(?<=[.!?])\s+/);
  for (const seg of segments) {
    const ids = [...new Set(seg.match(TXN) ?? [])].filter((id) => rows.get(id)?.status === 'failed');
    const mentioned = [...new Set(seg.match(REASON_TOKEN) ?? [])].filter((t) => reasons.has(t));
    if (ids.length > 0) {
      const withReason = ids.filter((id) => rows.get(id)?.failure_reason);
      // Single-ID segment, or every ID has a reason: "not recorded" is wrong for all of them.
      if (NOT_RECORDED.test(seg) && withReason.length === ids.length) {
        for (const id of ids) bad.add(id);
      }
      for (const t of mentioned) {
        if (ids.every((id) => rows.get(id)?.failure_reason !== t)) for (const id of ids) bad.add(id);
      }
    }
    if (NEGATED_PRESENCE.test(seg)) for (const t of mentioned) bad.add(`reason:${t}`);
  }
  return [...bad];
}

const HEDGE =
  /\b(?:likely|probably|possibly|perhaps|may have|might have|could have|suggests?|appears? to)\b/i;
const FAIL_WORD = /\bfail(?:s|ed|ure|ures|ing)?\b/i;

/**
 * Hedged speculation about failures ("probably failed because...") is not in the data.
 * Returns the failed-transaction IDs involved (or ['general']) for each sentence that mentions
 * a failure (the word, or a failed row's ID) together with a hedge word.
 */
export function checkSpeculation(answer: string, rows: ReadonlyMap<string, RowFact>): string[] {
  const hits = new Set<string>();
  for (const seg of answer.split(/\n+|(?<=[.!?])\s+/)) {
    if (!HEDGE.test(seg)) continue;
    const ids = [...new Set(seg.match(TXN) ?? [])].filter((id) => rows.get(id)?.status === 'failed');
    if (ids.length > 0) for (const id of ids) hits.add(id);
    else if (FAIL_WORD.test(seg)) hits.add('general');
  }
  return [...hits];
}

/**
 * Some models (observed with gpt-oss) write IDs with Unicode hyphens ("TXN\u2011A\u20110052").
 * The checks run on this normalised text so such citations are still verified, not skipped.
 */
export function normalizeDashes(text: string): string {
  return text.replace(/[\u2010-\u2015\u2212]/g, '-');
}
