# docs: index

Each fact lives in one place; the other docs point to it.

| Doc | Owns |
|---|---|
| `../README.md` | What DemoLedger is, setup, configuration table (every env var), test credentials, example prompts, curl demo, tests, evals, live smoke, limitations, **Unfinished** |
| `ARCHITECTURE.md` | Request path; production notes: auth, tenant boundaries, monitoring, latency, cost, prompt injection, deployment, incident response, MCP as a future adapter |
| `REQUIREMENTS.md` | R1–R39 traceability: where each requirement is met and its status |
| `EVALS.md` | Committed eval record: what each eval measures, datasets, commands, full 2026-10-30 results (guard, LLM, smoke) |
| `DESIGN.md` | Visual design tokens (Midday-inspired, D-25): colour, shape, type, chat layout; the source of truth is `apps/web/src/styles/globals.css` |
| `DECISIONS.md` | Dated log of process and judgement calls that are not ADRs (D-01…) |
| `AI_DEVELOPMENT.md` | How the AI-assisted build was organised and checked, with the main corrections |
| `review-log.md` | Reviewer findings (finding → severity → fix → status); the source for AI_DEVELOPMENT |
| `adr/` | Decisions not to reopen: 0001 native tool calling (no MCP) · 0002 separate Hono backend · 0003 cookie vs bearer · 0004 two DB roles · 0005 seed anchored to run date · 0006 guard fails open · 0007 Workers AI Free plan and model choice · 0008 server-stored conversation history · 0009 generative UI with server-bound data |
| `PLAN.md` | Build plan: module map, contracts, file ownership, phase gates |
| `TASKS.md` | Shared task list for the build team, plus published interfaces between modules |
| `BUILD_BRIEF.md` | The original build brief given to the team |
| `../CONTEXT.md` | Glossary |
| `../AGENTS.md` (+ `apps/api`, `apps/web`, `packages/db`) | Rules and verified commands for coding agents; `../CLAUDE.md` imports it |
| `../REPO_MAP.md` | Generated file and export map (`pnpm repo-map`); never hand-edited |
