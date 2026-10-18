import { randomUUID } from 'node:crypto';

export interface IdGen {
  next(prefix: string): string;
}

export class RandomIdGen implements IdGen {
  next(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}

export class SeqIdGen implements IdGen {
  private counter = 0;

  next(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${String(this.counter).padStart(6, '0')}`;
  }
}
