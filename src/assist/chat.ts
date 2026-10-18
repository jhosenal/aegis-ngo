// The Assist chat's answering logic. Design: "code decides, models speak" (AEG-DEC-005). Here code decides and no model speaks at all: a question is
// matched to a topic (emergency number, masks, seeking care, outdoor activity), a country and a group, and the reply is made ONLY of the
// verbatim lines of the validated cards, each with its source. The chat never writes health advice of its own, never assesses symptoms and
// runs in the browser from the cards already loaded, so it works offline. A later language layer may rephrase a reply; it may not change it.
import type { AudienceT, Card } from './contract.js';

export type Country = Card['country'];
export interface ChatContext { country: Country; audience: AudienceT }
export interface LineSource { publisher: string; url: string; accessed: string; published?: string }
export type ChatBlock =
  | { kind: 'text'; text: string }
  | { kind: 'line'; text: string; condition?: string; cardId: string; cardTitle: string; source: LineSource }
  | { kind: 'notice'; text: string };
export interface ChatReply { blocks: ChatBlock[]; set?: Partial<ChatContext>; topic: Topic }
export type Topic = 'emergency' | 'danger' | 'mask' | 'care' | 'activity' | 'group' | 'help' | 'unknown';

export const COUNTRY_NAMES: Record<Country, string> = { MY: 'Malaysia', SG: 'Singapore', ID: 'Indonesia' };
export const MAX_LINES = 8;
/** An air quality table has one line per band per group, so an activity answer may show a whole table (3 groups x 5 bands) and is never cut in the middle of it. */
export const MAX_ACTIVITY_LINES = 16;

const COUNTRY_WORDS: [Country, RegExp][] = [
  ['MY', /\b(malaysia|malaysian|kuala lumpur|kl|johor|selangor|penang|sabah|sarawak|perak|melaka|malacca)\b/],
  ['SG', /\b(singapore|singaporean|sg)\b/],
  ['ID', /\b(indonesia|indonesian|jakarta|sumatra|sumatera|riau|kalimantan|jambi|palembang|java)\b/],
];
const LUNG_HEART = /\b(asthma|asthmatic|lung|lungs|copd|bronchitis|heart|cardiac|cardiovascular|emphysema|breathing problem|chronic)\b/;
const VULNERABLE = /\b(child|children|kid|kids|baby|babies|infant|toddler|elderly|older|senior|seniors|grandparent|grandparents|grandmother|grandfather|aged|pregnant|pregnancy)\b/;
const DANGER = /\b(cannot breathe|can't breathe|cant breathe|not breathing|chest pain|unconscious|collapsed|choking|dying|faint|fainted|severe)\b/;
const EMERGENCY = /\b(emergency|ambulance|call|number|hotline|999|995|112|police|urgent|help|rescue|fire)\b/;
const MASK = /\b(mask|masks|n95|kn95|p100|respirator|respirators|ffp2)\b/;
const CARE = /\b(doctor|medical|medicine|medication|medications|symptom|symptoms|unwell|sick|ill|cough|hospital|clinic|treatment|seek)\b/;
const ACTIVITY = /\b(outdoor|outdoors|outside|exercise|run|running|jog|jogging|school|play|playing|activity|activities|psi|api|ispu|air quality|index|band|unhealthy|hazardous|go out|stay indoors?|indoors?|windows?|sport|sports|walk)\b/;

const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function detectCountry(q: string): Country | undefined {
  for (const [country, pattern] of COUNTRY_WORDS) if (pattern.test(q)) return country;
  return undefined;
}
function detectAudience(q: string): AudienceT | undefined {
  if (LUNG_HEART.test(q)) return 'lung-heart';
  if (VULNERABLE.test(q)) return 'children-older-pregnant';
  return undefined;
}

function sourceOf(card: Card, sourceId: string): LineSource | undefined {
  const s = card.sources.find((x) => x.sourceId === sourceId);
  return s ? { publisher: s.publisher, url: s.url, accessed: s.accessed, ...(s.published ? { published: s.published } : {}) } : undefined;
}

interface Candidate { card: Card; lineIndex: number }

function candidates(cards: Card[], country: Country, audience: AudienceT, widen = false): Candidate[] {
  const inCountry = cards.filter((c) => c.country === country && c.hazard === 'haze');
  // the chosen group's cards first, then the general ones, so nobody loses the basics (the same rule as the cards view).
  // `widen` (masks, medical advice) also searches every group's cards when no group was named: those lines are shared across the groups,
  // and each reply line shows which card it came from.
  const ordered = audience === 'general'
    ? (widen ? [...inCountry.filter((c) => c.audience === 'general'), ...inCountry.filter((c) => c.audience !== 'general')] : inCountry.filter((c) => c.audience === 'general'))
    : [...inCountry.filter((c) => c.audience === audience), ...inCountry.filter((c) => c.audience === 'general')];
  const out: Candidate[] = [];
  for (const card of ordered) card.lines.forEach((_l, lineIndex) => out.push({ card, lineIndex }));
  return out;
}

function toBlocks(list: Candidate[], limit = MAX_LINES): ChatBlock[] {
  const seen = new Set<string>();
  const blocks: ChatBlock[] = [];
  for (const { card, lineIndex } of list) {
    const line = card.lines[lineIndex];
    if (!line) continue;
    const source = sourceOf(card, line.sourceId);
    if (!source) continue;
    const key = `${line.text}|${line.condition ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push({ kind: 'line', text: line.text, ...(line.condition ? { condition: line.condition } : {}), cardId: card.id, cardTitle: card.title, source });
    if (blocks.length >= limit) break;
  }
  return blocks;
}

// The first line of every card is its emergency contact line (enforced by the card contract), so the contact is always a sourced line.
const contactBlocks = (cards: Card[], country: Country): ChatBlock[] =>
  toBlocks(cards.filter((c) => c.country === country && c.hazard === 'haze').map((card) => ({ card, lineIndex: 0 })));

const LIMIT_NOTICE = 'I answer only with the official guidance on this page, word for word. I cannot assess symptoms or give medical advice.';

export function answer(question: string, cards: Card[], ctx: ChatContext): ChatReply {
  const q = normalise(question);
  const country = detectCountry(q) ?? ctx.country;
  const audience = detectAudience(q) ?? ctx.audience;
  const set: Partial<ChatContext> = {
    ...(country !== ctx.country ? { country } : {}),
    ...(audience !== ctx.audience ? { audience } : {}),
  };
  const countryName = COUNTRY_NAMES[country];
  const pool = candidates(cards, country, audience);
  const widePool = candidates(cards, country, audience, true);
  const withSet = (reply: Omit<ChatReply, 'set'>): ChatReply => (Object.keys(set).length > 0 ? { ...reply, set } : reply);
  const withText = (lead: string, blocks: ChatBlock[], topic: Topic, closing?: string): ChatReply => withSet({ topic, blocks: [{ kind: 'text', text: lead }, ...blocks, ...(closing ? [{ kind: 'text', text: closing } as ChatBlock] : [])] });

  if (q === '') return { topic: 'help', blocks: [{ kind: 'text', text: 'Ask about the emergency number, masks, when to see a doctor, outdoor activity, or your group (lung or heart conditions, children, older adults, pregnant women).' }] };

  // 1. danger words: the sourced contact line first, nothing that sounds like an assessment
  if (DANGER.test(q)) {
    const contact = contactBlocks(cards, country);
    return withSet({ topic: 'danger', blocks: [
      { kind: 'text', text: `Emergency contact for ${countryName}:` },
      ...(contact.length > 0 ? contact : [{ kind: 'notice', text: `No checked emergency number is available for ${countryName} on this page. Call your local emergency number.` } as ChatBlock]),
      { kind: 'notice', text: LIMIT_NOTICE },
    ] });
  }

  const wantsMask = MASK.test(q);
  const wantsCare = CARE.test(q);
  const wantsActivity = ACTIVITY.test(q);
  const wantsEmergency = EMERGENCY.test(q) && !wantsMask && !wantsCare;

  if (wantsEmergency && !wantsActivity) {
    const contact = contactBlocks(cards, country);
    if (contact.length === 0) return withText(`There is no checked emergency number for ${countryName} on this page.`, [{ kind: 'notice', text: 'Call your local emergency number.' }], 'emergency');
    return withText(`Emergency contact for ${countryName}:`, contact, 'emergency');
  }
  if (wantsMask) {
    const lines = widePool.filter(({ card, lineIndex }) => /\bmask|n95|p100|respirator/i.test(`${card.lines[lineIndex]?.text ?? ''}`) || /\bmask/i.test(card.lines[lineIndex]?.condition ?? ''));
    // a caveat line (for example "consult their doctor before using an N95") must travel with the mask line it qualifies
    const blocks = toBlocks(lines);
    return blocks.length > 0
      ? withText(`What the official guidance for ${countryName} says about masks:`, blocks, 'mask', 'Read the whole card for the conditions that go with each line.')
      : withText(`I did not find official guidance about masks for ${countryName} on this page.`, [], 'mask');
  }
  if (wantsCare) {
    const lines = widePool.filter(({ card, lineIndex }) => /\b(doctor|medical|medication|medications|medicine|seek)\b/i.test(card.lines[lineIndex]?.text ?? ''));
    const blocks = toBlocks(lines);
    return blocks.length > 0
      ? withText(`What the official guidance for ${countryName} says about medical advice:`, blocks, 'care')
      : withText(`I did not find official guidance about seeing a doctor for ${countryName} on this page.`, [{ kind: 'notice', text: LIMIT_NOTICE }], 'care');
  }
  if (wantsActivity) {
    const lines = pool.filter(({ card, lineIndex }) => { const l = card.lines[lineIndex]; return l !== undefined && (l.kind === 'do' || l.kind === 'dont') && /outdoor|indoor|activit|psi|exertion|window/i.test(`${l.text} ${l.condition ?? ''}`); });
    const blocks = toBlocks(lines, MAX_ACTIVITY_LINES);
    // The activity advice differs by group, so with no group named and only group cards available, ask instead of showing one group's advice to everyone.
    if (blocks.length === 0 && audience === 'general' && cards.some((c) => c.country === country && c.hazard === 'haze' && c.audience !== 'general')) {
      return withText(`The official advice about outdoor activity in ${countryName} depends on the group.`, [{ kind: 'notice', text: 'Tell me your group, for example "outdoors with asthma", or "outdoors with children". Or choose a group on the page.' }], 'activity');
    }
    return blocks.length > 0
      ? withText(`What the official guidance for ${countryName} says about outdoor activity${audience === 'general' ? '' : ' for your group'}:`, blocks, 'activity', 'The page shows every air quality band on the card.')
      : withText(`I did not find official guidance about outdoor activity for ${countryName} on this page.`, [], 'activity');
  }
  // 2. a group or a country alone: show that card's lines
  if (detectAudience(q) !== undefined || detectCountry(q) !== undefined) {
    const blocks = toBlocks(pool);
    const groupFound = audience !== 'general' && cards.some((c) => c.country === country && c.hazard === 'haze' && c.audience === audience);
    const lead = audience !== 'general' && !groupFound
      ? `No official guidance written for this group was found for ${countryName} yet. The general guidance:`
      : `Official guidance for ${countryName}${audience === 'general' ? '' : ' for this group'}:`;
    return blocks.length > 0 ? withText(lead, blocks, 'group', 'Ask about masks, outdoor activity, or when to see a doctor for more.') : withText(`No checked guidance is available for ${countryName} yet.`, [{ kind: 'notice', text: 'If you are in danger, call your local emergency number.' }], 'group');
  }
  // 3. nothing matched: say so, and offer the contact line, never a guess
  const contact = contactBlocks(cards, country);
  return withSet({ topic: 'unknown', blocks: [
    { kind: 'notice', text: `I could not match that to the official guidance on this page. ${LIMIT_NOTICE}` },
    { kind: 'text', text: 'Try: emergency number, masks, when to see a doctor, outdoor activity, asthma, children, older adults or pregnant women.' },
    ...contact,
  ] });
}

/** The quick questions shown as buttons, so nobody has to type in an emergency. */
export const QUICK_QUESTIONS: { label: string; question: string }[] = [
  { label: 'Emergency number', question: 'What is the emergency number?' },
  { label: 'Which mask?', question: 'Which mask should I wear?' },
  { label: 'Outdoor activity', question: 'Can I go outdoors?' },
  { label: 'See a doctor?', question: 'When should I see a doctor?' },
  { label: 'I have asthma', question: 'I have asthma or a heart condition' },
  { label: 'Children, older, pregnant', question: 'What about children, older adults and pregnant women?' },
];

/** The sourced emergency contact line(s) of a country, for the always-visible bar. Empty when the page has no checked number for it. */
export function emergencyLines(cards: Card[], country: Country): Extract<ChatBlock, { kind: 'line' }>[] {
  return contactBlocks(cards, country).filter((b): b is Extract<ChatBlock, { kind: 'line' }> => b.kind === 'line');
}

/** The opening message: what the chat is and is not, and the emergency contact first. */
export function greeting(cards: Card[], country: Country): ChatBlock[] {
  return [
    { kind: 'text', text: 'Ask me about the haze guidance on this page.' },
    { kind: 'notice', text: `${LIMIT_NOTICE} No AI model is used.` },
    ...contactBlocks(cards, country),
  ];
}
