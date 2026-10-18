// The languages an administrator can tick for a bulletin (AEG-NEWS-007). Only English is active; the rest are locked stubs (content/broadcast/language-catalog.json).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const Schema = z.object({
  version: z.string(), note: z.string(),
  languages: z.array(z.object({ code: z.string().regex(/^[a-z]{2}$/), label: z.string().min(2), native: z.string().min(1), group: z.enum(['pilot', 'asean']), state: z.enum(['active', 'locked']) }).strict()).min(1),
}).strict();
export type LanguageCatalog = z.infer<typeof Schema>;
const file = fileURLToPath(new URL('../../../content/broadcast/language-catalog.json', import.meta.url));
export const loadLanguageCatalog = (path = file): LanguageCatalog => Schema.parse(JSON.parse(readFileSync(path, 'utf8')));

/** The ticked languages made valid: only known codes, no repeats, English always included and first. Returns null when a code is unknown. */
export function normalizeLanguages(catalog: LanguageCatalog, codes: unknown): string[] | null {
  if (!Array.isArray(codes) || codes.some((c) => typeof c !== 'string')) return null;
  const known = new Set(catalog.languages.map((l) => l.code));
  if ((codes as string[]).some((c) => !known.has(c))) return null;
  return ['en', ...new Set((codes as string[]).filter((c) => c !== 'en'))];
}
