// The shared-password form (spec §3.11). A right password sets the 30-day session cookie and returns to the page that
// asked for it (`?next=`), or to the project list.

import { useState, type FormEvent, type ReactElement } from 'react';
import { ApiError, apiPost, messageOf } from '../api/client.ts';
import { navigate } from '../router.ts';

/** The `next` page to return to, when it is a path of this site; anything else (another site, the login page) is `/`. */
function nextPath(search: string): string {
  const next = new URLSearchParams(search).get('next');
  if (next === null || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/login')) return '/';
  return next;
}

export function LoginPage(): ReactElement {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost<void>('/api/login', { password });
      navigate(nextPath(location.search));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Wrong password');
      else setError(messageOf(err));   // 429: the server's "try again in 15 minutes"
      setBusy(false);
    }
  };
  return (
    <main className="login-page">
      <form className="card login" onSubmit={(e) => void submit(e)}>
        <h1>GTNH Line Planner</h1>
        <label className="field">
          <span>Password</span>
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        </label>
        {error !== null && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={busy || password === ''}>Log in</button>
      </form>
    </main>
  );
}
