import { ChevronRightIcon, SparklesIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Shimmer } from './shimmer';

/** Model reasoning as a subtle inline row, collapsed by default. Only shown if the model emits it. */
export function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  if (text.trim().length === 0) return null;
  return (
    <Collapsible className="w-full">
      <CollapsibleTrigger className="group -mx-2 flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <SparklesIcon className="size-4" aria-hidden />
        {streaming ? <Shimmer>Reasoning</Shimmer> : <span>Reasoning</span>}
        <ChevronRightIcon
          className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="whitespace-pre-wrap py-2 pl-6 text-sm text-muted-foreground">{text}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}
