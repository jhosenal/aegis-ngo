import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/engine/clock.js';
import { RandomIdGen, SeqIdGen } from '../../src/engine/ids.js';

describe('Clock and ID generators', () => {
  it('FixedClock set and advance', () => {
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    expect(clock.now()).toBe('2026-01-01T00:00:00.000Z');

    clock.advanceMs(1500);
    expect(clock.now()).toBe('2026-01-01T00:00:01.500Z');

    clock.set('2026-02-03T04:05:06.000Z');
    expect(clock.now()).toBe('2026-02-03T04:05:06.000Z');
  });

  it('SeqIdGen deterministic and shared counter', () => {
    const ids = new SeqIdGen();
    expect(ids.next('TASK')).toBe('TASK-000001');
    expect(ids.next('TASK')).toBe('TASK-000002');
    expect(ids.next('OTHER')).toBe('OTHER-000003');
  });

  it('RandomIdGen unique over 1000', () => {
    const ids = new RandomIdGen();
    const generated = Array.from({ length: 1000 }, () => ids.next('ITEM'));

    expect(generated.every((id) => id.startsWith('ITEM-'))).toBe(true);
    expect(new Set(generated).size).toBe(1000);
  });
});
