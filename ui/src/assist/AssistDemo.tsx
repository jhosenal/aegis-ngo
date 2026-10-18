import syntheticFlood from '../../../tests/fixtures/assist/synthetic-flood.json';
import { DISCLAIMER_TEXT, selectPublicCards } from '../../../src/assist/contract.js';
import { AssistPage } from './AssistPage.js';

const cards = selectPublicCards(syntheticFlood, { draftMedical: false });

export function AssistDemo() {
  return <AssistPage cards={cards} disclaimer={DISCLAIMER_TEXT} />;
}
