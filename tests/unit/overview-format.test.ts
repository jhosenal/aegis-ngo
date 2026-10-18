import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatCount, parseOverview, type Overview } from '../../src/overview/contract.js';
import { formatAbsolute, priorityChip, relativeTime } from '../../ui/src/overview/lib/format.js';

const stub = JSON.parse(readFileSync(new URL('../../content/overview/stub-haze-incident.json', import.meta.url), 'utf8')) as Overview;

describe('overview formatting helpers', () => {
  it('uses the overview generatedAt clock for stable relative times', () => {
    expect(relativeTime('2026-10-14T08:30:00+08:00', '2026-10-14T10:30:00+08:00')).toBe('2 hours ago');
    expect(relativeTime('2026-10-14T05:30:00+08:00', '2026-10-14T10:30:00+08:00')).toBe('5 hours ago');
    expect(relativeTime('2026-10-14T02:30:00+08:00', '2026-10-14T10:30:00+08:00')).toBe('8 hours ago');
    expect(relativeTime('2026-10-14T10:29:00+08:00', '2026-10-14T10:30:00+08:00')).toBe('1 minute ago');
  });

  it('formats an absolute incident time in its own offset', () => {
    expect(formatAbsolute('2026-10-14T08:24:00+08:00')).toBe('14 Oct 2026, 08:24 (UTC+8)');
    expect(formatAbsolute(null)).toBe('Unknown');
  });

  it('maps every priority to a word and a text-safe chip class', () => {
    expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].map((p) => priorityChip(p as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'))).toEqual([
      { label: 'Critical', className: 'critical' }, { label: 'High', className: 'high' }, { label: 'Medium', className: 'medium' },
      { label: 'Low', className: 'low' }, { label: 'Unknown', className: 'unknown' },
    ]);
    expect(formatCount(null)).toBe('Unknown');
  });

  it('keeps nullable values as Unknown in the parsed data contract', () => {
    const data = structuredClone(stub) as Overview;
    data.kpis.peopleAtRisk.total = null;
    data.map.areas[0]!.aqi = null;
    data.shortfall[0]!.shortfall = null;
    const overview = parseOverview(data);
    expect(formatCount(overview.kpis.peopleAtRisk.total)).toBe('Unknown');
    expect(formatCount(overview.map.areas[0]!.aqi)).toBe('Unknown');
    expect(formatCount(overview.shortfall[0]!.shortfall)).toBe('Unknown');
  });
});
