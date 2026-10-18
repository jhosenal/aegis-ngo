import test from 'node:test';
import assert from 'node:assert/strict';
import {publicPathProblem} from '../../tools/check-public-files.mjs';

test('publication blocks private data and credential paths without blocking src/data',()=>{
  for(const p of ['data/candidate.json','runtime/users.json','records/costs/ledger.jsonl','records/screenshots/demo.png','records/baselines/seal.json','.env','.env.local','deploy/service-account.json','backup.sqlite-wal','client_secret.json']) assert.ok(publicPathProblem(p),p);
  for(const p of ['src/data/db.ts','.env.example','records/costs/budget.json','records/sources/usgs/page.json','records/reviews/AEG-MEDIA-001.json','records/releases/assist-release.json','research/engineer/README.md']) assert.equal(publicPathProblem(p),null,p);
});
