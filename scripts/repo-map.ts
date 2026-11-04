/**
 * Generates REPO_MAP.md: a purpose-first map of the repo for agents and reviewers.
 *
 * Two kinds of content:
 *   - CURATED purpose lines (TOP_LEVEL, MODULES, SCRIPT_PURPOSE below). Each names a path; the
 *     generator fails if a named path no longer exists, so a stale line cannot ship.
 *   - GENERATED inventories, parsed from the source of truth on every run: API routes
 *     (apps/api/src/app.ts), web routes (apps/web/src/router.tsx), model tools (shared
 *     TOOL_NAMES), tables + grants + RLS (packages/db schema and roles.sql), root scripts
 *     (package.json) and counts.
 *
 * Never edit REPO_MAP.md by hand: run `pnpm repo-map`. `pnpm repo-map --check` exits 1 on drift (CI).
 * Output is deterministic (no dates), so the check only fails when the repo really changed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_TOOL_NAMES, PRESENTATIONAL_TOOL_NAMES } from '../packages/shared/src/enums.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'REPO_MAP.md');
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');

// ---------------------------------------------------------------------------------------------
// Curated purpose lines. Vocabulary: module / interface / seam / adapter (see CONTEXT.md for the
// domain terms). Keep each line to the role a caller needs, not a list of exports.
// ---------------------------------------------------------------------------------------------

const TOP_LEVEL: ReadonlyArray<[entry: string, purpose: string]> = [
  ['AGENTS.md / CLAUDE.md', 'Agent router: verified commands, never-dos, pointers. `CLAUDE.md` imports it.'],
  ['CONTEXT.md', 'Ubiquitous language: one meaning per domain term.'],
  [
    'packages/shared/',
    'Contracts: strict zod schemas, enums, money and date helpers. Single source of truth.',
  ],
  [
    'packages/db/',
    'Drizzle schema, migrations, `roles.sql` (grants + RLS), deterministic seed, test-DB setup.',
  ],
  ['apps/api/', 'Hono API: Better Auth, tenant middleware, repository, guard, tools, orchestrator, audit.'],
  ['apps/web/', 'Vite + React SPA: login, transactions table, streaming assistant with visual answers.'],
  ['evals/', 'Labelled guard prompts and model questions; `eval:guard` (offline) and `eval:llm` (live).'],
  ['docs/', 'Index in `docs/README.md`; decisions in `docs/adr/` and `docs/DECISIONS.md`.'],
  ['docs/diagrams/', 'Request path, tenant-boundary layers and data model as SVG, each with a Mermaid twin.'],
  ['scripts/repo-map.ts', 'This generator.'],
  [
    'docker-compose.yml, docker/initdb/',
    'Postgres 17 on 127.0.0.1:5433; creates `demoledger` and `demoledger_test`.',
  ],
  [
    '.github/workflows/ci.yml',
    'CI gate: install, repo-map drift check, typecheck, lint, test against Postgres.',
  ],
];

const MODULES: ReadonlyArray<{ title: string; lines: ReadonlyArray<[path: string, role: string]> }> = [
  {
    title: 'packages/shared: contracts every other package imports',
    lines: [
      [
        'packages/shared/src/filters.ts',
        'Tool args and REST query schemas (strict: an unknown key such as `tenant_id` fails).',
      ],
      [
        'packages/shared/src/ask.ts',
        '`/api/ask` request, stream data parts, tool result shapes, error codes and copy.',
      ],
      [
        'packages/shared/src/visual.ts',
        '`present_visual` args and the `visualSpec` catalog contract (ADR 0009).',
      ],
      [
        'packages/shared/src/enums.ts',
        'Status, direction, period, guard verdict, audit status, `TOOL_NAMES`.',
      ],
      [
        'packages/shared/src/money.ts',
        '`formatMinorUnits`: the only place minor units become display strings.',
      ],
      [
        'packages/shared/src/dates.ts',
        'UTC period resolution (half-open ranges, ISO week), used by validation, SQL and tests.',
      ],
    ],
  },
  {
    title: 'packages/db: the privilege model lives here, not in the app',
    lines: [
      [
        'packages/db/src/schema/index.ts',
        'Tables: ledger (`transactions`), Better Auth, audit and conversations.',
      ],
      [
        'packages/db/src/roles.sql',
        'Role grants and RLS policies; every change pairs with an assertion in `roles.test.ts`.',
      ],
      [
        'packages/db/src/seed/generate.ts',
        'Pure `generateTransactions(anchor)`; tests derive expected values from it.',
      ],
      ['packages/db/src/testing/global-setup.ts', 'Resets and seeds `demoledger_test` once per vitest run.'],
    ],
  },
  {
    title: 'apps/api: one deep module per concern, wired at the `createApp(deps)` seam',
    lines: [
      [
        'apps/api/src/app.ts',
        '`createApp(deps)`: middleware order and the chained routes (`AppType` for the web client).',
      ],
      [
        'apps/api/src/lib/deps.ts',
        'The seam: LLM, guard, clock, pools, audit and conversation store are injected adapters.',
      ],
      [
        'apps/api/src/index.ts',
        'Production entry: loads config, asserts DB roles at boot, wires real adapters.',
      ],
      [
        'apps/api/src/middleware/require-tenant.ts',
        'The only place a tenant is established: session, then membership re-check.',
      ],
      [
        'apps/api/src/repo/transactions.ts',
        'Repository: the single tenant enforcement point shared by REST and tools.',
      ],
      ['apps/api/src/repo/with-tenant.ts', '`withTenant`: transaction-local RLS context (`app.tenant_id`).'],
      [
        'apps/api/src/tools/index.ts',
        '`ledgerTools`: tenant bound in the factory closure; strict args validated in `execute`.',
      ],
      [
        'apps/api/src/tools/visual.ts',
        "Builds the visual spec from this request's recorded results; no DB access.",
      ],
      [
        'apps/api/src/guard/index.ts',
        'Guard interface with three adapters: heuristic, Clef (System One), noop for tests.',
      ],
      [
        'apps/api/src/orchestrator/index.ts',
        '`handleAsk`: guard, model/tool loop, answer checks, audit, conversation store.',
      ],
      [
        'apps/api/src/orchestrator/grounding.ts',
        'Answer checks: citation grounding, counts, facts, speculation.',
      ],
      [
        'apps/api/src/conversations/index.ts',
        'Server-stored history; `withTenantUser` sets tenant and user RLS context.',
      ],
      ['apps/api/src/audit/index.ts', 'Append-only audit sink (`ai_requests`, `ai_tool_calls`).'],
    ],
  },
  {
    title: 'apps/web: renders contracts, never redefines them',
    lines: [
      [
        'apps/web/src/lib/api.ts',
        'Typed `hc<AppType>` client; every payload type comes from `@demoledger/shared`.',
      ],
      [
        'apps/web/src/lib/chat-parts.ts',
        'Assignment question templates, tenant-wallet substitutions and chat-part helpers.',
      ],
      [
        'apps/web/src/lib/suggested-questions.tsx',
        'One tenant-scoped wallet lookup shared by assistant and command-menu suggestions.',
      ],
      [
        'apps/web/src/components/ai-elements/message.tsx',
        'Hardened markdown: no remote images, same-origin links only.',
      ],
      [
        'apps/web/src/components/visual/registry.tsx',
        'Fixed catalog renderer for validated `data-visual` specs.',
      ],
      ['apps/web/csp.ts', "Content Security Policy (`img-src 'self' data:; connect-src 'self'`)."],
      [
        'apps/web/src/styles/globals.css',
        'Design tokens: the only place colours, radii and type are defined.',
      ],
    ],
  },
];

const SCRIPT_PURPOSE: Readonly<Record<string, string>> = {
  dev: 'API on :3001 and web on :5173',
  'db:up': 'start Postgres (compose)',
  'db:down': 'stop Postgres',
  'db:migrate': 'apply migrations (owner role)',
  'db:seed': 'seed tenants, users and 100 transactions',
  'db:reset': 'drop schema, migrate, roles.sql, seed (dev and test DBs only)',
  typecheck: 'tsc for the root and every package',
  lint: 'biome check',
  format: 'biome check --write',
  test: 'vitest, all projects (needs `pnpm db:up`)',
  'test:watch': 'vitest watch',
  'smoke:live': 'one real Workers AI request (needs CF_* credentials)',
  'eval:guard': 'guard eval; Clef column needs CF_* credentials',
  'eval:llm': 'model eval (needs CF_* credentials; spends Neurons)',
  'repo-map': 'regenerate this file; `--check` fails on drift',
};

// ---------------------------------------------------------------------------------------------
// Generated inventories
// ---------------------------------------------------------------------------------------------

function listFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter((f) => f !== '' && existsSync(join(ROOT, f)))
    .sort();
}

const MIDDLEWARE_NAMES: Readonly<Record<string, string>> = {
  tenantGuard: 'requireTenant',
  askLimiter: 'rate limit',
  authBodyLimit: 'body limit',
};

/** Global middleware, in registration order (`.use(x)` with no path). */
export function globalMiddleware(src: string): string[] {
  const chain = src.slice(src.indexOf('new Hono'), src.indexOf('.notFound('));
  const out: string[] = [];
  for (const m of chain.matchAll(/\n\s+\.use\((?!')(async|\w+)/g)) {
    out.push(m[1] === 'async' ? 'no-store' : (m[1] ?? ''));
  }
  return out;
}

/** Routes and the route-scoped middleware registered before them, from the `createApp` chain. */
export function apiRoutes(src: string): Array<{ method: string; path: string; via: string }> {
  const base = /\.basePath\('([^']+)'\)/.exec(src)?.[1] ?? '';
  const chain = src.slice(src.indexOf('new Hono'), src.indexOf('.notFound('));
  const uses: Array<{ at: number; pattern: string; names: string[] }> = [];
  for (const m of chain.matchAll(/\n\s+\.use\('([^']+)',\s*((?:[^()]|\([^()]*\))*)\)/g)) {
    const names = (m[2] ?? '')
      .split(/,(?![^(]*\))/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => MIDDLEWARE_NAMES[s] ?? (s.startsWith('csrfOrigin') ? 'CSRF origin' : s));
    uses.push({ at: m.index ?? 0, pattern: m[1] ?? '', names });
  }
  const matches = (pattern: string, path: string) =>
    pattern === path || (pattern.endsWith('/*') && path.startsWith(pattern.slice(0, -1)));
  const routes: Array<{ method: string; path: string; via: string }> = [];
  const re =
    /\n\s+\.(get|post|all|on)\(\s*(?:\[([^\]]*)\],\s*)?'([^']+)'([\s\S]*?)(?=\n\s+\.(?:get|post|all|on|use)\(|$)/g;
  for (const m of chain.matchAll(re)) {
    const path = m[3] ?? '';
    const method =
      m[1] === 'on' ? (m[2] ?? '').replace(/['\s]/g, '').replace(',', ', ') : (m[1] ?? '').toUpperCase();
    const inline: string[] = [];
    const body = m[4] ?? '';
    if (/bodyLimit\(/.test(body)) inline.push('body limit');
    for (const v of body.matchAll(/validate\('(\w+)',\s*(\w+)\)/g)) inline.push(`zod ${v[1]} \`${v[2]}\``);
    if (m[1] === 'all' && /fail\(c, 404/.test(body)) inline.push('always 404');
    const before = uses.filter((u) => u.at < (m.index ?? 0) && matches(u.pattern, path));
    const via = [...before.flatMap((u) => u.names), ...inline];
    routes.push({ method, path: `${base}${path}`, via: via.join(' → ') || 'none' });
  }
  return routes;
}

/** Code-based TanStack routes: path, and the page component file or redirect target. */
export function webRoutes(src: string): Array<{ path: string; target: string }> {
  const imports = new Map<string, string>();
  for (const m of src.matchAll(/import \{ (\w+) \} from '@\/routes\/([\w-]+)'/g)) {
    imports.set(m[1] ?? '', `routes/${m[2]}.tsx`);
  }
  const out: Array<{ path: string; target: string }> = [];
  for (const block of src.split('createRoute(').slice(1)) {
    const path = /path: '([^']+)'/.exec(block)?.[1];
    if (!path) continue;
    const lazy = /import\('@\/routes\/([\w-]+)'\)/.exec(block)?.[1];
    const comp = /component: (\w+)/.exec(block)?.[1];
    const redirectTo = /redirect\(\{ to: '([^']+)' \}\)/.exec(block)?.[1];
    const guarded = /getParentRoute: \(\) => appRoute/.test(block) ? ', signed in' : '';
    const target = lazy
      ? `routes/${lazy}.tsx (lazy${guarded})`
      : comp && imports.has(comp)
        ? `${imports.get(comp)}${guarded ? ` (${guarded.slice(2)})` : ''}`
        : redirectTo
          ? `redirect to ${redirectTo}`
          : '?';
    out.push({ path, target });
  }
  return out;
}

/** Table name → schema file, from drizzle `pgTable('name'` declarations. */
export function tables(files: Record<string, string>): Array<{ table: string; file: string }> {
  const out: Array<{ table: string; file: string }> = [];
  for (const [file, src] of Object.entries(files)) {
    for (const m of src.matchAll(/pgTable\(\s*'([^']+)'/g)) out.push({ table: m[1] ?? '', file });
  }
  return out;
}

/** Per table: privileges per role and RLS status, from roles.sql. */
export function privileges(sql: string): {
  grants: Map<string, Map<string, string[]>>;
  rls: Map<string, { force: boolean; policies: string[] }>;
} {
  const grants = new Map<string, Map<string, string[]>>();
  const body = sql.replace(/--.*$/gm, '');
  for (const m of body.matchAll(/GRANT\s+([A-Z, ]+?)\s+ON\s+TABLE\s+([\s\S]+?)\s+TO\s+([\w, ]+);/g)) {
    const privs = (m[1] ?? '').split(',').map((p) => p.trim());
    const roles = (m[3] ?? '').split(',').map((r) => r.trim());
    for (const raw of (m[2] ?? '').split(',')) {
      const table = raw
        .trim()
        .replace(/^public\./, '')
        .replace(/"/g, '');
      const byRole = grants.get(table) ?? new Map<string, string[]>();
      for (const role of roles) byRole.set(role, [...(byRole.get(role) ?? []), ...privs]);
      grants.set(table, byRole);
    }
  }
  const rls = new Map<string, { force: boolean; policies: string[] }>();
  for (const m of body.matchAll(/ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY/g)) {
    rls.set(m[1] ?? '', { force: false, policies: [] });
  }
  for (const m of body.matchAll(/ALTER TABLE public\.(\w+) FORCE ROW LEVEL SECURITY/g)) {
    const e = rls.get(m[1] ?? '');
    if (e) e.force = true;
  }
  for (const m of body.matchAll(/CREATE POLICY (\w+) ON public\.(\w+) FOR (\w+) TO (\w+)/g)) {
    rls.get(m[2] ?? '')?.policies.push(`${m[3]} to ${m[4]}`);
  }
  return { grants, rls };
}

// ---------------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------------

export function render(files: string[]): string {
  const missing = [
    ...MODULES.flatMap((s) => s.lines.map(([p]) => p)),
    'packages/db/src/roles.sql',
    'apps/web/src/router.tsx',
  ].filter((p) => !files.includes(p));
  if (missing.length > 0) {
    throw new Error(`scripts/repo-map.ts names paths that no longer exist: ${missing.join(', ')}`);
  }

  const lines: string[] = [
    '# REPO_MAP: DemoLedger',
    '',
    '> GENERATED by `pnpm repo-map` (`scripts/repo-map.ts`). Do not hand-edit; CI runs `pnpm repo-map --check`.',
    '> Contracts: `packages/shared/src/` (schemas and types) · `packages/db/src/roles.sql` (privileges and RLS) ·',
    '> `docs/adr/` (decisions not to reopen) · `CONTEXT.md` (vocabulary).',
    '',
    '## Top level',
    '',
    '| Entry | Purpose |',
    '|---|---|',
    ...TOP_LEVEL.map(([e, p]) => `| \`${e}\` | ${p} |`),
    '',
  ];

  for (const { title, lines: entries } of MODULES) {
    lines.push(`## ${title}`, '');
    for (const [path, role] of entries)
      lines.push(`- \`${path.replace(/^(apps|packages)\/\w+\//, '')}\`: ${role}`);
    lines.push('');
  }

  lines.push('## API routes (generated from `apps/api/src/app.ts`)', '');
  const app = read('apps/api/src/app.ts');
  lines.push(
    `Every request: ${globalMiddleware(app)
      .map((m) => `\`${m}\``)
      .join(' → ')}, then:`,
    '',
  );
  lines.push('| Method | Path | Route middleware, in order |', '|---|---|---|');
  for (const r of apiRoutes(app)) lines.push(`| ${r.method} | \`${r.path}\` | ${r.via} |`);
  lines.push('');

  lines.push('## Web routes (generated from `apps/web/src/router.tsx`)', '');
  for (const r of webRoutes(read('apps/web/src/router.tsx'))) lines.push(`- \`${r.path}\`: ${r.target}`);
  lines.push('');

  lines.push('## Tools the model can call (generated from shared `TOOL_NAMES`)', '');
  lines.push(
    `- Data tools (tenant-bound, \`ledger_reader\`): ${DATA_TOOL_NAMES.map((t) => `\`${t}\``).join(', ')}`,
  );
  lines.push(
    `- Presentational tools (no DB access): ${PRESENTATIONAL_TOOL_NAMES.map((t) => `\`${t}\``).join(', ')}`,
  );
  lines.push('');

  const schemaFiles = Object.fromEntries(
    files
      .filter((f) => /^packages\/db\/src\/schema\/(?!index)\w+\.ts$/.test(f))
      .map((f) => [f.replace('packages/db/src/schema/', ''), read(f)]),
  );
  const { grants, rls } = privileges(read('packages/db/src/roles.sql'));
  const cell = (t: string, role: string) => grants.get(t)?.get(role)?.join(', ') ?? 'none';
  lines.push('## Tables (generated from `packages/db/src/schema/` and `roles.sql`)', '');
  lines.push('| Table | Schema | `ledger_reader` | `ledger_app` | RLS |', '|---|---|---|---|---|');
  for (const { table, file } of tables(schemaFiles)) {
    const r = rls.get(table);
    const rlsCell = r ? `${r.force ? 'FORCE' : 'on'}: ${r.policies.join('; ')}` : 'none';
    lines.push(
      `| \`${table}\` | ${file} | ${cell(table, 'ledger_reader')} | ${cell(table, 'ledger_app')} | ${rlsCell} |`,
    );
  }
  lines.push('');

  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
  lines.push('## Root scripts (generated from `package.json`)', '');
  lines.push(
    Object.keys(scripts)
      .map((s) => `\`${s}\`: ${SCRIPT_PURPOSE[s] ?? scripts[s]}`)
      .join(' · '),
  );
  lines.push('');

  const count = (re: RegExp) => files.filter((f) => re.test(f)).length;
  const jsonl = (f: string) =>
    read(f)
      .split('\n')
      .filter((l) => l.trim() !== '').length;
  lines.push('## Counts', '');
  lines.push(
    `${count(/\.test\.tsx?$/)} test files · ${count(/^docs\/adr\/\d{4}-.*\.md$/)} ADRs · ` +
      `${count(/^packages\/db\/src\/migrations\/\d{4}_.*\.sql$/)} migrations · ` +
      `${jsonl('evals/guard.jsonl')} guard eval prompts · ${jsonl('evals/questions.jsonl')} model eval questions · ` +
      `${count(/^docs\/diagrams\/.*\.svg$/)} diagrams`,
  );
  return `${lines.join('\n').trimEnd()}\n`;
}

function main(): void {
  const content = render(listFiles());
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(OUT, 'utf8');
    } catch {
      // a missing file counts as drift
    }
    if (current !== content) {
      console.error('REPO_MAP.md is stale. Run `pnpm repo-map` and commit the result.');
      process.exit(1);
    }
    console.log('REPO_MAP.md is up to date.');
    return;
  }
  writeFileSync(OUT, content);
  console.log(`wrote REPO_MAP.md (${content.split('\n').length - 1} lines)`);
}

main();
