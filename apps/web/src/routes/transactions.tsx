import {
  DIRECTIONS,
  type Direction,
  type Period,
  type TransactionDTO,
  type TransactionListResponse,
  type TransactionStatus,
  walletId,
} from '@demoledger/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { CheckCircle2Icon, ClockIcon, XCircleIcon } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { capitalize, failureReasonText, formatSignedAmount, formatTimestamp } from '@/lib/format';
import {
  AuthError,
  listTransactions,
  PAGE_SIZE,
  PERIOD_LABELS,
  PERIOD_OPTIONS,
  STATUS_OPTIONS,
  type TransactionFilters,
} from '@/lib/transactions-api';

const ALL = 'all';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; auth: boolean }
  | { kind: 'ready'; data: TransactionListResponse };

export function TransactionsPage() {
  const search = useSearch({ from: '/app/transactions' });
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  const { id, wallet, status, direction, period, offset } = search;

  useEffect(() => {
    // `reloadKey` is a deliberate re-run trigger for the Retry button.
    void reloadKey;
    const filters: TransactionFilters = { id, wallet, status, direction, period, offset };
    let cancelled = false;
    setState({ kind: 'loading' });
    listTransactions(filters)
      .then((data) => {
        if (!cancelled) setState({ kind: 'ready', data });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof AuthError) {
          setState({
            kind: 'error',
            message: 'Your session has expired. Sign in again to continue.',
            auth: true,
          });
        } else {
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : 'Could not load transactions. Try again.',
            auth: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, wallet, status, direction, period, offset, reloadKey]);

  const update = (patch: Partial<typeof search>) =>
    navigate({ to: '/transactions', search: (prev) => ({ ...prev, offset: undefined, ...patch }) });

  const hasFilters = Boolean(id || wallet || status || direction || period);

  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading">Transactions</h1>
        <p className="text-muted-foreground">Your organization's wallet transactions. Times are in UTC.</p>
      </div>

      <Filters
        wallet={wallet}
        status={status}
        direction={direction}
        period={period}
        hasFilters={hasFilters}
        onChange={update}
        onClear={() => navigate({ to: '/transactions', search: {} })}
      />

      {id ? (
        <p className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <span>
            Showing transaction <span className="font-mono text-[13px]">{id}</span>
          </span>
          <Button variant="outline" onClick={() => update({ id: undefined })}>
            Show all transactions
          </Button>
        </p>
      ) : null}

      <Results
        state={state}
        offset={offset ?? 0}
        onRetry={() => setReloadKey((k) => k + 1)}
        onPage={(o) =>
          navigate({ to: '/transactions', search: (prev) => ({ ...prev, offset: o || undefined }) })
        }
      />
    </div>
  );
}

function Filters(props: {
  wallet: string | undefined;
  status: TransactionStatus | undefined;
  direction: Direction | undefined;
  period: Period | undefined;
  hasFilters: boolean;
  onChange: (patch: {
    wallet?: string | undefined;
    status?: TransactionStatus | undefined;
    direction?: Direction | undefined;
    period?: Period | undefined;
  }) => void;
  onClear: () => void;
}) {
  const walletInputId = useId();
  const walletErrorId = useId();
  const [walletText, setWalletText] = useState(props.wallet ?? '');
  const [walletError, setWalletError] = useState<string | null>(null);

  // Keep the box in step with the URL (Clear filters, back/forward).
  useEffect(() => {
    setWalletText(props.wallet ?? '');
    setWalletError(null);
  }, [props.wallet]);

  const applyWallet = () => {
    const value = walletText.trim().toUpperCase();
    if (value === '') {
      setWalletError(null);
      if (props.wallet) props.onChange({ wallet: undefined });
      return;
    }
    if (!walletId.safeParse(value).success) {
      setWalletError('Use the format WALLET-X-123.');
      return;
    }
    setWalletError(null);
    props.onChange({ wallet: value });
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        applyWallet();
      }}
      aria-label="Filter transactions"
    >
      {/* One row, bottom-aligned; every control shares --control-height and the sans font. */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-48 flex-[2] flex-col gap-2">
          <Label htmlFor={walletInputId}>Wallet</Label>
          <Input
            id={walletInputId}
            value={walletText}
            onChange={(e) => setWalletText(e.target.value)}
            onBlur={applyWallet}
            placeholder="Wallet ID, e.g. WALLET-…"
            aria-invalid={walletError ? true : undefined}
            aria-describedby={walletError ? walletErrorId : undefined}
            autoComplete="off"
          />
        </div>
        <FilterSelect
          label="Status"
          value={props.status}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: capitalize(s) }))}
          onChange={(v) => props.onChange({ status: v as TransactionStatus | undefined })}
        />
        <FilterSelect
          label="Direction"
          value={props.direction}
          options={DIRECTIONS.map((d) => ({ value: d, label: capitalize(d) }))}
          onChange={(v) => props.onChange({ direction: v as Direction | undefined })}
        />
        <FilterSelect
          label="Period"
          value={props.period}
          options={PERIOD_OPTIONS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
          onChange={(v) => props.onChange({ period: v as Period | undefined })}
        />
        <Button type="button" variant="outline" onClick={props.onClear} disabled={!props.hasFilters}>
          Clear filters
        </Button>
      </div>
      {walletError ? (
        <p id={walletErrorId} className="text-sm text-destructive">
          {walletError}
        </p>
      ) : null}
    </form>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-36 flex-1 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Results({
  state,
  offset,
  onRetry,
  onPage,
}: {
  state: LoadState;
  offset: number;
  onRetry: () => void;
  onPage: (offset: number) => void;
}) {
  if (state.kind === 'loading') {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Loading transactions">
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>Could not load transactions</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>{state.message}</span>
          <span>
            {state.auth ? (
              <Button asChild variant="outline">
                <Link to="/login">Sign in</Link>
              </Button>
            ) : (
              <Button variant="outline" onClick={onRetry}>
                Try again
              </Button>
            )}
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  const { items, total_matching, next_offset } = state.data;
  if (items.length === 0) {
    return (
      <p className="rounded-2xl bg-muted p-6 text-muted-foreground" role="status">
        No transactions match these filters.
      </p>
    );
  }

  const from = offset + 1;
  const to = offset + items.length;
  return (
    <div className="flex flex-col gap-4">
      <TransactionsTable items={items} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" role="status">
          Showing {from} to {to} of {total_matching}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={offset === 0}
            onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={next_offset === null}
            onClick={() => next_offset !== null && onPage(next_offset)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

const STATUS_ICON: Record<TransactionStatus, ReactNode> = {
  completed: <CheckCircle2Icon className="size-4" aria-hidden />,
  pending: <ClockIcon className="size-4" aria-hidden />,
  failed: <XCircleIcon className="size-4 text-destructive" aria-hidden />,
};

function StatusCell({ status }: { status: TransactionStatus }) {
  return (
    <span className="inline-flex items-center gap-1">
      {STATUS_ICON[status]}
      {capitalize(status)}
    </span>
  );
}

function TransactionsTable({ items }: { items: TransactionDTO[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Transaction</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Wallet</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Failure reason</TableHead>
            <TableHead>Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((tx) => {
            const reason = failureReasonText(tx);
            return (
              <TableRow key={tx.transaction_id} className="even:bg-row-alt">
                <TableCell className="font-mono text-[13px]">{tx.transaction_id}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-[13px]">
                  {formatTimestamp(tx.occurred_at)}
                </TableCell>
                <TableCell className="font-mono text-[13px]">{tx.wallet_id}</TableCell>
                <TableCell>{capitalize(tx.direction)}</TableCell>
                <TableCell>
                  <StatusCell status={tx.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono text-[13px]">
                  {formatSignedAmount(tx)}
                </TableCell>
                <TableCell className={reason === null ? 'text-muted-foreground' : undefined}>
                  {reason ?? ''}
                </TableCell>
                <TableCell className="min-w-64 whitespace-normal">{tx.description}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
