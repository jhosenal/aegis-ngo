import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest, ApiError } from '../api/client.js';

interface Terms { version: string; title: string; status: string; sections: { heading: string; text: string }[] }

interface RegisterDialogProps {
  ticket: string;
  onDone: (token: string) => void;
  onCancel: () => void;
}

/** First Google sign-in: the person reads and accepts the terms, picks a display name, and only then is an account created. */
export function RegisterDialog({ ticket, onDone, onCancel }: RegisterDialogProps) {
  const [terms, setTerms] = useState<Terms | null>(null);
  const [email, setEmail] = useState('');
  const [returning, setReturning] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([
      apiRequest<Terms>('/api/auth/terms'),
      apiRequest<{ email: string; displayName: string; returning: boolean }>('/api/auth/register/preview', { method: 'POST', body: { ticket } }),
    ]).then(([t, who]) => {
      setTerms(t);
      setEmail(who.email);
      setReturning(who.returning);
      setDisplayName(who.displayName);
      nameRef.current?.focus();
    }).catch((reason: unknown) => setError(reason instanceof ApiError ? reason.message : 'Could not load the registration.'));
  }, [ticket]);

  async function submit(): Promise<void> {
    if (!terms) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<{ token: string }>('/api/auth/register', { method: 'POST', body: { ticket, displayName, acceptTerms: accepted, termsVersion: terms.version } });
      onDone(result.token);
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : 'Registration failed.');
      setBusy(false);
    }
  }

  // Portalled to the page: the login bar's blur would otherwise become the containing block of this fixed overlay.
  return createPortal(
    <div className="register-backdrop" role="dialog" aria-modal="true" aria-labelledby="register-title" data-testid="register-dialog">
      <div className="register-panel">
        <h2 id="register-title">{returning ? 'The terms have changed' : 'Create your Aegis account'}</h2>
        {email && <p className="register-email">{returning ? 'Signed in as' : 'Signing up with'} {email}</p>}
        <section aria-label="Account access" data-testid="signup-access">
          <h3>Account access</h3>
          <p>Standard accounts can view public information and use AI chat, subject to usage limits.</p>
          <p>Dropping pins, checking custom locations, saving places and other operational tools require Pro or Admin access granted by the Aegis team. Administrative controls remain Admin-only.</p>
          <p>Signing up does not purchase or automatically unlock Pro access.</p>
        </section>
        {terms && (
          <div className="register-terms" tabIndex={0} aria-label="Terms of use, privacy notice and disclaimer" data-testid="register-terms">
            <p className="register-status">{terms.status}</p>
            {terms.sections.map((section) => (
              <section key={section.heading}>
                <h3>{section.heading}</h3>
                <p>{section.text}</p>
              </section>
            ))}
          </div>
        )}
        {!returning && <><label htmlFor="register-name">Display name</label>
        <input id="register-name" ref={nameRef} value={displayName} maxLength={50} onChange={(event) => setDisplayName(event.currentTarget.value)} autoComplete="nickname" /></>}
        <label className="register-accept">
          <input type="checkbox" data-testid="register-accept" checked={accepted} onChange={(event) => setAccepted(event.currentTarget.checked)} />
          <span>I am at least 13 years old, I have read the terms of use and privacy notice (version {terms?.version ?? '...'}), and I agree to them.</span>
        </label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="register-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" data-testid="register-submit" disabled={!accepted || !terms || (!returning && displayName.trim().length < 2) || busy} onClick={() => void submit()}>{returning ? 'Accept and continue' : 'Create account and sign in'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
