import type { Card } from '../../../../src/assist/contract.js';
import { Icon } from '../atoms/Icon.js';
import { SourceList } from './SourceList.js';

function emergencyNumbers(text: string): string[] {
  return [...new Set((text.match(/(?<!\w)\+?\d[\d ().-]*\d|(?<!\w)\d{3,}/g) ?? [])
    .filter((value) => value.replace(/\D/g, '').length >= 3)
    .map((value) => value.trim()))];
}

export function ContactButton({ line, sources }: {
  line: Card['lines'][number];
  sources: Card['sources'];
}) {
  const numbers = emergencyNumbers(line.text);
  return <div className="assist-contact-line" role="group" aria-label="Emergency contact line">
    <p className="assist-contact-label"><Icon name="phone" /> Call first</p>
    <p className="assist-contact-text">{line.text}</p>
    {numbers.length > 0 && <div className="assist-phone-links" aria-label="Emergency phone numbers">
      {numbers.map((number) => <a key={number} href={`tel:${number.replace(/[^\d+]/g, '')}`} aria-label={`Call ${number}`}>
        Call {number}
      </a>)}
    </div>}
    <SourceList sources={sources} />
  </div>;
}
