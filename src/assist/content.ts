// Loads the Assist content files, validates every card against the contract and returns only what a public visitor may see.
// Only files named *.cards.json are card files (other JSON in the folder, such as shelter data, is ignored). Fail-closed: an invalid file stops the load (and therefore the server start) instead of silently showing less safe content.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectPublicCards, type PublicCard } from './contract.js';

export interface AssistContent { cards: PublicCard[]; hash: string; origin: 'content' | 'synthetic-fixture' | 'none' }

const contentDir = fileURLToPath(new URL('../../content/assist/', import.meta.url));
const fixtureFile = fileURLToPath(new URL('../../tests/fixtures/assist/synthetic-flood.json', import.meta.url));

function readCards(file: string): unknown[] {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch (error) {
    throw new Error(`assist content file ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`assist content file ${file} must contain a JSON array of cards`);
  return parsed;
}

/**
 * `allowFixture` lets a local or test run show the clearly synthetic fixture when no real content exists yet. A cloud deployment
 * passes false, so a missing content directory yields an empty list, never invented content.
 */
export function loadAssistContent(options: { draftMedical: boolean; allowFixture: boolean; dir?: string; fixture?: string }): AssistContent {
  const dir = options.dir ?? contentDir;
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.cards.json')).sort() : [];
  let origin: AssistContent['origin'] = 'content';
  let raw: unknown[] = files.flatMap((f) => readCards(join(dir, f)));
  if (files.length === 0) {
    const fixture = options.fixture ?? fixtureFile;
    if (options.allowFixture && existsSync(fixture)) { raw = readCards(fixture); origin = 'synthetic-fixture'; } else { raw = []; origin = 'none'; }
  }
  const cards = selectPublicCards(raw, { draftMedical: options.draftMedical });
  const hash = createHash('sha256').update(JSON.stringify(cards)).digest('hex');
  return { cards, hash, origin };
}
