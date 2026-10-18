import { useEffect, useState } from 'react';
import { emergencyLines, type ChatContext } from '../../src/assist/chat.js';
import { AUDIENCE_LABELS, type AudienceT, type Card, type PublicCard } from '../../src/assist/contract.js';
import { AssistPage } from './assist/AssistPage.js';
import { speakCard } from './assist/audio/speech.js';
import { AssistChat } from './assist/organisms/AssistChat.js';
import { AssistWorkspace } from './assist/organisms/AssistWorkspace.js';
import { OfflineBadge } from './assist/pwa/OfflineBadge.js';
import { registerAssistServiceWorker, useOnlineStatus } from './assist/pwa/register.js';

const CARDS_URL = '/public/assist/cards';
const COUNTRIES: { code: Card['country']; label: string }[] = [
  { code: 'MY', label: 'Malaysia' },
  { code: 'SG', label: 'Singapore' },
  { code: 'ID', label: 'Indonesia' },
];
const STORAGE_KEY = 'aegis.assist.country';
const AUDIENCE_KEY = 'aegis.assist.audience';
const AUDIENCE_CHOICES = Object.keys(AUDIENCE_LABELS) as AudienceT[];

function readCountry(): Card['country'] {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return COUNTRIES.some((c) => c.code === saved) ? saved as Card['country'] : 'MY';
  } catch { return 'MY'; }   // storage can be blocked or empty; the page must work without it
}

function readAudience(): AudienceT {
  try {
    const saved = window.localStorage.getItem(AUDIENCE_KEY);
    return AUDIENCE_CHOICES.includes(saved as AudienceT) ? saved as AudienceT : 'general';
  } catch { return 'general'; }
}

interface Endorsement { organisation: string; endorsedBy: string; endorsedOn: string; note?: string }
interface AssistResponse {
  cards: PublicCard[]; disclaimer: string; demoBannerText: string; released: boolean; notReleasedBanner: string;
  /** Older cached responses (offline) do not carry these two, so both are optional. */
  approval?: { text: string } | null;
  remarks?: { id: string; country?: Card['country']; text: string }[];
  endorsements?: Endorsement[];
}

/**
 * The public /assist view. No login, no cookies, no tenant data. Content comes only from the validated public endpoint; a failed
 * load shows a plain message and never invented guidance. Entry wiring is owned by the engineer, the components by the workers.
 */
export function AssistRoute() {
  const [data, setData] = useState<AssistResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [held, setHeld] = useState(false);
  const online = useOnlineStatus();
  const [country, setCountry] = useState<Card['country']>(readCountry);
  const [audience, setAudience] = useState<AudienceT>(readAudience);

  function chooseAudience(next: AudienceT): void {
    setAudience(next);
    try { window.localStorage.setItem(AUDIENCE_KEY, next); } catch { /* a per-viewer convenience only */ }
  }

  function chooseCountry(next: Card['country']): void {
    setCountry(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* a per-viewer convenience only */ }
  }

  useEffect(() => {
    let cancelled = false;
    fetch(CARDS_URL, { headers: { accept: 'application/json' } })
      .then((response) => {
        if (response.status === 503) { if (!cancelled) setHeld(true); return Promise.reject(new Error('release held')); }
        return response.ok ? response.json() as Promise<AssistResponse> : Promise.reject(new Error(`status ${response.status}`));
      })
      .then((body) => { if (!cancelled) setData(body); })
      .catch(() => { if (!cancelled) setFailed(true); });
    void registerAssistServiceWorker([CARDS_URL]);
    return () => { cancelled = true; };
  }, []);

  if (held) {
    return <main className="assist-page" aria-label="Aegis Assist public guidance">
      <h1>Aegis Assist</h1>
      <p role="status">Aegis Assist is under review and is not available yet. If you are in danger, call your local emergency number now.</p>
    </main>;
  }
  if (failed) {
    return <main className="assist-page" aria-label="Aegis Assist public guidance">
      <h1>Aegis Assist</h1>
      <p role="status">Guidance could not be loaded. If you are in danger, call your local emergency number now.</p>
      {!online && <OfflineBadge />}
    </main>;
  }
  if (data === null) {
    return <main className="assist-page" aria-label="Aegis Assist public guidance"><h1>Aegis Assist</h1><p role="status">Loading guidance</p></main>;
  }
  const inCountry = data.cards.filter((item) => item.card.country === country);
  // "Everyone" shows only the general cards; a group shows its own cards first and always keeps the general ones, so nobody loses the basics.
  const groupHasCard = audience !== 'general' && inCountry.some((item) => item.card.audience === audience);
  const shown = audience === 'general'
    ? inCountry.filter((item) => item.card.audience === 'general')
    : [...inCountry.filter((item) => item.card.audience === audience), ...inCountry.filter((item) => item.card.audience === 'general')];
  const anyDraft = shown.some((item) => item.demoBanner);
  const allCards = data.cards.map((item) => item.card);
  const emergency = emergencyLines(allCards, country);
  const countryLabel = COUNTRIES.find((c) => c.code === country)?.label ?? 'this country';
  const chatContext: ChatContext = { country, audience };
  const cardsView = <>
    <fieldset className="assist-country">
      <legend>Country</legend>
      {COUNTRIES.map((c) => <label key={c.code} className="assist-country-option">
        <input type="radio" name="assist-country" value={c.code} checked={country === c.code} onChange={() => chooseCountry(c.code)} />
        <span>{c.label}</span>
      </label>)}
    </fieldset>
    <fieldset className="assist-country">
      <legend>Who is this for?</legend>
      {AUDIENCE_CHOICES.map((a) => <label key={a} className="assist-country-option">
        <input type="radio" name="assist-audience" value={a} checked={audience === a} onChange={() => chooseAudience(a)} />
        <span>{AUDIENCE_LABELS[a]}</span>
      </label>)}
    </fieldset>
    {audience !== 'general' && !groupHasCard && inCountry.length > 0 && <p role="status" className="assist-country-empty">
      No official guidance written for this group was found for {countryLabel} yet. The general guidance is shown.
    </p>}
    {shown.length === 0 && <p role="status" className="assist-country-empty">
      No checked guidance is available for this country yet. If you are in danger, call your local emergency number now.
    </p>}
    {(data.endorsements ?? []).length > 0 && <section className="assist-endorsements" aria-label="Endorsements">
      <h2>Endorsed by</h2>
      <ul>
        {(data.endorsements ?? []).map((e) => <li key={`${e.organisation}-${e.endorsedOn}`}>
          <strong>{e.organisation}</strong> ({e.endorsedBy}, {e.endorsedOn}){e.note ? `: ${e.note}` : ''}
        </li>)}
      </ul>
      <p>Each endorsement is a statement by the named organisation, not by Aegis, and applies only to exactly this content.</p>
    </section>}
    <AssistPage cards={shown} disclaimer={data.disclaimer} onSpeak={(card) => { speakCard(card); }} />
    {(data.remarks ?? []).some((r) => r.country === undefined || r.country === country) && <section className="assist-remarks" aria-label="Remarks about this preview">
      <h2>Remarks</h2>
      <ul>
        {(data.remarks ?? []).filter((r) => r.country === undefined || r.country === country).map((r) => <li key={r.id}>{r.text}</li>)}
      </ul>
    </section>}
  </>;
  return <>
    {!online && <OfflineBadge />}
    {!data.released && <p role="alert" className="assist-demo-banner">{data.notReleasedBanner}</p>}
    {data.released && data.approval && <p role="note" className="assist-approval">{data.approval.text}</p>}
    {anyDraft && <p role="alert" className="assist-demo-banner">{data.demoBannerText}</p>}
    <aside className="assist-emergency" aria-label="Emergency contact" data-testid="assist-emergency">
      <strong>Emergency, {countryLabel}:</strong>{' '}
      {emergency.length > 0
        ? emergency.map((l) => <span key={l.text} className="assist-emergency-line">{l.text} <small>({l.source.publisher})</small></span>)
        : <span>No checked emergency number is on this page for {countryLabel}. Call your local emergency number.</span>}
    </aside>
    <AssistWorkspace
      cards={cardsView}
      cardCount={shown.length}
      chat={<AssistChat cards={allCards} context={chatContext} onContext={(change) => { if (change.country) chooseCountry(change.country); if (change.audience) chooseAudience(change.audience); }} />}
    />
  </>;
}
