import { useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/client.js';
import type { SessionView, WorkspaceAction } from '../state/store.js';

interface LoginBarProps {
  session: SessionView | null;
  status: { storage: string; models: string };
  dispatch: (action: WorkspaceAction) => void;
}

/** The top bar: brand, who is signed in, and the storage and model status. Signing in happens on the sign-in screen. */
export function LoginBar({ session, status, dispatch }: LoginBarProps) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<{ storage: string; providerMode: string; modelsEnabled: boolean }>('/api/health')
      .then((health) => dispatch({
        type: 'status',
        storage: health.storage === 'ephemeral-demo' ? 'Ephemeral demo storage' : 'Local',
        models: health.modelsEnabled ? `Models: ${health.providerMode}` : 'Models: disabled',
      }))
      .catch((reason: unknown) => setError(reason instanceof ApiError ? `${reason.code}: ${reason.message}` : 'Health check failed'));
  }, [dispatch]);

  return (
    <header className="login-bar">
      <a className="brand" href="/">Aegis</a>
      {session && <div className="identity">{session.user.displayName} · {session.user.tenantName} · {session.user.role}{session.user.isAdmin ? ' · Admin' : ''}{session.user.plan === 'pro' ? ' · Pro' : ''}</div>}
      <div className="status-strip" aria-live="polite">
        <span data-testid="status-storage" title={status.storage.startsWith('Ephemeral') ? 'Hosted demo, synthetic data, ephemeral storage, not an operational system.' : undefined}>{status.storage}</span>
        <span data-testid="status-models">{status.models}</span>
      </div>
      {error && <span className="inline-error" role="alert">{error}</span>}
    </header>
  );
}
