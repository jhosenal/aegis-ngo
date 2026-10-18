// Prints the hash of the Assist content exactly as the server would serve it. A reviewer records this hash in
// records/releases/assist-release.json when approving; any later change to any card changes the hash and cancels the approval.
// Usage: npm run assist:hash
import { loadAssistContent } from '../src/assist/content.js';
const content = loadAssistContent({ draftMedical: false, allowFixture: false });
console.log(JSON.stringify({ contentHash: content.hash, cards: content.cards.length, ids: content.cards.map((c) => c.card.id) }, null, 2));
