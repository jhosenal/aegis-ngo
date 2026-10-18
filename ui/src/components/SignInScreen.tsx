import { useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/client.js';
import type { SessionView, WorkspaceAction } from '../state/store.js';
import { RegisterDialog } from './RegisterDialog.js';

const JUDGE_TRIAL_FORM = import.meta.env.VITE_JUDGE_TRIAL_FORM === 'true'; // off until the /api/auth/judge-trial backend exists

const LOCAL_USERS = [
  { userId: 'DEV-ADMIN', displayName: 'hosen Choong', note: 'administrator, Pro' },
  { userId: 'DEV-PRO', displayName: 'Dev Pro', note: 'Pro' },
] as const;

const LOCAL_TEST_USERS = [
  { userId: 'USER-A-COORD', displayName: 'Amina', note: 'coordinator' },
  { userId: 'USER-A-VIEW', displayName: 'Amina', note: 'viewer' },
  { userId: 'USER-B-COORD', displayName: 'Bima', note: 'coordinator' },
] as const;

const LOGIN_ERRORS: Record<string, string> = {
  denied: 'Google sign-in was cancelled.',
  state: 'Google sign-in expired or was opened in another browser. Try again.',
  exchange: 'Google did not accept the sign-in. Try again.',
  token: 'Google sign-in could not be verified.',
  account_exists: 'An account with this email already exists under a different Google sign-in.',
  busy: 'Too many sign-ins in progress. Try again in a minute.',
};

interface Providers { google: boolean; localPreview?: boolean; devSignIn?: boolean }

const GOOGLE_G = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.85A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.05H2.18a11 11 0 0 0 0 9.9z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.9 10.9 0 0 0 12 1a11 11 0 0 0-9.82 6.05l3.66 2.85C6.71 7.3 9.14 5.38 12 5.38z" /></svg>
);

/**
 * The sign-in page shown before anyone is signed in (modelled on Sonic's): Google first, then a clearly marked bypass below it.
 * Local: the Google button is a preview of the real flow (first-time registration, then straight in), and the bypass lists dev accounts.
 * Hosted: Google is real when configured and otherwise marked "Soon", and the bypass is the synthetic demo users.
 */
export function SignInScreen({ dispatch }: { dispatch: (action: WorkspaceAction) => void }) {
  const [providers, setProviders] = useState<Providers>({ google: false });
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trialUsername, setTrialUsername] = useState('');
  const [trialPassword, setTrialPassword] = useState('');
  const [trialBusy, setTrialBusy] = useState(false);

  useEffect(() => {
    const failure = /[?&]login_error=([a-z_]+)/.exec(window.location.search)?.[1];
    if (failure) {
      setError(LOGIN_ERRORS[failure] ?? 'Google sign-in failed.');
      window.history.replaceState(null, '', window.location.pathname);
    }
    const registering = /^#register=([A-Za-z0-9_-]+)/.exec(window.location.hash)?.[1];
    if (registering) {
      window.history.replaceState(null, '', window.location.pathname);
      setTicket(registering);
    }
    // Google sign-in hands the session over in the URL fragment (never sent to a server); check it with /api/me, then clear the address bar.
    const handed = /^#aegis_session=([0-9a-f]{64})/.exec(window.location.hash)?.[1];
    if (handed) {
      window.history.replaceState(null, '', window.location.pathname);
      void finish(handed);
    }
    void apiRequest<Providers>('/api/auth/providers').then(setProviders).catch(() => undefined);
    // Local computer only (the server says so): the Admin Desk signs in as the local admin by itself. Not after an explicit sign-out in this tab, and never on the landing page.
    if (!failure && !handed && window.location.pathname.startsWith('/admin')) {
      let skip = false;
      try { skip = window.sessionStorage.getItem('aegis.noAutoLogin') === '1'; } catch { /* no storage: sign in as usual */ }
      if (!skip) void apiRequest<{ localAutoLogin?: boolean }>('/api/health').then((h) => { if (h.localAutoLogin === true) void demoLogin('DEV-ADMIN'); }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finish(token: string): Promise<void> {
    try {
      const user = await apiRequest<SessionView['user']>('/api/me', { token });
      dispatch({ type: 'session', session: { token, user } });
    } catch {
      setError('Sign-in could not be completed.');
    }
  }

  async function demoLogin(userId: string): Promise<void> {
    setError(null);
    try {
      dispatch({ type: 'session', session: await apiRequest<SessionView>('/api/session', { method: 'POST', body: { userId } }) });
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? `${reason.code}: ${reason.message}` : 'Sign-in failed');
    }
  }

  async function judgeTrialLogin(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setTrialBusy(true);
    try {
      const session = await apiRequest<SessionView>('/api/auth/judge-trial', {
        method: 'POST',
        body: { username: trialUsername.trim(), password: trialPassword },
      });
      setTrialPassword('');
      dispatch({ type: 'session', session });
    } catch (reason: unknown) {
      setTrialPassword('');
      setError(reason instanceof ApiError ? reason.message : 'Judge Trial sign-in could not be completed.');
    } finally {
      setTrialBusy(false);
    }
  }

  async function previewGoogle(): Promise<void> {
    setError(null);
    try {
      const result = await apiRequest<{ ticket?: string; token?: string }>('/api/auth/dev-google', { method: 'POST', body: {} });
      if (result.ticket) setTicket(result.ticket);
      else if (result.token) await finish(result.token);
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : 'Preview failed');
    }
  }

  const local = providers.devSignIn === true;
  const bypass = local ? [...LOCAL_USERS, ...LOCAL_TEST_USERS] : [];

  return (
    <main className="signin" data-testid="signin-screen">
      <div className="signin-card">
        <img className="signin-logo" src="/brand/aegis-ngo-logo.webp" alt="" />
        <h1>Sign in to Aegis</h1>
        <p className="signin-sub">Continue with Google to open the NGO workspace.</p>

        {providers.google ? (
          <a className="google-signin" data-testid="google-signin" href={`/api/auth/google?returnTo=${encodeURIComponent(window.location.pathname)}`}>{GOOGLE_G}Continue with Google</a>
        ) : providers.localPreview ? (
          <button type="button" className="google-signin" data-testid="google-preview" onClick={() => void previewGoogle()}>
            {GOOGLE_G}Continue with Google<span className="signin-badge">Local preview</span>
          </button>
        ) : (
          <button type="button" className="google-signin" data-testid="google-soon" disabled>
            {GOOGLE_G}Continue with Google<span className="signin-badge">Soon</span>
          </button>
        )}

        {error && <p className="inline-error" role="alert">{error}</p>}

        {JUDGE_TRIAL_FORM && <div className="signin-divider">Judge Trial account</div>}
        {JUDGE_TRIAL_FORM && <form className="judge-trial-login" aria-label="Judge Trial sign in" onSubmit={event => void judgeTrialLogin(event)}>
          <label htmlFor="judge-trial-username">Username</label>
          <input id="judge-trial-username" name="username" autoComplete="username" value={trialUsername} onChange={event => setTrialUsername(event.currentTarget.value)} required />
          <label htmlFor="judge-trial-password">Password</label>
          <input id="judge-trial-password" name="password" type="password" autoComplete="current-password" value={trialPassword} onChange={event => setTrialPassword(event.currentTarget.value)} required />
          <button type="submit" className="judge-trial-submit" disabled={trialBusy || !trialUsername.trim() || !trialPassword}>{trialBusy ? 'Signing in…' : 'Sign in'}</button>
        </form>}
        {JUDGE_TRIAL_FORM && <p className="judge-trial-login-note">Evaluation access is read-only. Five Drop Pins are shared across this trial account; access expires 7 November 2026.</p>}
        {bypass.length > 0 && <>
          <div className="signin-divider">Local development and test accounts</div>
          <ul className="signin-bypass" data-testid="signin-bypass">
            {bypass.map((user) => (
              <li key={user.userId}>
                <button type="button" className="signin-link" data-testid={`dev-login-${user.userId}`} onClick={() => void demoLogin(user.userId)}>
                  <span>{user.displayName}</span><span className="signin-note">{user.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </>}
        <p className="signin-consent">New accounts read and accept the terms of use and privacy notice before they are created.</p>
      </div>
      {ticket && (
        <RegisterDialog
          ticket={ticket}
          onCancel={() => setTicket(null)}
          onDone={(token) => { setTicket(null); void finish(token); }}
        />
      )}
    </main>
  );
}
