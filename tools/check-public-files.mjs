#!/usr/bin/env node
// Check exact tracked paths before publication. Never prints file contents.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {allowedRecord} from './github-upload-policy.mjs';

export function publicPathProblem(p) {
  if (!p || p.includes('\\') || p.split('/').some(part => !part || part === '.' || part === '..')) return 'invalid path';
  if (/^(data|runtime|node_modules|coverage|test-results|playwright-report)\//.test(p)) return 'private or generated root';
  if (/^(ui\/dist|render\/out)\//.test(p)) return 'generated output';
  if (p.startsWith('records/') && !allowedRecord(p)) return 'record outside the publication allowlist';
  if (/(^|\/)\.env(?:\.[^/]*)?$/.test(p) && p !== '.env.example') return 'environment file';
  if (/(^|\/)(?:client_secret[^/]*|[^/]*service[-_]account[^/]*)\.json$/i.test(p)) return 'credential file';
  if (/\.(?:pem|key|db|sqlite)(?:-wal|-shm)?$|\.log$/i.test(p)) return 'key, database or runtime log';
  return null;
}

export function checkPublicFiles(root) {
  const result=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
  if(result.status!==0)throw Error('Unable to enumerate tracked files');
  const files=result.stdout.split('\0').filter(Boolean);
  return {files:files.length,findings:files.flatMap(p=>{const reason=publicPathProblem(p);return reason?[{path:p,reason}]:[];})};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=checkPublicFiles(fileURLToPath(new URL('..',import.meta.url)));
  for(const finding of report.findings)console.error(`${finding.path}: ${finding.reason}`);
  console.log(`public-files: ${report.files} tracked files, ${report.findings.length} prohibited paths`);
  process.exitCode=report.findings.length?1:0;
}
