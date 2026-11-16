'use client';
import { useState } from 'react';
import { ApiError, post } from './api';

/** Shown until a database is connected. Nothing else can work without one. */
export function NoDatabase({ reason }: { reason?: string }) {
  return (
    <div className="gate">
      <div className="box">
        <h1>Static needs its database</h1>
        {reason === 'database-unreachable' ? (
          <div className="notice warn">A database is connected, but it isn&apos;t answering. Wait a minute and reload.</div>
        ) : (
          <>
            <div className="muted">One-time setup in Vercel. It&apos;s free.</div>
            <ol>
              <li>Open <b>vercel.com</b> and click the <b>static</b> project.</li>
              <li>Click <b>Storage</b> in the top menu.</li>
              <li>Click <b>Create Database</b>, pick <b>Neon</b>, then <b>Continue</b>.</li>
              <li>Keep the <b>Free</b> plan, click <b>Create</b>, then <b>Connect</b>.</li>
              <li>Tell Claude &quot;database done&quot; so the site gets restarted.</li>
            </ol>
          </>
        )}
        <button className="btn" onClick={() => location.reload()}>Check again</button>
      </div>
    </div>
  );
}

/** First run makes the password; after that this is the sign-in box. */
export function SignIn({ firstRun, onDone }: { firstRun: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (firstRun && password !== again) { setError("Those two don't match."); return; }
    setBusy(true);
    setError('');
    try {
      await post(firstRun ? '/api/setup' : '/api/login', { password });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="box">
        <div className="brand" style={{ padding: 0 }}><span className="dot" /> Static</div>
        <h1>{firstRun ? 'Make your password' : 'Sign in'}</h1>
        {firstRun && <div className="muted">This is the only login. Save it in 1Password. At least 8 characters.</div>}
        <form onSubmit={submit}>
          <input type="password" autoFocus autoComplete={firstRun ? 'new-password' : 'current-password'} placeholder="Password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {firstRun && (
            <input type="password" autoComplete="new-password" placeholder="Password again" value={again} onChange={(e) => setAgain(e.target.value)} />
          )}
          {error && <div className="notice err">{error}</div>}
          <button className="btn primary large" disabled={busy || password.length === 0}>{firstRun ? 'Save and open Static' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
