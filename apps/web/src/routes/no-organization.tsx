import { useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth';
import { resetChat } from '@/lib/chat';

/** Signed in, but the session lost its active organization. Signing in again restores it. */
export function NoOrganizationPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  const reSignIn = async () => {
    const { error } = await authClient.signOut();
    if (error) {
      setFailed(true);
      return;
    }
    resetChat();
    await router.invalidate();
    await navigate({ to: '/login' });
  };

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
      <h1 className="text-heading">No active organization</h1>
      <Alert role="alert">
        <AlertTitle>Your session has no organization selected</AlertTitle>
        <AlertDescription>Sign out and sign in again to continue.</AlertDescription>
      </Alert>
      {failed ? <p className="text-sm text-destructive">Could not sign out. Try again.</p> : null}
      <Button onClick={reSignIn}>Sign out and sign in again</Button>
    </main>
  );
}
