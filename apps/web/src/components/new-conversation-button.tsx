import { useChat } from '@ai-sdk/react';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { requestPromptFocus, resetChat, useChatInstance } from '@/lib/chat';
import type { ChatMessage } from '@/lib/chat-parts';

export const NEW_CONVERSATION_DISABLED_HINT = 'Start a conversation first';

/**
 * Header action for /assistant: a deliberate secondary control (filled, with an edge), clearly
 * stronger than the icon buttons. While the thread is empty it stays visible and legible (60%
 * emphasis, not-allowed cursor, tooltip) instead of disappearing. Stops any stream, clears the
 * messages, starts a new server-side conversation and focuses the prompt.
 */
export function NewConversationButton() {
  const chat = useChatInstance();
  const { messages } = useChat<ChatMessage>({ chat });
  const empty = messages.length === 0;

  const button = (
    <Button
      type="button"
      variant="secondary"
      aria-label="New conversation"
      disabled={empty}
      className="border-border disabled:opacity-60"
      onClick={() => {
        resetChat();
        requestPromptFocus();
      }}
    >
      <PlusIcon aria-hidden />
      <span className="hidden sm:inline">New conversation</span>
    </Button>
  );

  if (!empty) return button;
  // A disabled button gets no pointer events, so the tooltip hangs off a focusable wrapper.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: lets keyboard users reach the hint for the disabled button */}
        <span tabIndex={0} className="inline-flex cursor-not-allowed rounded-lg">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{NEW_CONVERSATION_DISABLED_HINT}</TooltipContent>
    </Tooltip>
  );
}
