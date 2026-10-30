import { CheckIcon, ChevronRightIcon, CircleAlertIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { summarizeToolOutput } from '@/lib/chat-parts';
import { cn } from '@/lib/utils';

export type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied';

function isRejected(output: unknown): boolean {
  return typeof output === 'object' && output !== null && (output as { ok?: unknown }).ok === false;
}

/** State is shown as an icon plus text (never colour alone). */
function stateIcon(state: ToolState, rejected: boolean): { icon: ReactNode; label: string } {
  if (state === 'output-error' || rejected) {
    return { icon: <CircleAlertIcon className="size-4 text-destructive" aria-hidden />, label: 'Rejected' };
  }
  if (state === 'output-available')
    return { icon: <CheckIcon className="size-4" aria-hidden />, label: 'Completed' };
  return {
    icon: <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />,
    label: 'Running',
  };
}

/** A subtle inline step: small icon + muted text, expandable on click, no card. */
export function Tool({
  title,
  state,
  input,
  output,
  errorText,
}: {
  title: string;
  state: ToolState;
  input: unknown;
  output?: unknown;
  errorText?: string | undefined;
}) {
  const rejected = state === 'output-available' && isRejected(output);
  const { icon, label } = stateIcon(state, rejected);
  const summary = state === 'output-available' ? summarizeToolOutput(output) : null;
  return (
    <Collapsible className="w-full">
      <CollapsibleTrigger className="group -mx-2 flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        {icon}
        <span className="sr-only">{label}: </span>
        <span className="min-w-0 truncate">
          {title}
          {summary ? <span className={cn(rejected && 'text-destructive')}> · {summary}</span> : null}
        </span>
        <ChevronRightIcon
          className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 py-2 pl-6">
          <ToolSection label="Parameters" value={input} />
          {output !== undefined ? <ToolSection label="Result" value={output} /> : null}
          {errorText ? <p className="text-sm text-destructive">{errorText}</p> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolSection({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs text-muted-foreground">{label}</h4>
      <pre className="max-h-64 overflow-auto rounded-xl bg-muted p-3 text-[13px]">
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </div>
  );
}
