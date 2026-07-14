import { useState } from 'react';
import { auth } from '../lib/auth';

// The one admin account is created once via the Supabase Dashboard
// (Authentication -> Users -> Add user) — there is no signup flow here.
export default function LoginForm({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError(err.message || 'Sign-in failed.');
      return;
    }
    onSignedIn(data.session);
  }

  return (
    <div className="panel login-panel">
      <h2>Sign in</h2>
      <p className="hint">This device needs the admin account to load or change schedules.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
