import { useEffect, useState } from 'react';
import type { Card } from '../../../../src/assist/contract.js';
import { canSpeak, listVoices, speakCard, stopSpeaking, type SpeakResult } from './speech.js';

const unavailableText = 'Reading aloud is not available on this device';

export function CoachControls({ card }: { card: Card }) {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState('');
  const [readingLine, setReadingLine] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const updateVoices = () => setAvailable(canSpeak());
    updateVoices();
    const synthesis = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    synthesis?.addEventListener('voiceschanged', updateVoices);
    return () => {
      synthesis?.removeEventListener('voiceschanged', updateVoices);
      stopSpeaking();
    };
  }, []);

  const readAloud = () => {
    if (!available || listVoices().length === 0) {
      setAvailable(false);
      setStatus(unavailableText);
      return;
    }
    const result: SpeakResult = speakCard(card, {
      onLineChange: (lineIndex) => {
        setReadingLine(lineIndex);
        if (lineIndex !== null) setStatus(`Reading line ${lineIndex + 1} of ${card.lines.length}`);
      },
      onStatus: (nextStatus) => {
        if (nextStatus === 'speaking') {
          setSpeaking(true);
          setStatus('Reading aloud');
        } else {
          setSpeaking(false);
          if (nextStatus === 'stopped') setStatus('Speech stopped');
          if (nextStatus === 'complete') setStatus('Reading aloud complete');
          if (nextStatus === 'unavailable') setStatus(unavailableText);
          if (nextStatus === 'error') setStatus('Reading aloud could not be completed');
        }
      },
    });
    if (!result.ok) {
      if (result.reason === 'user-gesture-required') setStatus('Tap Read aloud to start the coach');
      else if (result.reason === 'english-only') setStatus('Reading aloud is available for English cards only');
      else setStatus(unavailableText);
      setSpeaking(false);
    }
  };

  const stop = () => {
    stopSpeaking();
    setSpeaking(false);
    setReadingLine(null);
    setStatus('Speech stopped');
  };

  return <section aria-label="Spoken coach">
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="button" onClick={readAloud} disabled={!available || speaking} style={{ minHeight: 48, minWidth: 48 }}>
        Read aloud
      </button>
      <button type="button" onClick={stop} disabled={!speaking} style={{ minHeight: 48, minWidth: 48 }}>
        Stop
      </button>
    </div>
    {!available && <p>{unavailableText}</p>}
    <p aria-live="polite" role="status">{status}</p>
    <h3>{card.title}</h3>
    <ol>
      {card.lines.map((line, index) => <li key={line.id} aria-current={readingLine === index ? 'step' : undefined}>
        {line.text}{line.condition ? ` Condition: ${line.condition}` : ''}
      </li>)}
    </ol>
    <p>Sources: {[...new Set(card.lines.map((line) => card.sources.find((source) => source.sourceId === line.sourceId)?.publisher).filter((publisher): publisher is string => Boolean(publisher)))].join('; ')}</p>
  </section>;
}
