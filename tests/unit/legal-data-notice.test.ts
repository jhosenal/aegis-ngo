import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const Notice = z.object({
  version: z.string().min(3),
  status: z.string().min(10),
  title: z.string().min(3),
  footerNote: z.string().min(10).max(160),
  sections: z.array(z.object({ heading: z.string().min(3), text: z.string().min(30).max(900) }).strict()).min(5),
}).strict();

const raw = JSON.parse(readFileSync(new URL('../../content/legal/data-sources-and-pilot-notice.json', import.meta.url), 'utf8')) as unknown;
const notice = Notice.parse(raw);
const all = notice.sections.map((s) => s.text).join('\n') + notice.footerNote;

describe('legal: data sources and pilot notice (AEG-ENV-001)', () => {
  it('is a draft, marked as not reviewed by a lawyer', () => {
    expect(notice.status).toMatch(/DRAFT/);
    expect(notice.status).toMatch(/Not reviewed by a lawyer/);
  });

  it('carries the exact Google attribution texts', () => {
    expect(all).toContain('Source: Includes air quality data from Google');
    expect(all).toContain('Source: Includes weather data from Google');
  });

  it('states the pilot and the post-pilot permission plan', () => {
    expect(all).toMatch(/pilot/i);
    expect(all).toMatch(/After the pilot we will ask/);
  });

  it('states the Google limits Aegis actually applies', () => {
    expect(all).toMatch(/not kept for more than one hour/);
    expect(all).toMatch(/text-to-speech/);
    expect(all).toMatch(/no alert source|absence of an alert/);
  });

  it('makes no claim of permission, approval, verification or endorsement it does not have', () => {
    expect(all).not.toMatch(/\b(verified|certified|approved by|licensed by|authorised by|authorized by)\b/i);
    expect(all).not.toMatch(/with (the )?permission of Google/i);
    expect(all).toMatch(/not affiliated with, endorsed by or sponsored by Google/);
  });

  it('does not repeat the unconfirmed owner latency estimates as facts', () => {
    expect(all).not.toMatch(/15 to 45|15-minute|real[- ]time/i);
  });
});

describe('legal: news briefing times match the schedule file (AEG-NEWS-004)', () => {
  it('states the same air and capture times as content/broadcast/schedule.json', async () => {
    const { loadSchedule, slotTimes } = await import('../../src/services/broadcast/schedule.js');
    const times = slotTimes(loadSchedule());
    const section = notice.sections.find((s) => /News briefings/.test(s.heading))!;
    expect(section).toBeDefined();
    const list = (values: string[]): string => `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
    expect(section.text).toContain(`at ${list(times.map((t) => t.airLocal))} Malaysia and Singapore time`);
    expect(section.text).toContain(`at ${list(times.map((t) => t.captureLocal))}`);
    expect(section.text).toMatch(/never read aloud or used to write a briefing/);
  });
});
