import type { SessionView } from '../state/store.js';

const JUDGE_TRIAL_ROLE = 'JUDGE_TRIAL';

/** Shown only when the backend identifies the active session as the dedicated judge-trial role. */
export function JudgeTrialBanner({ session }: { session: SessionView | null }) {
  if (session?.user.role.toUpperCase() !== JUDGE_TRIAL_ROLE) return null;

  return (
    <aside className="judge-trial-banner" role="status" aria-label="Judge Trial access notice" data-testid="judge-trial-banner">
      <strong>Judge Trial Mode</strong>
      <span>Read-only Pro and Admin previews. Five complimentary Drop Pins are shared across this evaluation account. Access expires 7 November 2026.</span>
    </aside>
  );
}
