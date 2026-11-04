# apps/web: scoped rules

Vite + React 19 SPA, TanStack Router, shadcn (radix-nova), Tailwind v4, AI SDK `useChat`, json-render. The root `AGENTS.md` applies too.

- Visual design is Midday-inspired (D-25, `docs/DESIGN.md`). Colours, radii, type and motion exist only as tokens in `src/styles/globals.css`; never hard-code a colour in a component.
- Midday is AGPL-3.0: never copy its code, name, logo or assets. Reimplement the look from tokens. Use no other third-party brand name in UI copy, code or comments either.
- Use the typed `hc<AppType>` client in `src/lib/api.ts` for REST, and the shared types (`@demoledger/shared`) for every payload. Do not redefine API shapes locally.
- Auth is the httpOnly session cookie through the Vite `/api` proxy (same origin). Never store tokens or session data in `localStorage` or JS memory; only the theme lives in `localStorage`.
- Model output is untrusted. `MessageResponse` keeps `allowedImagePrefixes: []` and same-origin-only links, and `csp.ts` keeps `img-src 'self' data:; connect-src 'self'`. `message.test.tsx` and `csp.test.ts` guard both; do not loosen them.
- Visual answers render only `data-visual` parts that validate against the shared `visualSpec`, through the fixed catalog in `src/components/visual/` (BarChart, LineChart, Table, Stat). Never add actions, state bindings or components that execute model-authored content.
- Show error and warning copy from the shared constants through `src/lib/ask-errors.ts`; never render raw provider or server text.
- The first four suggested-question templates in `src/lib/chat-parts.ts` are verbatim from the assignment; keep the templates unchanged. Runtime suggestions substitute wallet IDs from the signed-in organization's ledger (T-296); omit wallet-specific suggestions until that lookup succeeds. The fifth (the chart prompt) is ours.
- cmdk primitives must render inside a `<Command>` root (`CommandDialog` provides it; F-28, covered by `command-menu.test.tsx`).
- Format amounts from integer minor units (`src/lib/format.ts`). Failed rows without a reason show "Not recorded".
