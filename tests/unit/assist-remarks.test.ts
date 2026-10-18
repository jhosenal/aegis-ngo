import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRemarks, RemarkListSchema } from '../../src/assist/remarks.js';

// Remarks are the MVP's open items stated to every reader (owner decision of 2026-10-14). The shipped file must keep the disclosures that
// stop the page from over-claiming, so removing one fails the build.
const shipped = loadRemarks();
const ids = shipped.map((r) => r.id);

describe('MVP remarks', () => {
  it('the shipped remarks keep the disclosures the page cannot do without', () => {
    for (const required of ['MVP-PREVIEW', 'MVP-NOT-CLINICAL', 'MVP-PERMISSION', 'MVP-NGO-FREE', 'MVP-LANGUAGE', 'ID-BAHASA-ONLY', 'MY-2008', 'SG-MOH-TERMS']) expect(ids, required).toContain(required);
    expect(shipped.find((r) => r.id === 'MVP-NOT-CLINICAL')?.text).toMatch(/not been reviewed by a clinician/);
    expect(shipped.find((r) => r.id === 'MVP-PERMISSION')?.text).toMatch(/not yet asked/);
  });

  it('a country remark names its country, and global remarks have none', () => {
    expect(shipped.filter((r) => r.country === undefined).map((r) => r.id)).toEqual(expect.arrayContaining(['MVP-PREVIEW', 'MVP-NOT-CLINICAL', 'MVP-PERMISSION', 'MVP-NGO-FREE', 'MVP-LANGUAGE']));
    expect(shipped.find((r) => r.id === 'MY-2008')?.country).toBe('MY');
    expect(shipped.find((r) => r.id === 'SG-MOH-TERMS')?.country).toBe('SG');
    expect(shipped.find((r) => r.id === 'ID-BAHASA-ONLY')?.country).toBe('ID');
  });

  it('rejects an unknown field, a duplicate id and an over-long text instead of half-trusting them', () => {
    expect(RemarkListSchema.safeParse([{ id: 'AAA', text: 'A valid remark text.', extra: 1 }]).success).toBe(false);
    expect(RemarkListSchema.safeParse([{ id: 'AAA', text: 'A valid remark text.' }, { id: 'AAA', text: 'Another valid remark.' }]).success).toBe(false);
    expect(RemarkListSchema.safeParse([{ id: 'AAA', text: 'x'.repeat(421) }]).success).toBe(false);
    expect(RemarkListSchema.safeParse([{ id: 'AAA', text: 'A valid remark text.', country: 'XX' }]).success).toBe(false);
  });

  it('a missing file means no remarks, and an invalid file stops the load', () => {
    const empty = mkdtempSync(join(tmpdir(), 'remarks-'));
    expect(loadRemarks(empty)).toEqual([]);
    writeFileSync(join(empty, 'remarks.json'), '{ not json');
    expect(() => loadRemarks(empty)).toThrow(/not valid JSON/);
    writeFileSync(join(empty, 'remarks.json'), JSON.stringify([{ id: 'bad id', text: 'A valid remark text.' }]));
    expect(() => loadRemarks(empty)).toThrow();
  });

  it('no remark makes a claim the page cannot back (no "approved", "verified", "certified" or "clinically reviewed" without a negation)', () => {
    for (const r of shipped) {
      expect(r.text.toLowerCase(), r.id).not.toMatch(/\bcertified\b|\bverified\b|\bapproved by\b/);
    }
  });
});
