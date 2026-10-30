import type { MeResponse } from '@demoledger/shared';
import { Link, Outlet, useNavigate, useRouter } from '@tanstack/react-router';
import { LogOutIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CommandMenu } from '@/components/command-menu';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { authClient } from '@/lib/auth';
import { resetChat } from '@/lib/chat';
import { cn } from '@/lib/utils';

const navClass =
  'inline-flex min-h-11 items-center rounded-full px-4 text-sm text-muted-foreground hover:bg-muted hover:text-foreground';
const navActive = 'bg-muted text-foreground';

export function AppShell({ me }: { me: MeResponse }) {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

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
    <div className="flex h-svh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-background focus:p-2"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4">
            <span className="py-2 pr-2 text-lg">DemoLedger</span>
            <nav aria-label="Main" className="flex">
              <Link to="/assistant" className={navClass} activeProps={{ className: cn(navClass, navActive) }}>
                Assistant
              </Link>
              <Link
                to="/transactions"
                className={navClass}
                activeProps={{ className: cn(navClass, navActive) }}
              >
                Transactions
              </Link>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-2 py-2">
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
      <main id="main" className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-y-auto px-4">
        <Outlet />
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
