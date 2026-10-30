// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getChat, getConversationId, resetChat } from '@/lib/chat';
import { ConversationActions } from './conversation-actions';
import { NEW_CONVERSATION_DISABLED_HINT, NewConversationButton } from './new-conversation-button';

const ui = (node: React.ReactNode) => <TooltipProvider delayDuration={0}>{node}</TooltipProvider>;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => resetChat());
afterEach(cleanup);

describe('NewConversationButton (header)', () => {
  it('is compact, labelled for assistive tech, and disabled while the thread is empty', () => {
    render(ui(<NewConversationButton />));
    const button = screen.getByRole('button', { name: 'New conversation' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // The visible label is hidden on narrow screens; the aria-label keeps the name.
    expect(button.querySelector('span')?.className).toContain('hidden sm:inline');
  });

  it('enables once there are messages and resets messages and conversation id on click', async () => {
    render(ui(<NewConversationButton />));
    const before = getConversationId();
    const oldChat = getChat();
    await act(async () => {
      oldChat.messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
    });
    const button = screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await userEvent.setup().click(button);

    expect(getConversationId()).not.toBe(before);
    expect(getChat()).not.toBe(oldChat);
    expect(getChat().messages).toEqual([]);
    expect((screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('stronger, separated, and legible when disabled (T-301)', () => {
  it('uses the filled secondary treatment with an edge, not the ghost/outline look', () => {
    render(ui(<NewConversationButton />));
    const button = screen.getByRole('button', { name: 'New conversation' });
    expect(button.className).toContain('bg-secondary');
    expect(button.className).toContain('border-border');
  });

  it('disabled: stays visible at about 60% emphasis with a not-allowed cursor and a hint tooltip', async () => {
    render(ui(<NewConversationButton />));
    const button = screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.className).toContain('disabled:opacity-60');
    const wrapper = button.parentElement as HTMLElement;
    expect(wrapper.className).toContain('cursor-not-allowed');
    await userEvent.setup().hover(wrapper);
    expect((await screen.findAllByText(NEW_CONVERSATION_DISABLED_HINT)).length).toBeGreaterThan(0);
  });

  it('lives in its own labelled group with a vertical separator, apart from the account controls', () => {
    render(ui(<ConversationActions />));
    const group = screen.getByRole('group', { name: 'Conversation actions' });
    expect(group.querySelector('hr[aria-orientation="vertical"]')).not.toBeNull();
    expect(group.querySelector('button')).not.toBeNull();
  });
});
