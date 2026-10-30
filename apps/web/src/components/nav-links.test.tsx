// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NavLinks } from './nav-links';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

async function renderAt(path: string) {
  const root = createRootRoute({
    component: () => (
      <>
        <NavLinks />
        <Outlet />
      </>
    ),
  });
  const routes = ['/assistant', '/transactions'].map((p) =>
    createRoute({ getParentRoute: () => root, path: p, component: () => <p>page {p}</p> }),
  );
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
}

describe('NavLinks', () => {
  it('are navigation links, not tabs, and only the current route has aria-current="page"', async () => {
    await renderAt('/assistant');
    expect(screen.queryByRole('tab')).toBeNull();
    const assistant = screen.getByRole('link', { name: 'Assistant' });
    const transactions = screen.getByRole('link', { name: 'Transactions' });
    expect(assistant.getAttribute('aria-current')).toBe('page');
    expect(transactions.getAttribute('aria-current')).toBeNull();
  });

  it('draws the 2px underline only under the active link', async () => {
    await renderAt('/transactions');
    const active = screen.getByRole('link', { name: 'Transactions' });
    const inactive = screen.getByRole('link', { name: 'Assistant' });
    expect(active.querySelector('[data-nav-indicator]')).not.toBeNull();
    expect(inactive.querySelector('[data-nav-indicator]')).toBeNull();
    expect(active.querySelector('[data-nav-indicator]')?.className).toContain('h-0.5');
  });

  it('hover changes only the text colour: no background on either state', async () => {
    await renderAt('/assistant');
    const active = screen.getByRole('link', { name: 'Assistant' });
    const inactive = screen.getByRole('link', { name: 'Transactions' });
    for (const link of [active, inactive]) {
      expect(link.className).not.toMatch(/(^|\s)(hover:)?bg-/);
    }
    expect(inactive.className).toContain('text-muted-foreground');
    expect(inactive.className).toContain('hover:text-foreground');
    expect(active.className).toContain('text-foreground');
  });

  it('moves aria-current when the route changes', async () => {
    await renderAt('/assistant');
    await userEvent.setup().click(screen.getByRole('link', { name: 'Transactions' }));
    expect(screen.getByRole('link', { name: 'Transactions' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Assistant' }).getAttribute('aria-current')).toBeNull();
  });
});
