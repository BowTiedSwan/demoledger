import { visualDataPart } from '@demoledger/shared';
import { CircleAlertIcon } from 'lucide-react';
import { VisualRenderer } from './registry';

/** Validates a `data-visual` payload with the shared schema, then renders it; invalid specs get a soft callout. */
export function VisualBlock({ data }: { data: unknown }) {
  const parsed = visualDataPart.safeParse(data);
  if (!parsed.success) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground"
      >
        <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
        This visual could not be displayed.
      </div>
    );
  }
  return <VisualRenderer spec={parsed.data.spec} />;
}
