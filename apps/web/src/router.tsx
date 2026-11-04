import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { assistantSearch, transactionsSearch } from '@/lib/search-schemas';
import { fetchSession } from '@/lib/session';
import { SuggestedQuestionsProvider } from '@/lib/suggested-questions';
import { LoginPage } from '@/routes/login';
import { NoOrganizationPage } from '@/routes/no-organization';
import { TransactionsPage } from '@/routes/transactions';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-2 px-4">
      <h1 className="text-heading">Page not found</h1>
      <a className="underline underline-offset-4" href="/assistant">
        Go to the assistant
      </a>
    </main>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/assistant' });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: async () => {
    if ((await fetchSession()).status === 'ok') throw redirect({ to: '/assistant' });
  },
  component: LoginPage,
});

/** Pathless layout: requires a session (httpOnly cookie, checked via GET /api/me). */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async () => {
    const session = await fetchSession();
    if (session.status === 'no-organization') throw redirect({ to: '/no-organization' });
    if (session.status !== 'ok') throw redirect({ to: '/login' });
    return { me: session.me };
  },
  component: function AppLayout() {
    const { me } = appRoute.useRouteContext();
    return (
      <SuggestedQuestionsProvider key={`${me.organization.id}:${me.user.id}`}>
        <AppShell me={me} />
      </SuggestedQuestionsProvider>
    );
  },
});

const assistantRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/assistant',
  validateSearch: (search: Record<string, unknown>) => assistantSearch.parse(search),
  // Streamdown + syntax highlighting are heavy: load them only when the assistant opens.
  component: lazyRouteComponent(() => import('@/routes/assistant'), 'AssistantPage'),
});

const transactionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/transactions',
  validateSearch: (search: Record<string, unknown>) => transactionsSearch.parse(search),
  component: TransactionsPage,
});

const noOrganizationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/no-organization',
  component: NoOrganizationPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  noOrganizationRoute,
  appRoute.addChildren([assistantRoute, transactionsRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
