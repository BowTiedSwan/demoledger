import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Suggestions({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      className={cn('grid gap-2 sm:grid-cols-2 sm:[&>li:last-child:nth-child(odd)]:col-span-2', className)}
      {...props}
    />
  );
}

export function Suggestion({
  suggestion,
  onPick,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick' | 'children'> & {
  suggestion: string;
  onPick: (suggestion: string) => void;
}) {
  return (
    <li className="flex">
      <Button
        type="button"
        variant="outline"
        className={cn(
          'h-auto min-h-11 w-full justify-start whitespace-normal rounded-xl bg-card py-3 text-left font-normal',
          className,
        )}
        onClick={() => onPick(suggestion)}
        {...props}
      >
        {suggestion}
      </Button>
    </li>
  );
}
