import { Link } from '@tanstack/react-router';
import { CircleAlertIcon, ShieldAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Reasoning } from '@/components/ai-elements/reasoning';
import { Sources } from '@/components/ai-elements/sources';
import { PendingStep, Tool, type ToolState } from '@/components/ai-elements/tool';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VisualBlock } from '@/components/visual/visual-block';
import {
  type ChatMessage,
  messageNotices,
  sourceLinks,
  toolNameOfPart,
  toolTitle,
  ungroundedTitle,
} from '@/lib/chat-parts';

function guardTitle(verdict: string): string {
  if (verdict === 'block') return 'Request blocked';
  if (verdict === 'unavailable') return 'Safety check unavailable';
  return 'Request flagged';
}

export function ErrorBanner({
  title = 'The assistant could not answer',
  message,
  requestId,
  onRetry,
  signInLink,
}: {
  title?: string;
  message: string;
  requestId?: string | undefined;
  onRetry?: (() => void) | undefined;
  signInLink?: boolean;
}) {
  return (
    <Alert variant="destructive" role="alert" className="callout-soft w-full">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{message}</span>
        {requestId ? <span className="font-mono text-[13px]">Request ID: {requestId}</span> : null}
        <span className="flex flex-wrap gap-2">
          {onRetry ? (
            <Button type="button" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {signInLink ? (
            <Button asChild variant="outline">
              <Link to="/login">Sign in</Link>
            </Button>
          ) : null}
        </span>
      </AlertDescription>
    </Alert>
  );
}

export function ChatMessageView({
  message,
  streaming,
  onRetry,
  pendingLabel = null,
}: {
  message: ChatMessage;
  streaming: boolean;
  onRetry: () => void;
  /** Shown as the last step row while the model is between steps (see pendingStepLabel). */
  pendingLabel?: string | null;
}) {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    return (
      <Message from="user">
        <MessageContent>
          <p className="whitespace-pre-wrap break-words">{text}</p>
        </MessageContent>
      </Message>
    );
  }

  const notices = messageNotices(message.parts);
  const sources = sourceLinks(message.parts);
  const lastIndex = message.parts.length - 1;

  return (
    <Message from="assistant">
      <MessageContent>
        {message.parts.map((part, i) => {
          const key = `${message.id}-${i}`;
          if (part.type === 'text') {
            return part.text.trim().length === 0 ? null : (
              <MessageResponse key={key} isAnimating={streaming && i === lastIndex}>
                {part.text}
              </MessageResponse>
            );
          }
          if (part.type === 'reasoning') {
            return <Reasoning key={key} text={part.text} streaming={streaming && i === lastIndex} />;
          }
          if (part.type === 'data-visual') {
            return <VisualBlock key={key} data={part.data} />;
          }
          if (toolNameOfPart(part)) {
            const tp = part as {
              type: string;
              state: ToolState;
              input?: unknown;
              output?: unknown;
              errorText?: string;
            };
            return (
              <Tool
                key={key}
                title={toolTitle(tp)}
                state={tp.state}
                input={tp.input ?? {}}
                output={tp.output}
                errorText={tp.errorText}
              />
            );
          }
          return null;
        })}

        {notices.guard ? (
          <Alert role="status" className="w-full">
            <ShieldAlertIcon aria-hidden />
            <AlertTitle>{guardTitle(notices.guard.verdict)}</AlertTitle>
            <AlertDescription>{notices.guard.message}</AlertDescription>
          </Alert>
        ) : null}

        {notices.ungrounded.map((w) => (
          <div
            key={`${w.kind ?? ''}-${w.message}`}
            className="flex flex-col gap-2 rounded-xl bg-muted px-4 py-3"
            role="status"
          >
            <Badge variant="outline" className="w-fit gap-1 border-transparent bg-background text-warning">
              <TriangleAlertIcon aria-hidden />
              {ungroundedTitle(w.kind)}
            </Badge>
            <p className="text-sm">{w.message}</p>
            {w.ids.length > 0 ? (
              <p className="font-mono text-[13px] text-muted-foreground">{w.ids.join(', ')}</p>
            ) : null}
          </div>
        ))}

        {notices.error ? (
          <ErrorBanner
            message={notices.error.message}
            requestId={notices.error.requestId}
            onRetry={notices.error.retryable ? onRetry : undefined}
          />
        ) : null}

        {pendingLabel ? <PendingStep label={pendingLabel} /> : null}

        <Sources ids={sources.map((s) => s.id)} />
      </MessageContent>
    </Message>
  );
}
