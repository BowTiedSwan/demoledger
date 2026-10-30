import { useNavigate, useRouter } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth';
import { resetChat } from '@/lib/chat';

/** Seeded, fictional test accounts documented in the README. Quick-fill only; the user still submits. */
const TEST_ACCOUNTS = [
  { label: 'Sign in as Alpha ops', email: 'ops.alpha@demoledger.test', password: 'AlphaLedger#2026' },
  { label: 'Sign in as Beta ops', email: 'ops.beta@demoledger.test', password: 'BetaLedger#2026' },
] as const;

export function LoginPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { error: authError } = await authClient.signIn.email({ email, password });
      if (authError) {
        setError(
          authError.status === 401 || authError.status === 400
            ? 'The email or password is incorrect.'
            : 'Could not sign in. Try again.',
        );
        return;
      }
      resetChat();
      await router.invalidate();
      await navigate({ to: '/assistant' });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="grid-backdrop flex min-h-svh w-full flex-col items-center justify-center px-4 py-8">
      <div className="glass flex w-full max-w-md flex-col gap-8 rounded-3xl p-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-heading">DemoLedger</h1>
          <p className="text-muted-foreground">Sign in to ask questions about your wallet transactions.</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error ? (
            <Alert variant="destructive" id={errorId} role="alert">
              <AlertTitle>Sign-in failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              id={emailId}
              className="glass-field"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={passwordId}>Password</Label>
            <Input
              id={passwordId}
              className="glass-field"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          <Button type="submit" disabled={pending || email.length === 0 || password.length === 0}>
            {pending ? 'Signing in' : 'Sign in'}
          </Button>
        </form>

        <section aria-labelledby="test-accounts" className="flex flex-col gap-2 pt-2">
          <h2 id="test-accounts" className="text-sm font-semibold">
            Test accounts
          </h2>
          <p className="text-sm text-muted-foreground">Fictional demo users. Fill the form, then sign in.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {TEST_ACCOUNTS.map((a) => (
              <Button
                key={a.email}
                type="button"
                variant="outline"
                className="glass-field flex-1"
                onClick={() => {
                  setEmail(a.email);
                  setPassword(a.password);
                  setError(null);
                }}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
