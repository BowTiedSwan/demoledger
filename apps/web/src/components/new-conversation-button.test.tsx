// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getChat, getConversationId, resetChat } from '@/lib/chat';
import { NewConversationButton } from './new-conversation-button';

beforeEach(() => resetChat());
afterEach(cleanup);

describe('NewConversationButton (header)', () => {
  it('is compact, labelled for assistive tech, and disabled while the thread is empty', () => {
    render(<NewConversationButton />);
    const button = screen.getByRole('button', { name: 'New conversation' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // The visible label is hidden on narrow screens; the aria-label keeps the name.
    expect(button.querySelector('span')?.className).toContain('hidden sm:inline');
  });

  it('enables once there are messages and resets messages and conversation id on click', async () => {
    render(<NewConversationButton />);
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
