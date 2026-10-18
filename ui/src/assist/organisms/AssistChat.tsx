import { useEffect, useRef, useState, type FormEvent } from 'react';
import { answer, COUNTRY_NAMES, greeting, QUICK_QUESTIONS, type ChatBlock, type ChatContext } from '../../../../src/assist/chat.js';
import type { Card } from '../../../../src/assist/contract.js';

// The Assist chat (AEG-DEC-005: chat on the right at about 2:1 on desktop, the main view on a phone). No AI model and no network:
// every reply is made of verbatim card lines with their sources, produced in the browser by src/assist/chat.ts, so it works offline.

// Each message belongs to the country it was written for. Only the current country's messages are shown, so a switch of country can never leave
// another country's emergency number on screen.
interface Message { id: number; role: 'user' | 'assistant'; country: ChatContext['country']; blocks: ChatBlock[] }

function Block({ block }: { block: ChatBlock }) {
  if (block.kind === 'text') return <p>{block.text}</p>;
  if (block.kind === 'notice') return <p role="status" className="assist-chat-notice">{block.text}</p>;
  const { source } = block;
  return <blockquote className="assist-chat-line">
    <p>{block.text}</p>
    {block.condition && <small className="assist-chat-condition">{block.condition}</small>}
    <small className="assist-chat-source">
      <a href={source.url} target="_blank" rel="noreferrer">Source: {source.publisher}</a>
      <span>{source.published ? `Published ${source.published}. ` : ''}Accessed {source.accessed}. Card: {block.cardTitle}</span>
    </small>
  </blockquote>;
}

export function AssistChat({ cards, context, onContext }: {
  cards: Card[];
  context: ChatContext;
  onContext: (change: Partial<ChatContext>) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);

  const visible: Message[] = [
    { id: -1, role: 'assistant', country: context.country, blocks: greeting(cards, context.country) },
    ...messages.filter((m) => m.country === context.country),
  ];
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, context.country]);

  function ask(question: string): void {
    const trimmed = question.trim();
    if (trimmed === '') return;
    const reply = answer(trimmed, cards, context);
    const target = reply.set?.country ?? context.country;
    const switched: ChatBlock[] = [];
    if (reply.set?.country) switched.push({ kind: 'notice', text: `Showing guidance for ${COUNTRY_NAMES[reply.set.country]}.` });
    if (reply.set) onContext(reply.set);
    setMessages((previous) => [
      ...previous,
      { id: nextId.current++, role: 'user', country: target, blocks: [{ kind: 'text', text: trimmed }] },
      { id: nextId.current++, role: 'assistant', country: target, blocks: [...switched, ...reply.blocks] },
    ]);
    setText('');
  }

  function submit(event: FormEvent): void { event.preventDefault(); ask(text); }

  return <section className="assist-chat" aria-label="Ask about the guidance" data-testid="assist-chat">
    <h2>Ask</h2>
    <p className="assist-chat-context" data-testid="chat-context">Answering for {COUNTRY_NAMES[context.country]}</p>
    <div className="assist-chat-log" role="log" aria-live="polite" aria-label="Conversation" ref={logRef} data-testid="chat-log">
      {visible.map((m) => <article key={m.id} className={`assist-chat-message assist-chat-${m.role}`} aria-label={m.role === 'user' ? 'You' : 'Answer'}>
        {m.role === 'user' && <span className="assist-chat-who">You</span>}
        {m.blocks.map((b, i) => <Block key={i} block={b} />)}
      </article>)}
    </div>
    <div className="assist-chat-quick" aria-label="Quick questions">
      {QUICK_QUESTIONS.map((q) => <button key={q.label} type="button" onClick={() => ask(q.question)}>{q.label}</button>)}
    </div>
    <form onSubmit={submit} className="assist-chat-form">
      <input id="assist-chat-input" aria-label="Your question" data-testid="chat-input" type="text" value={text} maxLength={300} autoComplete="off" onChange={(event) => setText(event.target.value)} placeholder="For example: which mask should I wear?" />
      <button type="submit" data-testid="chat-send">Ask</button>
    </form>
  </section>;
}
