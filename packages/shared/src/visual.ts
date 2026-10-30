import { z } from 'zod';
import { currency } from './enums';

/**
 * Generative UI (D-26, ADR 0009): the model picks the view, the server binds the data.
 *
 * `present_visual` is a presentational tool: no DB access. It re-shapes the latest
 * search/aggregate result of THIS request into a VisualSpec, built deterministically on the
 * server and streamed as a `data-visual` part. The web renders it against a fixed catalog with
 * json-render. The model never authors numbers.
 *
 * VisualSpec mirrors json-render's flat spec format (`@json-render/core` 0.21.3:
 * `{ root: string; elements: Record<string, { type; props; children? }> }`) restricted to OUR
 * catalog: no `state`, `on`, `visible`, `repeat` or `watch` (no actions, no bindings).
 */

export const VISUAL_KINDS = ['bar', 'line', 'table', 'stat'] as const;
export const visualKind = z.enum(VISUAL_KINDS);
export type VisualKind = z.infer<typeof visualKind>;

export const VISUAL_SOURCES = ['latest_aggregate', 'latest_search'] as const;
export const visualSource = z.enum(VISUAL_SOURCES);
export type VisualSource = z.infer<typeof visualSource>;

/** `present_visual` tool input. Strict: no data, no numbers, no IDs from the model. */
export const presentVisualArgs = z.strictObject({
  kind: visualKind,
  source: visualSource,
  title: z.string().trim().min(1, { error: 'title must be 1-80 characters' }).max(80, {
    error: 'title must be 1-80 characters',
  }),
  /** For charts from an aggregate; the server defaults to `sum` when omitted. */
  metric: z.enum(['count', 'sum']).optional(),
});
export type PresentVisualArgs = z.output<typeof presentVisualArgs>;

/** One cell: money as a server-formatted string, plus raw `*_minor` numbers for plotting. */
const cell = z.union([z.string(), z.number(), z.null()]);
const dataRow = z.record(z.string(), cell);

/** One series per currency; never mix currencies on one axis. */
const chartSeries = z.strictObject({
  key: z.string().min(1),
  label: z.string(),
  currency: currency.optional(),
});

const chartProps = z.strictObject({
  title: z.string().max(80),
  xKey: z.string().min(1),
  series: z.array(chartSeries).min(1).max(10),
  data: z.array(dataRow).max(500),
});

export const visualElement = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('BarChart'),
    props: chartProps,
    children: z.array(z.string()).max(0).optional(),
  }),
  z.strictObject({
    type: z.literal('LineChart'),
    props: chartProps,
    children: z.array(z.string()).max(0).optional(),
  }),
  z.strictObject({
    type: z.literal('Table'),
    props: z.strictObject({
      title: z.string().max(80),
      columns: z
        .array(
          z.strictObject({
            key: z.string().min(1),
            label: z.string(),
            align: z.enum(['left', 'right', 'center']).optional(),
          }),
        )
        .min(1)
        .max(20),
      rows: z.array(dataRow).max(500),
    }),
    children: z.array(z.string()).max(0).optional(),
  }),
  z.strictObject({
    type: z.literal('Stat'),
    props: z.strictObject({ label: z.string(), value: z.string(), sublabel: z.string().optional() }),
    children: z.array(z.string()).max(0).optional(),
  }),
]);
export type VisualElement = z.infer<typeof visualElement>;
export type VisualComponentType = VisualElement['type'];
export const VISUAL_COMPONENTS = ['BarChart', 'LineChart', 'Table', 'Stat'] as const;

/** json-render flat spec restricted to our catalog. `root` must name an element. */
export const visualSpec = z
  .strictObject({
    root: z.string().min(1),
    elements: z.record(z.string(), visualElement),
  })
  .refine((s) => s.root in s.elements, { message: 'root must reference an element', path: ['root'] });
export type VisualSpec = z.infer<typeof visualSpec>;

/** Payload of the `data-visual` stream part. */
export const visualDataPart = z.object({ id: z.string().min(1), spec: visualSpec });
export type VisualDataPart = z.infer<typeof visualDataPart>;

/** `present_visual` tool result returned to the model (it never sees the bound numbers again). */
export const presentVisualResult = z.object({
  ok: z.literal(true),
  id: z.string(),
  kind: visualKind,
  /** Human-readable note for the model, e.g. "Bar chart shown: 2 series (EUR, USD), 7 days." */
  summary: z.string(),
});
export type PresentVisualResult = z.infer<typeof presentVisualResult>;
