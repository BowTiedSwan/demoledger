import { useChat } from '@ai-sdk/react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { MotionConfig, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { PromptInput } from '@/components/ai-elements/prompt-input';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { PendingStep } from '@/components/ai-elements/tool';
import { ChatMessageView, ErrorBanner } from '@/components/chat-message';
import { describeTransportError } from '@/lib/ask-errors';
import { clearStatusLabel, consumePromptFocus, onPromptFocusRequest, useChatInstance } from '@/lib/chat';
import { type ChatMessage, pendingStepLabel, runningToolLabel, SUGGESTED_QUESTIONS } from '@/lib/chat-parts';

export function AssistantPage() {
  const chat = useChatInstance();
  const { messages, sendMessage, stop, regenerate, status, error, clearError } = useChat<ChatMessage>({
    chat,
  });
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

  const [draft, setDraft] = useState('');
  // A new conversation (header button or command menu) replaces the Chat: drop the unsent draft too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `chat` identity is the trigger
  useEffect(() => setDraft(''), [chat]);

  // A question handed over from the command menu or a link (?q=...) only prefills the input; the
  // user must press Send, so a crafted link cannot spend quota or start a request by itself.
  const handledQuery = useRef<string | null>(null);
  useEffect(() => {
    if (!q || handledQuery.current === q) return;
    handledQuery.current = q;
    setDraft(q);
    void navigate({ to: '/assistant', search: {}, replace: true });
  }, [q, navigate]);

  const last = messages.at(-1);
  const pending = pendingStepLabel(status, last);
  // One polite live region announces the current step ("Searching transactions", "Analysing the results").
  const announcement = (runningToolLabel(last?.parts ?? []) ?? pending ?? '').replace('…', '');
  const transportError = status === 'error' ? describeTransportError(error) : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-full min-h-0">
        <h1 className="sr-only">Assistant</h1>
        <Conversation className="h-full">
          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
          <ConversationContent className="pt-[calc(var(--header-height)+1.5rem)] pb-44 md:pt-[calc(var(--header-height)+1.5rem)] md:pb-44">
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
                    pendingLabel={i === messages.length - 1 ? pending : null}
                  />
                </motion.div>
              ))
            )}

            {pending && last?.role !== 'assistant' ? (
              <Message from="assistant">
                <MessageContent>
                  <PendingStep label={pending} />
                </MessageContent>
              </Message>
            ) : null}

            {transportError ? (
              <div className="w-full max-w-3xl">
                <ErrorBanner
                  message={transportError.message}
                  requestId={transportError.requestId}
                  onRetry={transportError.retryable ? () => void regenerate() : undefined}
                  signInLink={transportError.code === 'unauthorized'}
                />
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton className="bottom-44" />
        </Conversation>

        <div className="bottom-fade pointer-events-none absolute inset-x-0 bottom-0 pt-10 pb-4">
          <div className="pointer-events-auto">
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
