# ADR 0009: Generative UI with server-bound data

Status: accepted, 2026-10-30 (D-26). Live chart check pending: the free daily allowance was exhausted, so it runs after 00:00 UTC (D-27).

## Context
Users ask for charts and tables ("Show me a graph of outgoing transactions for the past week"). That question failed with "could not build a valid lookup": the model had no way to show a view, only text.

Two rules constrain any answer to that:
- **The LLM never does arithmetic.** Counts, sums and rankings come from SQL, and the deterministic checks verify the numbers that appear in prose.
- **Model output is untrusted.** We render no remote content and execute no model-authored markup (F-01).

## Decision
**The model picks the view; the server binds the data.**

- **A presentational tool, `present_visual`.** Its args are strict (`packages/shared/src/visual.ts`), and the model supplies only:
  - `kind`: `bar` · `line` · `table` · `stat`;
  - `source`: `latest_aggregate` · `latest_search`;
  - `title`: 1–80 characters;
  - optionally `metric`: `count` · `sum`.

  There are no data, numbers or IDs in the arguments.
- **No DB access.** `apps/api/src/tools/visual.ts` reads only the results this request's own data tools already returned and recorded. It has no reader dependency (tested), so the read-only registry becomes **2 data tools + 1 presentational tool** (R22).
- **Deterministic spec building on the server** (`buildVisualSpec`):
  - **Bar or line** from a grouped aggregate:
    - plot values are integer minor units (`sum_EUR`), with a server-formatted `sum_EUR_display` next to them;
    - there is **one series per currency**, so currencies never share an axis;
    - counts plot as `count`.
  - **Table** from a search: columns ID, date, wallet, direction, status, amount and failure reason. A null reason on a failed row shows as "not recorded".
  - **Stat** from `total_matching` or a single group.
  - **Mismatches are refused** with a structured error and guidance, for example a chart from a search, or a sum chart over a count aggregate, so the model can make the right lookup first.
- **Transport.** The spec streams as a persistent `data-visual` part, `{ id, spec }`. The tool result returned to the model is only `{ ok, id, kind, summary }`; the model never sees or re-types the bound numbers.
- **Rendering: json-render, catalog-constrained.**
  - The renderer is `@json-render/core` / `@json-render/react` 0.21.3 (Apache-2.0).
  - `VisualSpec` mirrors json-render's flat spec, `{ root, elements: { key: { type, props, children? } } }`, restricted to a fixed catalog:
    - `BarChart` / `LineChart` `{ title, xKey, series[{ key, label, currency? }], data[] }`;
    - `Table` `{ title, columns[{ key, label, align? }], rows[] }`;
    - `Stat` `{ label, value, sublabel? }`.
  - No `state`, `on`, `visible`, `repeat` or `watch`, so there are no actions or bindings.
  - The web validates the part against the shared zod schema before rendering (`apps/web/src/components/visual/`), and charts use recharts.

## How grounding is preserved
- Every number in a visual comes from SQL results already returned in this request. The model contributes only a view choice and a title.
- The existing answer checks still run on the prose. IDs, counts, failure-reason facts and speculation are checked exactly as before; the visual adds no unchecked numbers.
- Money is formatted on the server (`formatMinorUnits`); plotting uses integer minor units, never floats from the model.
- Tests in `apps/api/src/orchestrator/visual-flow.test.ts`:
  - the emitted data equals the SQL result, one series per currency;
  - a table binds the returned rows;
  - wrong-source charts are refused.

  The registry test proves `present_visual` never touches the reader.

## Rejected alternatives
- **The model writes the chart data or a full JSON/HTML spec.** That would reintroduce model-authored numbers (the F-12/F-19 class of error) and model-authored markup, and grounding could not verify it.
- **An MCP UI server.** It would move the same problem behind another protocol and add a hop that would need its own auth. Like the data tools (ADR 0001), presentation stays native in the API process.
- **Markdown tables in the answer text.** The numbers are model-typed, and the format is weak for charts.
- **A bespoke renderer with no spec format.** json-render gives us a typed, catalog-validated flat spec and a React renderer, under a permissive licence.

## Consequences
- Chart, table and stat answers are possible without weakening grounding or the read-only boundary.
- The catalog is the security surface. Adding a component means adding it to the shared schema, the web catalog and a test; components never get actions.
- There is one more tool step for visual questions: a data tool, then `present_visual`. It costs a few more Neurons per such question.
- **Pending:**
  - a live chart check in the UI;
  - eval cases q17 ("Show me a graph of outgoing transactions for the past week.") and q18 (failed per wallet as a bar chart), plus the follow-up cases q15–q16.

  All of these run after the daily quota resets (D-27).
