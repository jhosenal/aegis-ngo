import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../../../../src/assist/contract.js';
import syntheticFlood from '../../../../tests/fixtures/assist/synthetic-flood.json';
import { buildSpeechSegments, playSpeechSequence } from './speech.js';

const card = syntheticFlood[0] as Card;

describe('spoken coach sequencing', () => {
  it('orders title, card lines, then each source publisher once', () => {
    const segments = buildSpeechSegments(card);

    expect(segments[0]).toEqual({ kind: 'title', text: card.title });
    expect(segments.slice(1, 1 + card.lines.length).map((segment) => segment.kind)).toEqual(card.lines.map(() => 'line'));
    expect(segments.slice(1, 1 + card.lines.length).map((segment) => segment.text)).toEqual(card.lines.map((line) => line.condition
      ? `${line.text} Condition: ${line.condition}`
      : line.text));
    expect(segments.at(-1)).toEqual({ kind: 'sources', text: `Sources: ${card.sources[0]?.publisher}` });
  });

  it('cancels the previous queue, advances in order, and pauses between lines', () => {
    vi.useFakeTimers();
    const played: string[] = [];
    const ended: Array<() => void> = [];
    const calls: string[] = [];
    const onSegment = vi.fn();
    const fakeSynthesis = {
      cancel: () => calls.push('cancel'),
      speak: (text: string, _lang: string, onEnd: () => void) => {
        played.push(text);
        ended.push(onEnd);
      },
    };
    const stop = playSpeechSequence(buildSpeechSegments(card).slice(0, 3), fakeSynthesis, {
      pauseBetweenLinesMs: 500,
      onSegment,
    });

    expect(calls[0]).toBe('cancel');
    expect(played).toEqual([card.title]);
    ended.shift()?.();
    expect(played).toEqual([card.title, card.lines[0]?.text]);
    ended.shift()?.();
    expect(played).toHaveLength(2);
    vi.advanceTimersByTime(499);
    expect(played).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(played).toHaveLength(3);
    expect(onSegment.mock.calls.map(([segment]) => segment.kind)).toEqual(['title', 'line', 'line']);
    stop();
    expect(calls).toEqual(['cancel', 'cancel']);
    vi.useRealTimers();
  });
});
