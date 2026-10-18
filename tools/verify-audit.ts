import { readFile } from 'node:fs/promises';
import { verifyChain, type AuditEvent, type Checkpoint } from '../src/audit/chain-core.js';

interface AuditExportFile {
  format: 'aegis-audit-export/1';
  scope: { productId: string; tenantId: string };
  canonicalization: 'canonical-json-v1';
  hashDomain: 'AEG-EVT-v1';
  genesis: string;
  events: AuditEvent[];
}

function isAuditExport(value: unknown): value is AuditExportFile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.format !== 'aegis-audit-export/1' || record.canonicalization !== 'canonical-json-v1' || record.hashDomain !== 'AEG-EVT-v1' || record.genesis !== '0'.repeat(64) || !Array.isArray(record.events)) return false;
  const scope = record.scope;
  return scope !== null && typeof scope === 'object' && !Array.isArray(scope)
    && typeof (scope as Record<string, unknown>).productId === 'string'
    && typeof (scope as Record<string, unknown>).tenantId === 'string';
}

function parseCheckpoint(args: string[]): Checkpoint | undefined {
  const sequenceIndex = args.indexOf('--checkpoint-seq');
  const hashIndex = args.indexOf('--checkpoint-hash');
  if (sequenceIndex < 0 && hashIndex < 0) return undefined;
  const sequenceText = args[sequenceIndex + 1];
  const hash = args[hashIndex + 1];
  const sequence = Number(sequenceText);
  if (sequenceIndex < 0 || hashIndex < 0 || !Number.isSafeInteger(sequence) || sequence < 1 || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('Invalid checkpoint arguments');
  }
  return { sequence, hash };
}

async function main(): Promise<void> {
  const [filePath, ...options] = process.argv.slice(2);
  if (!filePath) throw new Error('Usage: verify:audit <export.json> [--checkpoint-seq N --checkpoint-hash H]');
  const checkpoint = parseCheckpoint(options);
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  if (!isAuditExport(parsed)) throw new Error('Invalid audit export');
  const result = verifyChain(parsed.events, parsed.scope, checkpoint);
  if (result.ok) {
    process.stdout.write('OK\n');
    return;
  }
  for (const error of result.errors) process.stdout.write(`${error.code} ${error.sequence ?? ''}\n`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Audit verification failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
