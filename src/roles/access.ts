import type { Principal } from '../types/domain.js';

/** Account tier and operational role are separate: a coordinator is not automatically Pro. */
export const canUseOperationalTools = (user: Pick<Principal, 'plan' | 'isAdmin'> | null | undefined): boolean =>
  user?.isAdmin === true || user?.plan === 'pro';
