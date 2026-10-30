import type {
  AggregateResponse,
  PresentVisualArgs,
  SearchTransactionsResult,
  VisualSpec,
} from '@demoledger/shared';

/**
 * Deterministic VisualSpec builder for `present_visual` (D-26). Pure: it only re-shapes the
 * latest aggregate/search result recorded for THIS request. The model chooses the view
 * (kind/source/title); every number comes from SQL results. No DB access, no model-authored data.
 *
 * Plot values are integer MINOR units (`sum_EUR`) with a server-formatted sibling
 * (`sum_EUR_display`); counts are plain integers. Sums get ONE SERIES PER CURRENCY: currencies are
 * never added together.
 */

export interface VisualSources {
  aggregate?: AggregateResponse | undefined;
  search?: Omit<SearchTransactionsResult, 'ok'> | undefined;
}

export type VisualBuild =
  | { ok: true; spec: VisualSpec; summary: string; points: number }
  | { ok: false; message: string };

const MAX_POINTS = 500;
const fail = (message: string): VisualBuild => ({ ok: false, message });

type Row = Record<string, string | number | null>;

function safeMinor(sum: string | null): number | null {
  if (sum === null) return null;
  const n = Number(sum);
  return Number.isSafeInteger(n) ? n : null;
}

function one(type: 'BarChart' | 'LineChart' | 'Table' | 'Stat', props: object): VisualSpec {
  return { root: 'main', elements: { main: { type, props } as VisualSpec['elements'][string] } };
}

export function buildVisualSpec(args: PresentVisualArgs, src: VisualSources): VisualBuild {
  const { kind, source, title } = args;
  const agg = src.aggregate;
  const search = src.search;

  if (source === 'latest_aggregate' && !agg) {
    return fail(
      'No aggregate result exists in this request. Call aggregate_transactions first (group_by day for a time series), then present_visual.',
    );
  }
  if (source === 'latest_search' && !search) {
    return fail(
      'No search result exists in this request. Call search_transactions first, then present_visual.',
    );
  }

  if (kind === 'bar' || kind === 'line') {
    if (source !== 'latest_aggregate' || !agg) {
      return fail(
        'Charts need grouped totals: call aggregate_transactions with a group_by, then present_visual with source latest_aggregate.',
      );
    }
    if (agg.group_by === 'none') {
      return fail(
        'The aggregate has a single value (group_by none). Use kind stat, or call aggregate_transactions with group_by day, status, wallet, direction or currency.',
      );
    }
    const metric = args.metric ?? agg.metric;
    if (metric !== agg.metric) {
      return fail(
        `The latest aggregate used metric ${agg.metric}; call aggregate_transactions with metric ${metric} first, or omit metric.`,
      );
    }
    if (agg.groups.length === 0)
      return fail(
        'The aggregate matched no transactions, so there is nothing to chart. Tell the user no records matched.',
      );
    if (agg.groups.length > MAX_POINTS)
      return fail(`Too many groups to chart (${agg.groups.length}). Use a narrower period.`);

    const order: string[] = [];
    const byKey = new Map<string, Row>();
    const currencies: string[] = [];
    for (const g of agg.groups) {
      let row = byKey.get(g.key);
      if (!row) {
        row = { key: g.key };
        byKey.set(g.key, row);
        order.push(g.key);
      }
      if (metric === 'count') {
        row.count = g.count;
      } else if (g.currency) {
        if (!currencies.includes(g.currency)) currencies.push(g.currency);
        row[`sum_${g.currency}`] = safeMinor(g.sum_minor);
        row[`sum_${g.currency}_display`] = g.sum_display;
      }
    }
    const series =
      metric === 'count'
        ? [{ key: 'count', label: 'Transactions' }]
        : currencies.map((c) => ({
            key: `sum_${c}`,
            label: `Total ${c}`,
            currency: c as 'EUR' | 'USD' | 'GBP',
          }));
    if (series.length === 0) return fail('The aggregate has no per-currency sums to chart.');
    const data = order.map((k) => byKey.get(k) as Row);
    const spec = one(kind === 'bar' ? 'BarChart' : 'LineChart', { title, xKey: 'key', series, data });
    const what = kind === 'bar' ? 'Bar chart' : 'Line chart';
    return {
      ok: true,
      spec,
      points: data.length,
      summary: `${what} shown: ${series.length} series${metric === 'sum' ? ` (${currencies.join(', ')})` : ''}, ${data.length} ${agg.group_by === 'day' ? 'days' : 'groups'}, grouped by ${agg.group_by}.`,
    };
  }

  if (kind === 'table') {
    if (source === 'latest_search' && search) {
      if (search.rows.length === 0)
        return fail(
          'The search matched no transactions, so there is nothing to tabulate. Tell the user no records matched.',
        );
      const rows: Row[] = search.rows.map((r) => ({
        transaction_id: r.transaction_id,
        occurred_at: r.occurred_at.slice(0, 16).replace('T', ' '),
        wallet_id: r.wallet_id,
        direction: r.direction,
        status: r.status,
        amount: r.amount_display,
        failure_reason: r.status === 'failed' ? (r.failure_reason ?? 'not recorded') : '',
      }));
      const columns = [
        { key: 'transaction_id', label: 'ID' },
        { key: 'occurred_at', label: 'Date (UTC)' },
        { key: 'wallet_id', label: 'Wallet' },
        { key: 'direction', label: 'Direction' },
        { key: 'status', label: 'Status' },
        { key: 'amount', label: 'Amount', align: 'right' as const },
        { key: 'failure_reason', label: 'Failure reason' },
      ];
      return {
        ok: true,
        spec: one('Table', { title, columns, rows }),
        points: rows.length,
        summary: `Table shown: ${rows.length} of ${search.total_matching} matching transactions.`,
      };
    }
    if (agg) {
      if (agg.groups.length === 0)
        return fail(
          'The aggregate matched no transactions, so there is nothing to tabulate. Tell the user no records matched.',
        );
      const rows: Row[] = agg.groups.map((g) => ({
        key: g.key,
        currency: g.currency,
        count: g.count,
        total: g.sum_display,
      }));
      const columns = [
        { key: 'key', label: agg.group_by === 'none' ? 'All' : agg.group_by },
        { key: 'currency', label: 'Currency' },
        { key: 'count', label: 'Count', align: 'right' as const },
        { key: 'total', label: 'Total', align: 'right' as const },
      ];
      return {
        ok: true,
        spec: one('Table', { title, columns, rows }),
        points: rows.length,
        summary: `Table shown: ${rows.length} rows.`,
      };
    }
    return fail('Nothing to tabulate: call aggregate_transactions or search_transactions first.');
  }

  // stat
  if (source === 'latest_search' && search) {
    return {
      ok: true,
      spec: one('Stat', {
        label: title,
        value: String(search.total_matching),
        sublabel: `${search.returned} shown${search.truncated ? ' (truncated)' : ''}`,
      }),
      points: 1,
      summary: 'Stat shown: the number of matching transactions.',
    };
  }
  if (agg) {
    const metric = args.metric ?? agg.metric;
    if (metric === 'count' || agg.metric === 'count') {
      if (agg.group_by !== 'none' && agg.groups.length > 1)
        return fail('The aggregate has several groups; use kind bar, line or table instead of stat.');
      return {
        ok: true,
        spec: one('Stat', {
          label: title,
          value: String(agg.total_matching),
          sublabel: 'matching transactions',
        }),
        points: 1,
        summary: 'Stat shown: the number of matching transactions.',
      };
    }
    if (agg.groups.length !== 1 || !agg.groups[0]?.sum_display) {
      return fail(
        'The aggregate has several groups or currencies; use kind table or bar, or aggregate with group_by none for a single total.',
      );
    }
    const g = agg.groups[0];
    return {
      ok: true,
      spec: one('Stat', {
        label: title,
        value: g.sum_display ?? '',
        sublabel: `${g.count} transactions, ${g.currency}`,
      }),
      points: 1,
      summary: 'Stat shown: a single total.',
    };
  }
  return fail('Nothing to show: call aggregate_transactions or search_transactions first.');
}
