import { useChat } from '@ai-sdk/react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { MotionConfig, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { PromptInput } from '@/components/ai-elements/prompt-input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { ChatMessageView, ErrorBanner } from '@/components/chat-message';
import { Button } from '@/components/ui/button';
import { describeTransportError } from '@/lib/ask-errors';
import {
  clearStatusLabel,
  consumePromptFocus,
  onPromptFocusRequest,
  requestPromptFocus,
  resetChat,
  useChatInstance,
  useStatusLabel,
} from '@/lib/chat';
import {
  type ChatMessage,
  isWaitingForFirstToken,
  SUGGESTED_QUESTIONS,
  waitingStatusLine,
} from '@/lib/chat-parts';

export function AssistantPage() {
  const chat = useChatInstance();
  const { messages, sendMessage, stop, regenerate, status, error, clearError } = useChat<ChatMessage>({
    chat,
  });
  const statusLabel = useStatusLabel();
  const navigate = useNavigate();
  const { q } = useSearch({ from: '/app/assistant' });
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const busy = status === 'submitted' || status === 'streaming';

  const ask = useCallback(
    (text: string) => {
      // Sending while busy stops the in-flight request first.
      if (busy) stop();
      clearStatusLabel();
      clearError();
      void sendMessage({ text });
    },
    [busy, stop, clearError, sendMessage],
  );

  // Focus requests (New conversation button or command menu) land on the prompt input.
  useEffect(
    () =>
      onPromptFocusRequest(() => {
        consumePromptFocus();
        // Wait a frame so the input exists and is enabled after the reset re-render.
        requestAnimationFrame(() => inputRef.current?.focus());
      }),
    [],
  );

  const newConversation = () => {
    resetChat();
    setDraft('');
    requestPromptFocus();
  };

  // A question handed over from the command menu or a link (?q=...) only prefills the input; the
  // user must press Send, so a crafted link cannot spend quota or start a request by itself.
  const [draft, setDraft] = useState('');
  const handledQuery = useRef<string | null>(null);
  useEffect(() => {
    if (!q || handledQuery.current === q) return;
    handledQuery.current = q;
    setDraft(q);
    void navigate({ to: '/assistant', search: {}, replace: true });
  }, [q, navigate]);

  const last = messages.at(-1);
  const waiting = isWaitingForFirstToken(status, last);
  const transportError = status === 'error' ? describeTransportError(error) : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 py-2">
          <h1 className="text-base font-semibold">Assistant</h1>
          <Button type="button" variant="outline" onClick={newConversation} disabled={messages.length === 0}>
            <PlusIcon aria-hidden />
            New conversation
          </Button>
        </div>
        <Conversation>
          <ConversationContent>
            {messages.length === 0 ? (
              <EmptyState onSelect={ask} />
            ) : (
              messages.map((m, i) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <ChatMessageView
                    message={m}
                    streaming={status === 'streaming' && i === messages.length - 1}
                    onRetry={() => void regenerate()}
                  />
                </motion.div>
              ))
            )}

            {waiting ? (
              <div className="flex items-center gap-3" role="status" aria-live="polite">
                <ThinkingOrb state="solving" size={20} aria-label="Working on your question" />
                <Shimmer>{waitingStatusLine(statusLabel, last)}</Shimmer>
              </div>
            ) : null}

            {transportError ? (
              <ErrorBanner
                message={transportError.message}
                requestId={transportError.requestId}
                onRetry={transportError.retryable ? () => void regenerate() : undefined}
                signInLink={transportError.code === 'unauthorized'}
              />
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="pb-4 pt-2">
          <PromptInput
            busy={busy}
            onSubmit={ask}
            onStop={stop}
            value={draft}
            onValueChange={setDraft}
            inputRef={inputRef}
          />
        </div>
      </div>
    </MotionConfig>
  );
}

function EmptyState({ onSelect }: { onSelect: (q: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-heading">Ask about your transactions</h2>
        <p className="text-muted-foreground">
          The assistant looks up your wallet transactions and answers only from what it finds. It cannot move
          money.
        </p>
      </div>
      <section aria-labelledby="suggested" className="flex flex-col gap-2">
        <h3 id="suggested" className="text-sm font-semibold">
          Suggested questions
        </h3>
        <Suggestions>
          {SUGGESTED_QUESTIONS.map((q) => (
            <Suggestion key={q} suggestion={q} onPick={onSelect} />
          ))}
        </Suggestions>
      </section>
    </div>
  );
}
