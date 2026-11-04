import { useNavigate } from '@tanstack/react-router';
import { LogOutIcon, MessageSquareIcon, MoonIcon, PlusIcon, SearchIcon, TableIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { requestPromptFocus, resetChat } from '@/lib/chat';
import { useSuggestedQuestions } from '@/lib/suggested-questions';

/** Cmd/Ctrl+K menu: navigation, suggested questions, theme, sign out. */
export function CommandMenu({
  open,
  onOpenChange,
  onToggleTheme,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
}) {
  const navigate = useNavigate();
  const questions = useSuggestedQuestions();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!mounted) return null;
  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command menu"
      description="Navigate or ask a suggested question."
    >
      <CommandInput placeholder="Type a command or search" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={run(() => navigate({ to: '/assistant' }))}>
            <MessageSquareIcon aria-hidden /> Assistant
          </CommandItem>
          <CommandItem
            onSelect={run(() => {
              resetChat();
              requestPromptFocus();
              void navigate({ to: '/assistant', search: {} });
            })}
          >
            <PlusIcon aria-hidden /> New conversation
          </CommandItem>
          <CommandItem onSelect={run(() => navigate({ to: '/transactions' }))}>
            <TableIcon aria-hidden /> Transactions
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Ask the assistant">
          {questions.map((q) => (
            <CommandItem key={q} onSelect={run(() => navigate({ to: '/assistant', search: { q } }))}>
              <SearchIcon aria-hidden /> {q}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Account">
          <CommandItem onSelect={run(onToggleTheme)}>
            <MoonIcon aria-hidden /> Toggle theme
          </CommandItem>
          <CommandItem onSelect={run(onSignOut)}>
            <LogOutIcon aria-hidden /> Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
