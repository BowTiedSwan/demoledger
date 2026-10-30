import { ArrowDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Conversation({ className, ...props }: ComponentProps<typeof StickToBottom>) {
  return (
    <StickToBottom
      className={cn('relative flex-1 overflow-y-hidden', className)}
      initial="smooth"
      resize="smooth"
      role="log"
      aria-label="Conversation"
      {...props}
    />
  );
}

export function ConversationContent({ className, ...props }: ComponentProps<typeof StickToBottom.Content>) {
  return <StickToBottom.Content className={cn('flex flex-col gap-6 p-4 md:p-6', className)} {...props} />;
}

export function ConversationScrollButton({ className }: { className?: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn('absolute bottom-4 left-1/2 -translate-x-1/2', className)}
      onClick={() => scrollToBottom()}
      aria-label="Scroll to latest message"
    >
      <ArrowDownIcon />
    </Button>
  );
}
