export class CircuitBreaker {
  private failures = 0;
  private mode: 'closed' | 'open' | 'half-open' = 'closed';
  private opensUntil = 0;
  private probeClaimed = false;

  constructor(private readonly threshold: number, private readonly cooldownMs: number, private readonly clock: () => number) {}

  canAttempt(): boolean {
    if (this.mode === 'closed') return true;
    if (this.mode === 'open') {
      if (this.clock() < this.opensUntil) return false;
      this.mode = 'half-open';
      this.probeClaimed = false;
    }
    if (this.probeClaimed) return false;
    this.probeClaimed = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.mode = 'closed';
    this.opensUntil = 0;
    this.probeClaimed = false;
  }

  recordFailure(): void {
    if (this.mode === 'half-open') {
      this.trip();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) this.trip();
  }

  trip(): void {
    this.mode = 'open';
    this.opensUntil = this.clock() + this.cooldownMs;
    this.probeClaimed = false;
  }

  state(): 'closed' | 'open' | 'half-open' {
    if (this.mode === 'open' && this.clock() >= this.opensUntil) return 'half-open';
    return this.mode;
  }
}
