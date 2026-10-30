import { Link } from '@tanstack/react-router';

/** Transaction IDs the answer was grounded on, as compact rounded chips linking to /transactions?id=... */
export function Sources({ ids }: { ids: readonly string[] }) {
  if (ids.length === 0) return null;
  return (
    <section aria-label="Sources" className="flex flex-col gap-2">
      <h4 className="text-xs text-muted-foreground">
        Sources ({ids.length} transaction{ids.length === 1 ? '' : 's'})
      </h4>
      <ul className="flex flex-wrap gap-2">
        {ids.map((id) => (
          <li key={id}>
            <Link
              to="/transactions"
              search={{ id }}
              // The chip is 32px tall; the pseudo-element extends the hit area to 44px.
              className="relative inline-flex h-8 items-center rounded-full bg-muted px-3 font-mono text-[13px] hover:bg-accent before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
            >
              {id}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
