// Owner-approved exceptions, 2026-10-18. No reference closure may widen these.
const exact = new Set([
  'records/costs/price-book.json', 'records/costs/budget.json',
  'records/costs/credit-terms.json', 'records/costs/provider-caps.json',
  'records/releases/assist-release.json', 'records/releases/assist-endorsements.json',
]);
export function allowedRecord(p) {
  if (typeof p !== 'string' || p.includes('\\') || p.split('/').some(x => !x || x === '.' || x === '..')) return false;
  if (/(^|\/)(?:\.env(?:\..*)?|client_secret[^/]*\.json)$|\.(?:key|pem|db|sqlite|log)$/i.test(p)) return false;
  return exact.has(p) || /^records\/reviews\/AEG-MEDIA-[^/]+\.json$/.test(p)
    || p.startsWith('records/sources/');
}
