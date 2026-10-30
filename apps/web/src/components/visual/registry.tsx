import type { VisualSpec } from '@demoledger/shared';
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react';
import { formatSeriesValue } from '@/lib/chart-format';
import { catalog } from './catalog';
import { ChartFigure } from './charts';

/** Only free-text columns may wrap; IDs, wallets, dates, amounts and statuses stay on one line. */
const WRAPPING_COLUMN = /description|reason|note|memo|counterparty/i;
export function wrapClass(key: string): string {
  return WRAPPING_COLUMN.test(key) ? 'min-w-48 whitespace-normal' : 'whitespace-nowrap';
}

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
      <figure className="flex w-full min-w-0 flex-col gap-2">
        <figcaption className="text-base">{props.title}</figcaption>
        <div className="scroll-edges max-w-full overflow-x-auto rounded-2xl border border-border">
          <table className="w-max min-w-full text-sm">
            <thead>
              <tr className="bg-muted text-muted-foreground">
                {props.columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`px-3 py-2 ${wrapClass(c.key)} ${ALIGN[c.align ?? 'left']}`}
                  >
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
                    <td
                      key={c.key}
                      className={`px-3 py-2 tabular-nums ${wrapClass(c.key)} ${ALIGN[c.align ?? 'left']}`}
                    >
                      {row[c.key] === null || row[c.key] === undefined || row[c.key] === '' ? (
                        <span role="img" aria-label="Not applicable">
                          —
                        </span>
                      ) : (
                        formatSeriesValue(row[c.key], undefined)
                      )}
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
