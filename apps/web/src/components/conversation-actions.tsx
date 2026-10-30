import { NewConversationButton } from '@/components/new-conversation-button';

/**
 * Conversation-level actions, kept on the left next to the navigation and away from the account
 * cluster (org, theme, Sign out), so nobody hits one when reaching for the other. Future
 * conversation actions join this group. Shown on /assistant only.
 */
export function ConversationActions() {
  return (
    <fieldset className="m-0 flex min-w-0 items-center gap-3 border-0 p-0">
      <legend className="sr-only">Conversation actions</legend>
      <hr aria-orientation="vertical" className="m-0 ml-1 h-6 w-px border-0 bg-border" />
      <NewConversationButton />
    </fieldset>
  );
}
