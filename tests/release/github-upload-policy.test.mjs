import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedRecord} from '../../tools/github-upload-policy.mjs';
test('owner exceptions include public provenance and exact configuration only', () => {
  for (const p of ['costs/price-book.json','costs/budget.json','costs/credit-terms.json','costs/provider-caps.json','releases/assist-release.json','releases/assist-endorsements.json','reviews/AEG-MEDIA-001.json','sources/agency/raw.json']) assert.equal(allowedRecord('records/'+p),true,p);
});
test('private records cannot enter through broad roots or reference traversal', () => {
  for (const p of ['costs/ledger.jsonl','costs/other.json','releases/private.json','reviews/AEG-AUTH-001.json','reviews/AEG-MEDIA-001.png','baselines/seal.json','screenshots/x.png','e2e/a.json','design-references/x.png','snapshots/a.json','sources/../costs/ledger.jsonl','sources/.env','sources/client_secret_x.json']) assert.equal(allowedRecord('records/'+p),false,p);
  assert.equal(allowedRecord('records\\sources\\x.json'),false);
});
