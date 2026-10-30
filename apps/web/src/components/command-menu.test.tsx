// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CommandMenu } from './command-menu';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

beforeAll(() => {
  // cmdk and Radix expect these browser APIs, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
afterEach(() => {
  cleanup();
  navigate.mockClear();
});

const props = (over: Partial<Parameters<typeof CommandMenu>[0]> = {}) => ({
  open: true,
  onOpenChange: vi.fn(),
  onToggleTheme: vi.fn(),
  onSignOut: vi.fn(),
  ...over,
});

describe('CommandMenu (regression F-28: cmdk store context)', () => {
  it('opens without throwing, accepts typing and selects an item', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<CommandMenu {...p} />);
    const input = await screen.findByPlaceholderText('Type a command or search');
    await user.type(input, 'transactions');
    await user.click(await screen.findByText('Transactions'));
    expect(navigate).toHaveBeenCalledWith({ to: '/transactions' });
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('runs the New conversation entry', async () => {
    const user = userEvent.setup();
    render(<CommandMenu {...props()} />);
    await user.click(await screen.findByText('New conversation'));
    expect(navigate).toHaveBeenCalledWith({ to: '/assistant', search: {} });
  });

  it('Ctrl+K toggles the menu', async () => {
    const p = props({ open: false });
    render(<CommandMenu {...p} />);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    expect(p.onOpenChange).toHaveBeenCalledWith(true);
  });
});
