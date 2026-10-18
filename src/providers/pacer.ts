import { ProviderError } from '../types/domain.js';

export interface PacerOptions {
  /** Minimum gap between two request starts, in milliseconds. */
  minIntervalMs: number;
  /** Maximum requests per Pacific-time day; 0 disables the cap. */
  dailyCap: number;
  /** Longest a caller may be made to wait for a slot before the call fails fast. */
  maxWaitMs: number;
  /** Wall clock in epoch milliseconds. Injected in tests. */
  now?: () => number;
  /** Abort-aware sleep. Injected in tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const pacificDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new ProviderError('TIMEOUT', 'Request was aborted while waiting for a rate-limit slot')); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ProviderError('TIMEOUT', 'Request was aborted while waiting for a rate-limit slot'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Client-side pacing so one process never hammers a provider: spaces request starts,
 * caps requests per day, and honours a cool-down after the provider says 429 or Retry-After.
 * It only ever delays or refuses a call; it never retries one.
 */
export class RequestPacer {
  private nextStart = 0;
  private blockedUntil = 0;
  private day = '';
  private used = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(private readonly options: PacerOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? abortableSleep;
  }

  /** Marks the provider as unavailable for `ms` milliseconds (for example after a 429). */
  blockFor(ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + Math.max(0, ms));
  }

  /** The pacer's clock, so callers that keep their own cool-down use the same (injectable) time. */
  currentTime(): number { return this.now(); }

  get requestsToday(): number { this.rollDay(); return this.used; }

  /** Waits for a slot. Throws a ProviderError and makes no network call when blocked, over the daily cap, or the wait is too long. */
  async acquire(signal: AbortSignal): Promise<void> {
    this.rollDay();
    const now = this.now();
    if (now < this.blockedUntil) throw new ProviderError('TRANSIENT', 'Provider is cooling down after a rate-limit response');
    if (this.options.dailyCap > 0 && this.used >= this.options.dailyCap) {
      throw new ProviderError('TRANSIENT', 'Local daily request cap reached');
    }
    const start = Math.max(now, this.nextStart);
    const wait = start - now;
    if (wait > this.options.maxWaitMs) throw new ProviderError('TRANSIENT', 'Local rate limit: next request slot is too far away');
    this.nextStart = start + this.options.minIntervalMs;
    this.used += 1;
    if (wait > 0) await this.sleep(wait, signal);
  }

  private rollDay(): void {
    const today = pacificDay.format(new Date(this.now()));
    if (today !== this.day) { this.day = today; this.used = 0; }
  }
}
