export interface Clock {
  now(): string;
}

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class FixedClock implements Clock {
  private timestamp: number;

  constructor(iso: string) {
    this.timestamp = parseUtcTimestamp(iso);
  }

  now(): string {
    return new Date(this.timestamp).toISOString();
  }

  set(iso: string): void {
    this.timestamp = parseUtcTimestamp(iso);
  }

  advanceMs(ms: number): void {
    if (!Number.isSafeInteger(ms)) throw new RangeError('Milliseconds must be a safe integer');
    const nextTimestamp = this.timestamp + ms;
    if (!Number.isSafeInteger(nextTimestamp) || Number.isNaN(new Date(nextTimestamp).getTime())) {
      throw new RangeError('Clock value is outside the supported date range');
    }
    this.timestamp = nextTimestamp;
  }
}

function parseUtcTimestamp(iso: string): number {
  const timestamp = Date.parse(iso);
  if (!iso.endsWith('Z') || !Number.isFinite(timestamp)) {
    throw new RangeError('Timestamp must be a valid ISO-8601 UTC value ending in Z');
  }
  return timestamp;
}
