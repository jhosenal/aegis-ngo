import { useEffect, useState } from 'react';
import { mmss, stageOf } from './freshness.js';

/**
 * How old the live Google reading is and when it goes (AEG-FRESH-001): green "Live telemetry" with a countdown, yellow in the last ten minutes, red once it has expired
 * (the numbers are then cleared and a Refresh button appears when a refresh is allowed). Readings live in memory for one hour only; a refresh is an on-demand lookup that is subject to
 * access, quota and cost limits (a credit for a dropped pin).
 */
export function FreshnessBadge({ deadline, demo = false, canRefresh, busy = false, refreshLabel = 'Refresh telemetry', onRefresh, note = '' }:
  { deadline: number | null; demo?: boolean; canRefresh: boolean; busy?: boolean; refreshLabel?: string; onRefresh: () => void; note?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const none = deadline === null || !Number.isFinite(deadline);
  const live = !none && deadline > now;
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);
  const { stage, leftMs } = none ? { stage: 'expired' as const, leftMs: 0 } : stageOf(deadline, now);
  const label = none ? 'No live reading held' : stage === 'live' ? (demo ? 'Sample data' : 'Live telemetry (Google)') : stage === 'warning' ? 'Stale warning' : 'Data expired (60 min limit)';
  return <section className={`fresh-badge is-${none ? 'none' : stage}${demo ? ' is-demo' : ''}`} data-testid="freshness" aria-label="Reading freshness">
    <span className="fresh-dot" aria-hidden="true"/>
    <strong role="status">{label}</strong>
    {!none && stage !== 'expired' && <span className="fresh-timer" role="timer" aria-live="off">Expires in {mmss(leftMs)}</span>}
    {stage === 'warning' && !none && <small>Google readings are shown for one hour only; after that the numbers are cleared.</small>}
    {stage === 'expired' && !none && <small>The numbers were cleared after 60 minutes.</small>}
    {none && <small>Nothing is held for this place yet.</small>}
    {stage === 'expired' && canRefresh && <button type="button" className="fresh-refresh" disabled={busy} onClick={onRefresh}>{busy ? 'Refreshing…' : `↻ ${refreshLabel}`}</button>}
    {note && <small role="alert" className="fresh-note">{note}</small>}
  </section>;
}
