import { useChat } from '@ai-sdk/react';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requestPromptFocus, resetChat, useChatInstance } from '@/lib/chat';
import type { ChatMessage } from '@/lib/chat-parts';

/**
 * Compact header action, shown on /assistant only. Disabled while the thread is empty. Stops any
 * stream, clears the messages, starts a new server-side conversation and focuses the prompt.
 */
export function NewConversationButton() {
  const chat = useChatInstance();
  const { messages } = useChat<ChatMessage>({ chat });
  return (
    <Button
      type="button"
      variant="outline"
      aria-label="New conversation"
      disabled={messages.length === 0}
      onClick={() => {
        resetChat();
        requestPromptFocus();
      }}
    >
      <PlusIcon aria-hidden />
      <span className="hidden sm:inline">New conversation</span>
    </Button>
  );
}
