import type { MeResponse } from '@demoledger/shared';
import { Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { LogOutIcon, MoonIcon, SunIcon } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CommandMenu } from '@/components/command-menu';
import { NavLinks } from '@/components/nav-links';
import { NewConversationButton } from '@/components/new-conversation-button';
import { Button } from '@/components/ui/button';
import { useScrolledWithin } from '@/hooks/use-scrolled';
import { useTheme } from '@/hooks/use-theme';
import { authClient } from '@/lib/auth';
import { resetChat } from '@/lib/chat';

export function AppShell({ me }: { me: MeResponse }) {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const mainRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const scrolled = useScrolledWithin(mainRef, pathname);
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);

  // Content scrolls under the header, so pages pad by the header's real (wrapping) height.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const signOut = async () => {
    const { error } = await authClient.signOut();
    if (error) {
      toast.error('Could not sign out. Try again.');
      return;
    }
    resetChat();
    await router.invalidate();
    await navigate({ to: '/login' });
  };

  return (
    <div
      className="relative h-svh overflow-hidden"
      style={headerHeight ? ({ '--header-height': `${headerHeight}px` } as CSSProperties) : undefined}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-background focus:p-2"
      >
        Skip to content
      </a>
      <header ref={headerRef} data-scrolled={scrolled} className="glass-header absolute inset-x-0 top-0 z-30">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4">
            <span className="py-2 pr-2 text-lg">DemoLedger</span>
            <NavLinks />
          </div>
          <div className="flex flex-wrap items-center gap-2 py-2">
            {pathname === '/assistant' ? <NewConversationButton /> : null}
            <div className="flex min-w-0 flex-col text-right leading-tight" data-testid="identity">
              <span className="truncate text-sm">{me.organization.name}</span>
              <span className="truncate font-mono text-[13px] text-muted-foreground">{me.user.email}</span>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
            </Button>
            <Button variant="outline" onClick={signOut}>
              <LogOutIcon aria-hidden />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main ref={mainRef} id="main" className="absolute inset-0 overflow-y-auto">
        <div className="mx-auto h-full w-full max-w-6xl px-4">
          <Outlet />
        </div>
      </main>
      <CommandMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onToggleTheme={toggleTheme}
        onSignOut={signOut}
      />
    </div>
  );
}
