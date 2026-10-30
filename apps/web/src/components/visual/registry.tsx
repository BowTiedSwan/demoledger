import type { VisualSpec } from '@demoledger/shared';
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react';
import { formatSeriesValue } from '@/lib/chart-format';
import { catalog } from './catalog';
import { ChartFigure } from './charts';

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export const { registry } = defineRegistry(catalog, {
  components: {
    BarChart: ({ props }) => <ChartFigure kind="bar" props={props} />,
    LineChart: ({ props }) => <ChartFigure kind="line" props={props} />,
    Stat: ({ props }) => (
      <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">
        <span className="text-sm text-muted-foreground">{props.label}</span>
        <span className="text-heading font-mono tabular-nums">{props.value}</span>
        {props.sublabel ? <span className="text-sm text-muted-foreground">{props.sublabel}</span> : null}
      </div>
    ),
    Table: ({ props }) => (
      <figure className="flex w-full flex-col gap-2">
        <figcaption className="text-base">{props.title}</figcaption>
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted text-muted-foreground">
                {props.columns.map((c) => (
                  <th key={c.key} scope="col" className={`px-3 py-2 ${ALIGN[c.align ?? 'left']}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
                <tr key={i} className="border-t border-border">
                  {props.columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${ALIGN[c.align ?? 'left']}`}>
                      {formatSeriesValue(row[c.key], undefined)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>
    ),
  },
});

/** Render an already validated spec. Nothing in the spec is evaluated: it only selects catalog components. */
export function VisualRenderer({ spec }: { spec: VisualSpec }) {
  // No handlers, no navigation, no functions: the spec has no way to run anything.
  return (
    <JSONUIProvider registry={registry}>
      <Renderer spec={spec} registry={registry} />
    </JSONUIProvider>
  );
}
