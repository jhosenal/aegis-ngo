import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseCatalogue, CatalogueSchema } from '../../src/domains/catalogue.js';

// The catalogue is a public claim about what exists. These tests keep it tied to the repository: a domain may be marked as running only
// if its module exists, every specification and audit note it cites must exist, and the wording must not say "verified" where the audit
// found unsupported constants.

const root = process.cwd();
const inbox = join(root, 'docs', '99-inbox');
const raw = JSON.parse(readFileSync(join(root, 'content', 'domains', 'catalogue.json'), 'utf8')) as unknown;
const catalogue = parseCatalogue(raw);
// The specification files (0003 to 0009, 0013) are the owner's documents and may be absent from a checkout; the tests that read them
// skip in that case (the reason is in the test name) and fail if a file is present and disagrees with the catalogue.
const specsPresent = ['0003_', '0004_', '0005_', '0006_', '0007_', '0008_', '0009_', '0013_'].every((p) => existsSync(inbox) && readdirSync(inbox).some((f) => f.startsWith(p)));

describe('hazard domain catalogue', () => {
  it('holds the seven domains exactly once and rejects a missing or extra one', () => {
    expect(catalogue.domains.map((d) => d.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(CatalogueSchema.safeParse({ ...catalogue, domains: catalogue.domains.slice(1) }).success).toBe(false);
    expect(CatalogueSchema.safeParse({ ...catalogue, domains: [...catalogue.domains.slice(0, 6), catalogue.domains[0]] }).success).toBe(false);
  });

  it('marks a domain as running only if its engine module exists', () => {
    for (const d of catalogue.domains) {
      const modulePath = join(root, 'src', 'registry', 'formulations', `${d.name.toLowerCase()}.ts`);
      expect(d.runsInEngine, `${d.name}: runsInEngine must equal whether ${modulePath} exists`).toBe(existsSync(modulePath));
    }
  });

  it('says plainly that none of the seven runs, for as long as that is true', () => {
    if (catalogue.domains.every((d) => !d.runsInEngine)) expect(catalogue.statement).toMatch(/None of the seven runs/);
  });

  it.skipIf(!specsPresent)('cites a specification file and an audit note that exist (skipped if the owner\'s specification files are not in this checkout)', () => {
    const inboxFiles = readdirSync(inbox);
    for (const d of catalogue.domains) {
      const specName = d.specFile.replace(/ \(.*$/, '');
      expect(inboxFiles, `specification for ${d.name}`).toContain(specName);
      expect(inboxFiles.some((f) => f.startsWith(`${d.auditNote}_`)), `audit note ${d.auditNote} for ${d.name}`).toBe(true);
    }
  });

  it('every domain shows at least one supported and one held-back finding, so the audit is never presented as a clean pass', () => {
    for (const d of catalogue.domains) {
      expect(d.audit.some((a) => a.kind === 'supported'), `${d.name} supported`).toBe(true);
      expect(d.audit.some((a) => a.kind === 'held-back'), `${d.name} held back`).toBe(true);
    }
  });

  it('every domain has its icon, and the hero image stays small enough for a phone connection', () => {
    for (const d of catalogue.domains) {
      const icon = join(root, 'ui', 'public', 'brand', 'domains', `${d.name.toLowerCase()}.png`);
      expect(existsSync(icon), `icon for ${d.name}`).toBe(true);
      expect(statSync(icon).size, `icon size for ${d.name}`).toBeLessThan(40 * 1024);
    }
    const hero = join(root, 'ui', 'public', 'brand', 'hazard-panorama.webp');
    expect(existsSync(hero)).toBe(true);
    expect(statSync(hero).size).toBeLessThan(600 * 1024);
  });

  it('never calls the domains "source-verified" or "fully verified"', () => {
    const text = JSON.stringify(raw).toLowerCase();
    expect(text).not.toContain('source-verified');
    expect(text).not.toContain('fully verified');
    expect(text).not.toContain('each specification was audited');   // the audit notes cover selected rows, not whole specifications (S0019 cross-check)
  });

  it.skipIf(!specsPresent)('the hazard-domain names match the master architecture table (skipped if the specification files are not in this checkout)', () => {
    const master = readFileSync(join(inbox, '0009_AEG-FRM-000_master-integration-architecture.md'), 'utf8');
    for (const d of catalogue.domains) expect(master, d.refId).toMatch(new RegExp(`\\*\\*${d.refId}\\*\\*[^\\n]*\\*\\*${d.name}\\*\\*`));
  });
});
