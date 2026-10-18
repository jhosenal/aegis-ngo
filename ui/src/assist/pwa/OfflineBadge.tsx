import { useOnlineStatus } from './register.js';

export function OfflineBadge() {
  const online = useOnlineStatus();
  if (online) return null;
  return <p role="status">{'Offline \u2013 showing saved guidance'}</p>;
}
