import type { Guard, GuardDecision, GuardInput } from '@demoledger/shared';

/**
 * Deterministic, offline guard. Defense in depth only: the security boundary is backend
 * tenant scoping plus the read-only DB role, never this list.
 *
 * Categories and their verdicts:
 *  - write_verb, override_phrase, sql_fragment, tenant_claim -> block
 *  - suspicious (prompt/secret extraction, role-play framing) -> flag
 */

export type HeuristicCategory =
  | 'write_verb'
  | 'override_phrase'
  | 'sql_fragment'
  | 'tenant_claim'
  | 'suspicious';

export interface HeuristicMatch {
  category: HeuristicCategory;
  rule: string;
  /** Matched text, truncated. */
  text: string;
}

const LEAD = String.raw`(?:^|[.!?;:\n]\s*|\b(?:please|pls|kindly|now|then|and|also|can you|could you|would you|will you|can you please|could you please|would you please|will you please|i want to|i need to|i'd like to|i would like to|i want you to|i need you to|i'd like you to|i would like you to|i'd like for you to|you need to|you have to|go ahead and|make sure to|let's|lets|just|you must|you should)\s+)`;

/** Verbs that are write intent as soon as they start an instruction. */
const ALWAYS_WRITE =
  'pay|send|transfer|refund|reverse|delete|remove|cancel|approve|void|wire|write[- ]?off|resubmit|unfreeze|freeze';
/** Verbs that are ambiguous ("update me", "create a summary"), so they need a ledger object. */
const OBJECT_WRITE = 'update|create|modify|edit|change|set|add|insert|adjust|mark|fix|correct';
const LEDGER_OBJECT =
  'transactions?|payments?|balances?|wallets?|records?|entr(?:y|ies)|status(?:es)?|amounts?|descriptions?|ledger|accounts?|txn|failure reasons?|TXN-[AB]-\\d{4}|WALLET-[AB]-\\d{3}';

/** "issue a refund", "make a payment": a write request phrased with a noun. */
const NOUN_VERBS =
  'issue|process|make|initiate|execute|submit|do|perform|trigger|start|raise|book|schedule|arrange|authori[sz]e|run|create|set up|place|file';
const WRITE_NOUNS =
  'refunds?|payments?|transfers?|reversals?|payouts?|wires?|chargebacks?|top[- ]?ups?|withdrawals?|deposits?|write[- ]?offs?';

interface Rule {
  category: HeuristicCategory;
  rule: string;
  re: RegExp;
}

const RULES: readonly Rule[] = [
  {
    category: 'write_verb',
    rule: 'imperative_write_verb',
    re: new RegExp(`${LEAD}(?:${ALWAYS_WRITE})\\b`, 'i'),
  },
  {
    category: 'write_verb',
    rule: 'write_noun_phrase',
    re: new RegExp(
      `${LEAD}(?:${NOUN_VERBS})\\b(?:\\s+(?:an?|the|this|that|another|one|some|new|manual|full|partial|instant|urgent|immediate))*\\s+(?:${WRITE_NOUNS})\\b`,
      'i',
    ),
  },
  {
    category: 'write_verb',
    rule: 'write_verb_with_ledger_object',
    re: new RegExp(
      `${LEAD}(?:${OBJECT_WRITE})\\b(?:\\s+(?:the|a|an|this|that|these|those|all|my|its|their|each|every|new|existing|pending|failed|completed|failure|transaction|wallet|incoming|outgoing|manual|fake|extra|duplicate|separate|one|more|some))*\\s+(?:${LEDGER_OBJECT})\\b`,
      'i',
    ),
  },
  {
    category: 'write_verb',
    rule: 'write_modal',
    re: new RegExp(
      `\\b(?:can|could|would|will|may) (?:you|the assistant|this)\\s+(?:${ALWAYS_WRITE})\\b`,
      'i',
    ),
  },
  {
    category: 'override_phrase',
    rule: 'ignore_instructions',
    re: /\b(?:ignore|disregard|forget|override|bypass|skip)\s+(?:all\s+|any\s+|the\s+|your\s+|these\s+|those\s+|my\s+)*(?:previous|prior|above|earlier|former|preceding|system|safety|security|existing)?\s*(?:instructions?|prompts?|rules?|guidelines?|restrictions?|constraints?|guardrails?|filters?)\b/i,
  },
  { category: 'override_phrase', rule: 'forget_everything', re: /\bforget (?:everything|all|what)\b/i },
  {
    category: 'override_phrase',
    rule: 'new_instructions',
    re: /\b(?:new|updated|real|actual) (?:instructions?|system prompt|rules?)\s*:/i,
  },
  {
    category: 'override_phrase',
    rule: 'persona_switch',
    re: /\b(?:you are now|from now on,? you|act as if you|pretend (?:to be|you are)|developer mode|jailbreak|\bDAN\b|do anything now)\b/i,
  },
  {
    category: 'override_phrase',
    rule: 'fake_system_tag',
    re: /(?:^|\n)\s*(?:system|assistant|developer)\s*:|<\/?(?:system|instructions?|untrusted_tool_data)\b|\[\/?(?:system|inst)\]/i,
  },
  {
    category: 'override_phrase',
    rule: 'reveal_prompt',
    re: /\b(?:reveal|show|print|repeat|output|display|leak|tell me)\b.{0,40}\b(?:system prompt|your (?:instructions|prompt|rules)|hidden (?:prompt|instructions)|initial prompt)\b/i,
  },
  { category: 'tenant_claim', rule: 'tenant_id_mention', re: /\btenant[_\s-]?(?:alpha|beta)\b/i },
  {
    category: 'tenant_claim',
    rule: 'tenant_id_assignment',
    re: /\b(?:tenant|organi[sz]ation|org)[_\s-]?(?:id)?\s*[:=]\s*\S+/i,
  },
  {
    category: 'tenant_claim',
    rule: 'other_tenant',
    re: /\b(?:other|another|all|every|different)\s+(?:tenants?|organi[sz]ations?|orgs?|customers?|companies)\b/i,
  },
  {
    category: 'tenant_claim',
    rule: 'role_claim',
    re: /\bi(?:'m| am)\s+(?:an?\s+|the\s+)?(?:admin(?:istrator)?|root|superuser|super[- ]admin|owner|developer|operator|support engineer)\b|\b(?:as|with)\s+(?:an?\s+)?(?:admin|root|superuser)\s+(?:access|privileges?|rights?)\b|\bsudo\b/i,
  },
  { category: 'sql_fragment', rule: 'select_from', re: /\bselect\b[\s\S]{1,200}?\bfrom\b/i },
  {
    category: 'sql_fragment',
    rule: 'ddl_dml',
    re: /\b(?:drop|alter|truncate)\s+(?:table|database|schema|role)\b|\binsert\s+into\b|\bdelete\s+from\b|\bupdate\s+\w+\s+set\b|\bunion\s+(?:all\s+)?select\b/i,
  },
  {
    category: 'sql_fragment',
    rule: 'sql_syntax',
    re: /(?:;\s*--)|(?:'\s*or\s+'?\d+'?\s*=\s*'?\d+)|(?:\bor\s+1\s*=\s*1\b)|(?:\/\*[\s\S]*?\*\/)|(?:\bpg_sleep\b|\binformation_schema\b|\bpg_catalog\b)/i,
  },
  {
    category: 'suspicious',
    rule: 'secret_extraction',
    re: /\b(?:api[_ -]?key|password|secret|bearer token|access token|credentials?|cookie|session token|env(?:ironment)? variables?)\b/i,
  },
  {
    category: 'suspicious',
    rule: 'roleplay_framing',
    re: /\b(?:hypothetically|role[- ]?play|in a fictional|for a story|pretend that|imagine you (?:are|could))\b/i,
  },
  {
    category: 'suspicious',
    rule: 'encoded_payload',
    re: /\b(?:base64|rot13|hex[- ]encoded|decode (?:this|the following))\b/i,
  },
  {
    category: 'suspicious',
    rule: 'prompt_probe',
    re: /\b(?:what (?:are|were) your (?:instructions|rules)|repeat the (?:above|text above)|your (?:system )?prompt)\b/i,
  },
];

const BLOCKING: ReadonlySet<HeuristicCategory> = new Set([
  'write_verb',
  'override_phrase',
  'sql_fragment',
  'tenant_claim',
]);

/** Run every rule; pure and synchronous. */
export function scanQuestion(question: string): HeuristicMatch[] {
  const matches: HeuristicMatch[] = [];
  for (const r of RULES) {
    const m = r.re.exec(question);
    if (m) matches.push({ category: r.category, rule: r.rule, text: m[0].trim().slice(0, 80) });
  }
  return matches;
}

export function hasWriteVerb(matches: readonly HeuristicMatch[]): boolean {
  return matches.some((m) => m.category === 'write_verb');
}

/** Verdict implied by the matches alone. */
export function heuristicVerdict(matches: readonly HeuristicMatch[]): 'allow' | 'flag' | 'block' {
  if (matches.some((m) => BLOCKING.has(m.category))) return 'block';
  return matches.length > 0 ? 'flag' : 'allow';
}

export class HeuristicGuard implements Guard {
  readonly provider = 'heuristic' as const;
  readonly model = null;

  async check({ question }: GuardInput): Promise<GuardDecision> {
    const t0 = performance.now();
    const matches = scanQuestion(question);
    return {
      verdict: heuristicVerdict(matches),
      provider: 'heuristic',
      model: null,
      reasons: matches.map((m) => `${m.category}:${m.rule}`),
      answers: { matches },
      latency_ms: Math.round(performance.now() - t0),
    };
  }
}
