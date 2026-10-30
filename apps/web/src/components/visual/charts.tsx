import { useId } from 'react';
import {
  Bar,
  CartesianGrid,
  Line,
  BarChart as RBarChart,
  ResponsiveContainer,
  LineChart as RLineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatAxisValue,
  formatSeriesValue,
  groupSeriesByCurrency,
  plotValue,
  type SeriesLike,
  seriesColor,
} from '@/lib/chart-format';

type Row = Record<string, string | number | null>;

export interface ChartProps {
  title: string;
  xKey: string;
  series: (SeriesLike & { key: string })[];
  data: Row[];
}

const AXIS = { fontSize: 12, fill: 'var(--chart-axis)' } as const;

function TooltipBody({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: readonly { dataKey?: unknown; value?: unknown; color?: string }[];
  label?: unknown;
  series: SeriesLike[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-sm text-popover-foreground">
      <p className="mb-1 text-muted-foreground">{String(label ?? '')}</p>
      {payload.map((p) => {
        const s = series.find((x) => x.key === p.dataKey);
        return (
          <p key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
            <span>{s?.label ?? String(p.dataKey)}</span>
            <span className="font-mono text-[13px]">{formatSeriesValue(p.value, s?.currency)}</span>
          </p>
        );
      })}
    </div>
  );
}

function Panel({
  kind,
  group,
  props,
  offset,
}: {
  kind: 'bar' | 'line';
  group: ReturnType<typeof groupSeriesByCurrency<ChartProps['series'][number]>>[number];
  props: ChartProps;
  offset: number;
}) {
  const data = props.data.map((row) => {
    const out: Record<string, string | number> = { [props.xKey]: String(row[props.xKey] ?? '') };
    for (const s of group.series) out[s.key] = plotValue(row, s.key);
    return out;
  });
  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
      <XAxis dataKey={props.xKey} tick={AXIS} tickLine={false} axisLine={false} />
      <YAxis
        tick={AXIS}
        tickLine={false}
        axisLine={false}
        width={56}
        tickFormatter={(v: number) => formatAxisValue(v, group.currency)}
      />
      <Tooltip
        cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }}
        content={(p) => <TooltipBody {...p} series={group.series} />}
      />
    </>
  );
  return (
    <div className="flex flex-col gap-2">
      {/* Legend per currency: swatch + label as text, so colour is never the only cue. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label="Legend">
        {group.series.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-full"
              style={{ background: seriesColor(offset + i) }}
              aria-hidden
            />
            {s.label}
            {s.currency ? <span className="font-mono text-[13px]">({s.currency})</span> : null}
          </li>
        ))}
      </ul>
      <div className="h-60 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 240 }}>
          {kind === 'bar' ? (
            <RBarChart {...common}>
              {axes}
              {group.series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  fill={seriesColor(offset + i)}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={40}
                  isAnimationActive={false}
                />
              ))}
            </RBarChart>
          ) : (
            <RLineChart {...common}>
              {axes}
              {group.series.map((s, i) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  stroke={seriesColor(offset + i)}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              ))}
            </RLineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Screen-reader table with the exact values, since the SVG itself is hidden from assistive tech. */
function DataTable({ props }: { props: ChartProps }) {
  return (
    <table className="sr-only">
      <caption>{props.title}</caption>
      <thead>
        <tr>
          <th scope="col">{props.xKey}</th>
          {props.series.map((s) => (
            <th key={s.key} scope="col">
              {s.label}
              {s.currency ? ` (${s.currency})` : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.data.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
          <tr key={i}>
            <th scope="row">{String(row[props.xKey] ?? '')}</th>
            {props.series.map((s) => (
              <td key={s.key}>{formatSeriesValue(row[s.key], s.currency)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A titled chart; sums in different currencies get separate panels (never one shared axis). */
export function ChartFigure({ kind, props }: { kind: 'bar' | 'line'; props: ChartProps }) {
  const titleId = useId();
  const groups = groupSeriesByCurrency(props.series);
  let offset = 0;
  return (
    <figure aria-labelledby={titleId} className="flex w-full flex-col gap-4 rounded-2xl bg-card p-4">
      <figcaption id={titleId} className="text-base">
        {props.title}
      </figcaption>
      {props.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data to chart.</p>
      ) : (
        groups.map((g) => {
          const o = offset;
          offset += g.series.length;
          return <Panel key={g.currency ?? 'none'} kind={kind} group={g} props={props} offset={o} />;
        })
      )}
      <DataTable props={props} />
    </figure>
  );
}
