import { ASK_LIMITS } from '@demoledger/shared';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type RefObject, useId } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Question box. Enter sends, Shift+Enter inserts a newline. When a request is in flight, sending
 * a new question stops it first (handled by `onSubmit`'s owner); a separate Stop button is shown too.
 */
export function PromptInput({
  busy,
  onSubmit,
  onStop,
  value,
  onValueChange,
  inputRef,
}: {
  busy: boolean;
  onSubmit: (text: string) => void;
  onStop: () => void;
  value: string;
  onValueChange: (text: string) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const text = value;
  const setText = onValueChange;
  const id = useId();
  const trimmed = text.trim();

  const send = () => {
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
    setText('');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="focus-wrapper flex flex-col gap-2 rounded-2xl border border-input bg-card p-2"
    >
      <Label htmlFor={id} className="sr-only">
        Ask about your transactions
      </Label>
      <Textarea
        id={id}
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={ASK_LIMITS.maxQuestionChars}
        rows={2}
        placeholder="Ask about your transactions, for example a wallet, a status or a date."
        className="focus-inner min-h-16 resize-none rounded-xl border-0 bg-transparent shadow-none dark:bg-transparent"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Enter to send, Shift+Enter for a new line.</p>
        <div className="flex gap-2">
          {busy ? (
            <Button type="button" variant="outline" onClick={onStop}>
              <SquareIcon aria-hidden />
              Stop
            </Button>
          ) : null}
          <Button type="submit" disabled={trimmed.length === 0}>
            <ArrowUpIcon aria-hidden />
            {busy ? 'Stop and send' : 'Send'}
          </Button>
        </div>
      </div>
    </form>
  );
}
