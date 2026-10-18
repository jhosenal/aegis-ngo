// Records an approval or an endorsement for the Assist content, bound to the exact content hash the server would serve.
// Any later change to any card changes the hash and cancels both, so run this at the content freeze, not before.
// Usage:
//   npm run assist:release -- status
//   npm run assist:release -- approve --by "Aegis project team" --evidence S0020 --scope SOURCES_CHECKED_NOT_CLINICAL [--note "..."]
//   npm run assist:release -- endorse --org "Example NGO" --by "A. Person" [--note "..."]
// `approve` and `endorse` print what they would write and need --yes to write it. This is a decision by a named person, never automatic.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadAssistContent } from '../src/assist/content.js';
import { buildApprovalRecord, currentEndorsements, DEFAULT_ENDORSEMENTS_FILE, DEFAULT_RELEASE_FILE, decideRelease, EndorsementSchema, readEndorsements, readReleaseRecord } from '../src/assist/release.js';

const args = process.argv.slice(2);
const command = args[0];
const opt = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name: string): boolean => args.includes(`--${name}`);
const today = new Date().toISOString().slice(0, 10);
const content = loadAssistContent({ draftMedical: false, allowFixture: false });

function fail(message: string): never { console.error(message); process.exit(2); }

if (command === 'status' || command === undefined) {
  console.log(JSON.stringify({
    contentHash: content.hash,
    cards: content.cards.length,
    release: decideRelease(readReleaseRecord(), content.hash),
    endorsements: currentEndorsements(readEndorsements(), content.hash),
  }, null, 2));
} else if (command === 'approve') {
  const by = opt('by'); const evidence = opt('evidence'); const scope = opt('scope');
  if (!by || !evidence || (scope !== 'SOURCES_CHECKED_NOT_CLINICAL' && scope !== 'CLINICAL')) fail('approve needs --by, --evidence and --scope (SOURCES_CHECKED_NOT_CLINICAL or CLINICAL)');
  const note = opt('note');
  const record = buildApprovalRecord({ contentHash: content.hash, reviewedBy: by, reviewedAt: today, evidenceRef: evidence, reviewScope: scope, ...(note ? { note } : {}) });
  console.log(JSON.stringify(record, null, 2));
  if (!flag('yes')) console.log('\nNot written. Add --yes to write it to records/releases/assist-release.json.');
  else { writeFileSync(DEFAULT_RELEASE_FILE, `${JSON.stringify(record, null, 2)}\n`, 'utf8'); console.log(`\nwritten: ${DEFAULT_RELEASE_FILE}`); }
} else if (command === 'endorse') {
  const org = opt('org'); const by = opt('by');
  if (!org || !by) fail('endorse needs --org and --by');
  const note = opt('note');
  const entry = EndorsementSchema.parse({ organisation: org, endorsedBy: by, endorsedOn: today, contentHash: content.hash, ...(note ? { note } : {}) });
  console.log(JSON.stringify(entry, null, 2));
  if (!flag('yes')) console.log('\nNot written. Add --yes to add it to records/releases/assist-endorsements.json.');
  else {
    const existing = existsSync(DEFAULT_ENDORSEMENTS_FILE) ? JSON.parse(readFileSync(DEFAULT_ENDORSEMENTS_FILE, 'utf8')) as unknown[] : [];
    writeFileSync(DEFAULT_ENDORSEMENTS_FILE, `${JSON.stringify([...existing, entry], null, 2)}\n`, 'utf8');
    console.log(`\nwritten: ${DEFAULT_ENDORSEMENTS_FILE}`);
  }
} else {
  fail(`unknown command "${command}". Use status, approve or endorse.`);
}
