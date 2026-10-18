import {useChatWorkspace} from '../chat/ChatWorkspace.js';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CardRevision, ChatBlock, ChatReply, ProviderNoticeCode } from '../../../src/types/domain.js';
import { apiRequest, ApiError } from '../api/client.js';
import type { AttachmentRef } from './AttachmentChips.js';
import { AttachmentChips } from './AttachmentChips.js';
import { NoticeBar } from './NoticeBar.js';
import { noticeText } from '../format.js';
import { HazardIcon } from './HazardIcon.js';
import { PlacesGroup } from './PlaceCards.js';
import { Icon } from '../dashboard/Icon.js';
import './ChatMini.css';

interface ModeOption { id: string; label: string; available: boolean; note: string }
// Shown until the server answers: Pro and Expert stay off unless the server says the user may use them.
const FALLBACK_MODES: ModeOption[] = [
  { id: 'auto', label: 'Auto', available: true, note: 'Standard model.' },
  { id: 'normal', label: 'Normal', available: true, note: 'Standard model.' },
  { id: 'pro', label: 'Pro', available: false, note: 'Planned for registered users. Not available yet.' },
  { id: 'expert', label: 'Expert', available: false, note: 'Planned for registered users. Not available yet.' },
];

export interface ChatMessage { id: string; blocks: ChatBlock[]; notice: ProviderNoticeCode | null; role?: 'user' | 'assistant';attachments?:{cardId:string;revision:number}[] }

interface ChatPanelProps {
  token: string | null;
  cards: CardRevision[];
  attachments: AttachmentRef[];
  messages: ChatMessage[];
  onRemoveAttachment: (cardId: string) => void;
  onAddMessage: (message: ChatMessage) => void;
  onClearAttachments: () => void;
  onOpenCard: (cardId: string, revision: number) => void;
  suggestions?: string[];
  helper?: boolean;
  onAttachCard?:(cardId:string,revision:number)=>void;
}

/** The centre of the map the person is looking at (kept by the map), so "the nearest hospital" can mean here. */
function mapView(): { view?: { lat: number; lng: number } } {
  const v = (window as Window & { __aegisView?: { lat: number; lng: number } }).__aegisView;
  return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) ? { view: { lat: Math.round(v.lat * 1e5) / 1e5, lng: Math.round(v.lng * 1e5) / 1e5 } } : {};
}

const fieldValue = (card: CardRevision | undefined, key: string): string | null => { const v = card?.body.fields.find((f) => f.key === key)?.value; return typeof v === 'string' ? v : null; };
const whenText = (iso: string | null): string => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' MYT' : '');

/** A small card inside a reply: icon, title, one line of facts, a badge. Pressing it opens the full card or the map, like the cards on the dashboard. */
function MiniCard({ icon, title, line, badge, onOpen, label }: { icon: ReactNode; title: string; line: string; badge?: string | null; onOpen: () => void; label: string }): ReactNode {
  return <button type="button" className="chat-mini" data-testid="chat-mini-card" aria-label={label} onClick={onOpen}>
    <span className="chat-mini-icon" aria-hidden="true">{icon}</span>
    <span><strong>{title}</strong><small>{line}</small></span>
    {badge ? <span className={`chat-mini-badge is-${badge}`}>{badge}</span> : <span/>}
  </button>;
}

function renderBlock(block: ChatBlock, onOpenCard: (cardId: string, revision: number) => void, cards: CardRevision[], all: ChatBlock[], token: string | null): ReactNode {
  switch (block.type) {
    case 'text': return <p key={`text-${block.text}`}>{block.text}</p>;
    case 'cardRef': {
      if (all.some((b) => b.type === 'mapFocus' && b.cardId === block.cardId)) return null;   // the map preview below already is this card
      const card = cards.find((c) => c.cardId === block.cardId);
      if (!card) return <button key={`card-${block.cardId}-${block.revision}`} onClick={() => onOpenCard(block.cardId, block.revision)}>{block.cardId} r{block.revision}</button>;
      const hazard = fieldValue(card, 'hazardType') ?? 'unknown';
      return <MiniCard key={`card-${block.cardId}-${block.revision}`} icon={<HazardIcon hazard={hazard} size={22}/>} title={card.title} badge={fieldValue(card, 'alertLevel')}
        line={[hazard.charAt(0) + hazard.slice(1).toLowerCase(), fieldValue(card, 'country'), whenText(fieldValue(card, 'eventTime'))].filter(Boolean).join(' · ')} label={`Open card: ${card.title}`} onOpen={() => onOpenCard(block.cardId, block.revision)}/>;
    }
    case 'table': return <div className="chat-table-wrap" key={`table-${block.columns.join('-')}`}><table><thead><tr>{block.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
    case 'places': return <PlacesGroup key={`places-${block.category}-${block.centre.lat}`} block={block} token={token}/>;
    case 'mapFocus': return <MiniCard key={`focus-${block.cardId}`} icon={<HazardIcon hazard={block.hazard} size={22}/>} title={block.title} badge={block.alertLevel ?? null}
      line={[block.hazard.charAt(0) + block.hazard.slice(1).toLowerCase(), block.country, whenText(block.eventTime ?? null)].filter(Boolean).join(' · ')} label={`Open card and show on the map: ${block.title}`}
      onOpen={() => { window.dispatchEvent(new CustomEvent('aegis-map-focus', { detail: block })); onOpenCard(block.cardId, block.revision); }}/>;
    case 'notice': return <NoticeBar key={`notice-${block.code}`} text={block.text} level={block.level} code={block.code} />;
  }
}

export function ChatPanel({ token, cards, attachments, messages, onRemoveAttachment, onAddMessage, onClearAttachments, onOpenCard, suggestions = [], helper = false, onAttachCard }: ChatPanelProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modes, setModes] = useState<ModeOption[]>(FALLBACK_MODES);
  const [mode, setMode] = useState('auto');
  const messagesRef = useRef<HTMLDivElement>(null);
  const chat=useChatWorkspace();
  const conversationId=chat.currentId;
  const [contextMenu,setContextMenu]=useState(false);
  useEffect(()=>{
    const publish=()=>window.dispatchEvent(new CustomEvent('aegis-chat-mode-state',{detail:{mode,modes}}));
    const query=()=>publish();
    const select=(event:Event)=>{const next=(event as CustomEvent<string>).detail;if(modes.some(option=>option.id===next&&option.available))setMode(next);};
    window.addEventListener('aegis-chat-mode-query',query);window.addEventListener('aegis-chat-mode-select',select);publish();
    return()=>{window.removeEventListener('aegis-chat-mode-query',query);window.removeEventListener('aegis-chat-mode-select',select);};
  },[mode,modes]);
  useEffect(()=>{if(!contextMenu)return;const outside=(e:PointerEvent)=>{if(!(e.target as HTMLElement).closest('.chat-composer'))setContextMenu(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[contextMenu]);
  // The request in flight. Cancel (button or Escape) aborts it; the server sees the closed connection and cancels the model request too.
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);   // leaving the page also cancels
  const cancel = (): void => { inFlight.current?.abort(); };
  const previousConversation=useRef(conversationId);
  useEffect(()=>{if(previousConversation.current&&previousConversation.current!==conversationId)inFlight.current?.abort();if(!(busy&&!previousConversation.current))setText('');previousConversation.current=conversationId;setError(null);setContextMenu(false);},[conversationId]);

  useEffect(() => {
    const region = messagesRef.current;
    if (region) region.scrollTop = region.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (!token) { setModes(FALLBACK_MODES); setMode('auto'); return; }
    void apiRequest<{ default: string; modes: ModeOption[] }>('/api/modes', { token })
      .then((result) => { setModes(result.modes); setMode(result.default); })
      .catch(() => setModes(FALLBACK_MODES));
  }, [token]);

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;   // the box is locked while a request is in flight: one request at a time
    if (!token || text.trim() === '') { setError('Sign in and enter a message.'); return; }
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    setError(null);
    let threadId=conversationId;
    const deliver=(message:ChatMessage)=>{if(helper&&threadId)chat.appendTo(threadId,message);else if(!helper)onAddMessage(message);};
    try {
      if(helper&&!threadId){threadId=await chat.ensureConversation();if(!threadId)throw new Error('Conversation could not be created. Try New chat again.');}
      deliver({id:`user-${crypto.randomUUID()}`,role:'user',blocks:[{type:'text',text:text.trim()}],notice:null});
      // Named-place commands first check AEGIS's stored monitoring pins and
      // OpenStreetMap places. Unknown names continue through normal Assist.
      const namedPlace = helper && window.location.pathname === '/assist'
        ? /^(?:show(?: me)?|go to|take me to)\s+([\p{L}\p{N}\s.'-]{2,80})[.!?]?$/iu.exec(text.trim())?.[1]?.trim()
        : undefined;
      if (namedPlace) {
        const located = await apiRequest<{ found: boolean; name: string; lat?: number; lng?: number; source: string | null; approximate: boolean }>(`/api/map/locate?name=${encodeURIComponent(namedPlace)}`, { token, signal: controller.signal }).catch(() => null);
        if (located?.found && Number.isFinite(located.lat) && Number.isFinite(located.lng)) {
          window.dispatchEvent(new CustomEvent('aegis-stored-place-focus', { detail: { name: located.name, lat: located.lat, lng: located.lng } }));
          const source = located.source === 'monitoring-pins' ? 'monitoring pins' : 'stored OpenStreetMap places';
          deliver({ id: `place-${crypto.randomUUID()}`, role: 'assistant', blocks: [{ type: 'text', text: `Sure — zooming right in on ${located.name} for you. I used our ${source}; this ${located.approximate ? 'approximate area marker' : 'stored pin location'} is for viewing and has not been saved as a Drop Pin.` }], notice: null });
          setText('');
          onClearAttachments();
          void chat.refresh();
          return;
        }
      }
      const reply = await apiRequest<ChatReply>(helper ? '/api/helper' : '/api/chat', {
        method: 'POST', token, signal: controller.signal, body: { text, mode, ...(helper ? { conversationId:threadId, ...mapView() } : {}), attachments: attachments.map(({ cardId, revision }) => ({ cardId, revision })) },
      });
      const stepped: ChatBlock[] = reply.escalatedTo
        ? [{ type: 'notice', level: 'info', code: 'ESCALATED', text: `Answered in ${reply.escalatedTo} mode because the Normal answer did not pass the checks.` }]
        : [];
      deliver({ id: reply.messageId, blocks: [...reply.blocks, ...stepped], notice: reply.providerNotice, attachments:reply.attachedRevisions });
      // "Show me the worst flood": the map zooms to the incident and its panel opens next to it (IncidentFocus on the landing page).
      for (const block of reply.blocks) {
        if (block.type === 'mapFocus') window.dispatchEvent(new CustomEvent('aegis-map-focus', { detail: block }));
        if (block.type === 'places') window.dispatchEvent(new CustomEvent('aegis-places', { detail: block }));   // "nearest hospital": pins, a list and a zoom
      }
      setText('');
      onClearAttachments();
      if(helper)void chat.refresh();
    } catch (reason: unknown) {
      if (controller.signal.aborted) {
        // The person pressed Cancel: say so in the conversation, keep what they typed so they can edit and send again, and unlock the box.
        deliver({ id: `cancelled-${crypto.randomUUID()}`, role: 'assistant', blocks: [{ type: 'notice', level: 'info', code: 'CANCELLED', text: noticeText('CANCELLED') }], notice: null });
      } else {
        setError(reason instanceof ApiError ? `${reason.code}: ${reason.message}` : 'Chat request failed');
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      setBusy(false);
      window.setTimeout(() => document.getElementById('chat-input')?.focus(), 0);   // the box is writable again: put the cursor back in it
    }
  }

  return <section className={`chat-panel ${helper ? 'helper-chat' : ''}`} data-testid="chat-panel" data-card-kind="section" data-card-id="section:conversation">
    {!helper && <div className="panel-heading"><h2>Chat</h2><span className="chat-context-count">{attachments.length > 0 ? `${attachments.length} attached` : ''}</span></div>}
    <div className="chat-messages" ref={messagesRef} aria-live="polite" tabIndex={0} aria-label="Conversation history">
      {messages.length === 0 ? !helper && <p data-testid="empty-chat">Use a command such as “help” to get started.</p> : messages.map((message, index) => <article key={message.id} data-role={message.role ?? 'assistant'} data-testid={message.role === 'user' ? `user-message-${index + 1}` : `chat-message-${messages.slice(0, index + 1).filter((item) => item.role !== 'user').length}`}>
        <strong className="chat-message-label">{message.role === 'user' ? 'You' : 'AEGIS Assist'}</strong>
        <div>{message.blocks.map((block) => renderBlock(block, onOpenCard, cards, message.blocks, token))}</div>
        {message.notice && <NoticeBar code={message.notice} text={noticeText(message.notice)} level="warning" />}
      </article>)}
      {messages.length === 0 && helper && suggestions.length > 0 && <div className="chat-prompts" aria-label="Suggested actions">{suggestions.map((prompt,index) => <button key={prompt} onClick={() => { setText(prompt); if(token) window.setTimeout(()=>(document.getElementById('chat-input') as HTMLTextAreaElement | null)?.form?.requestSubmit(),0); else document.getElementById('chat-input')?.focus(); }}><Icon name={index===0?'spark':index===1?'people':'report'} size={16}/><span>{prompt}</span></button>)}</div>}
    </div>
    {error && <p role="alert" data-testid="error-chat">{error}</p>}
    <AttachmentChips attachments={attachments} cards={cards} onRemove={onRemoveAttachment} />
    <form onKeyDown={event=>{if(event.key==='Escape'&&contextMenu){event.stopPropagation();setContextMenu(false);event.currentTarget.querySelector<HTMLButtonElement>('.chat-composer-plus')?.focus();}}} className={`chat-composer${busy?' is-processing':''}`} aria-busy={busy} data-ui-formulation="AEG.UI.CHAT-COMPOSER/1.0.0" onSubmit={(event) => void send(event)}>
      <button className="chat-composer-plus" type="button" aria-label="Add context" aria-expanded={contextMenu} disabled={busy||!token} onClick={()=>setContextMenu(!contextMenu)}><Icon name="plus" size={17}/></button>
      {contextMenu&&<section className="chat-composer-menu" aria-label="Add context"><strong>Attach AEGIS card</strong>{onAttachCard?cards.filter(card=>!card.body.synthetic).map(card=><button key={card.cardId} type="button" onClick={()=>{onAttachCard(card.cardId,card.revision);setContextMenu(false);}}>{card.title} - revision {card.revision}</button>):<p>Open a card and use its Attach action.</p>}{cards.filter(card=>!card.body.synthetic).length===0&&<p>No eligible cards loaded.</p>}<p>No file uploads or web search.</p><button type="button" onClick={()=>setContextMenu(false)}>Close context menu</button></section>}
      <label htmlFor="chat-input">Message</label>
      <textarea id="chat-input" data-testid="chat-input" className={busy ? 'is-locked' : undefined} placeholder={helper ? 'Ask AEGIS about hazards, telemetry, or places...' : undefined} rows={3} value={text} readOnly={busy} aria-busy={busy} onChange={(event) => { if (!busy) setText(event.currentTarget.value); }} onKeyDown={(event) => {
        if (busy && event.key === 'Escape') { event.preventDefault(); cancel(); return; }
        if (helper && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && token && text.trim()) event.currentTarget.form?.requestSubmit(); } }}/>
      <button type="submit" hidden={busy} data-testid="chat-send" disabled={busy || !token || text.trim() === ''}>{busy ? 'Sending…' : 'Send'}</button>
      {busy && <button type="button" className="chat-cancel" data-testid="chat-cancel" aria-label="Cancel the request" title="Cancel the request (Esc)" onClick={cancel}>Cancel</button>}
      {!helper && <fieldset className="mode-picker" data-testid="mode-picker">
        <legend>Model mode</legend>
        {modes.map((option) => <label key={option.id} className={option.available ? 'mode-option' : 'mode-option mode-off'}>
          <input type="radio" name="chat-mode" value={option.id} data-testid={`mode-${option.id}`} checked={mode === option.id}
            disabled={!option.available || busy} onChange={() => setMode(option.id)} />
          {option.label}
        </label>)}
        <p className="mode-note" data-testid="mode-note">{modes.find((option) => option.id === mode)?.note}</p>
        {modes.filter((option) => !option.available).map((option) => <p className="mode-note" key={option.id} data-testid={`mode-note-${option.id}`}>{option.label}: {option.note}</p>)}
      </fieldset>}
    </form>
  </section>;
}
