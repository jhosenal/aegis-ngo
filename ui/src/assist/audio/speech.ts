import type { Card } from '../../../../src/assist/contract.js';

export type SpeechSegment =
  | { kind: 'title'; text: string }
  | { kind: 'line'; text: string; lineIndex: number }
  | { kind: 'sources'; text: string };

export type SpeakFailureReason = 'user-gesture-required' | 'speech-unavailable' | 'no-english-voice' | 'english-only';
export type SpeakResult = { ok: true } | { ok: false; reason: SpeakFailureReason };

export interface SpeakOptions {
  pauseBetweenLinesMs?: number;
  onLineChange?: (lineIndex: number | null) => void;
  onStatus?: (status: 'speaking' | 'complete' | 'stopped' | 'unavailable' | 'error') => void;
}

interface SpeechSynthesisPort {
  cancel(): void;
  speak(text: string, lang: string, onEnd: () => void, onError: () => void): void;
}

export interface SpeechSequenceOptions {
  pauseBetweenLinesMs?: number;
  onSegment?: (segment: SpeechSegment) => void;
  onComplete?: () => void;
  onError?: () => void;
}

const DEFAULT_PAUSE_MS = 350;
let trustedGestureSeen = false;
let stopActiveSequence: (() => void) | null = null;

if (typeof document !== 'undefined') {
  const rememberTrustedGesture = (event: Event) => {
    if (event.isTrusted) trustedGestureSeen = true;
  };
  document.addEventListener('pointerdown', rememberTrustedGesture, true);
  document.addEventListener('keydown', rememberTrustedGesture, true);
  document.addEventListener('click', rememberTrustedGesture, true);
}

function hasPageGesture(): boolean {
  if (trustedGestureSeen) return true;
  return typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true;
}

function getSynthesis(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return null;
  return window.speechSynthesis;
}

/** English voices only; an empty list can become populated after `voiceschanged`. */
export function listVoices(): SpeechSynthesisVoice[] {
  const synthesis = getSynthesis();
  if (!synthesis) return [];
  return synthesis.getVoices().filter((voice) => /^en(?:-|$)/i.test(voice.lang));
}

/** True when browser speech synthesis and at least one English voice are available. */
export function canSpeak(): boolean {
  return getSynthesis() !== null && listVoices().length > 0;
}

/** Build the spoken order without changing or generating card guidance. */
export function buildSpeechSegments(card: Card): SpeechSegment[] {
  const segments: SpeechSegment[] = [{ kind: 'title', text: card.title }];
  card.lines.forEach((line, lineIndex) => {
    segments.push({
      kind: 'line',
      lineIndex,
      text: line.condition ? `${line.text} Condition: ${line.condition}` : line.text,
    });
  });

  const sourceById = new Map(card.sources.map((source) => [source.sourceId, source]));
  const publishers: string[] = [];
  const seen = new Set<string>();
  for (const line of card.lines) {
    const source = sourceById.get(line.sourceId);
    if (source && !seen.has(source.sourceId)) {
      seen.add(source.sourceId);
      publishers.push(source.publisher);
    }
  }
  if (publishers.length > 0) segments.push({ kind: 'sources', text: `Sources: ${publishers.join('; ')}` });
  return segments;
}

/**
 * Sequencing core with an injected speech port. Production passes the browser
 * speechSynthesis adapter; tests inject a small fake port.
 */
export function playSpeechSequence(
  segments: SpeechSegment[],
  port: SpeechSynthesisPort,
  options: SpeechSequenceOptions = {},
): () => void {
  let stopped = false;
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  const pause = Math.max(0, options.pauseBetweenLinesMs ?? DEFAULT_PAUSE_MS);

  port.cancel();
  const finishOrPlay = (index: number) => {
    if (stopped) return;
    if (index >= segments.length) {
      stopped = true;
      options.onComplete?.();
      return;
    }
    const segment = segments[index];
    if (!segment) return;
    options.onSegment?.(segment);
    const afterEnd = () => {
      if (stopped) return;
      const next = segments[index + 1];
      const shouldPause = segment.kind === 'line' && next?.kind === 'line';
      if (shouldPause) pauseTimer = setTimeout(() => finishOrPlay(index + 1), pause);
      else finishOrPlay(index + 1);
    };
    const fail = () => {
      if (stopped) return;
      stopped = true;
      if (pauseTimer !== null) clearTimeout(pauseTimer);
      pauseTimer = null;
      port.cancel();
      options.onError?.();
    };
    try {
      port.speak(segment.text, 'en', afterEnd, fail);
    } catch {
      fail();
    }
  };
  finishOrPlay(0);

  return () => {
    if (stopped) return;
    stopped = true;
    if (pauseTimer !== null) clearTimeout(pauseTimer);
    pauseTimer = null;
    port.cancel();
  };
}

/** Start reading after a user gesture and only when an English voice is present. */
export function speakCard(card: Card, options: SpeakOptions = {}): SpeakResult {
  if (!hasPageGesture()) return { ok: false, reason: 'user-gesture-required' };
  if (card.language !== 'en') return { ok: false, reason: 'english-only' };

  const synthesis = getSynthesis();
  if (!synthesis) {
    options.onStatus?.('unavailable');
    return { ok: false, reason: 'speech-unavailable' };
  }
  const voices = listVoices();
  if (voices.length === 0) {
    options.onStatus?.('unavailable');
    return { ok: false, reason: 'no-english-voice' };
  }

  stopSpeaking();
  const voice = voices[0];
  const port: SpeechSynthesisPort = {
    cancel: () => synthesis.cancel(),
    speak: (text, lang, onEnd, onError) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.voice = voice ?? null;
      utterance.onend = onEnd;
      utterance.onerror = onError;
      synthesis.speak(utterance);
    },
  };

  options.onStatus?.('speaking');
  let stop = () => {};
  stop = playSpeechSequence(buildSpeechSegments(card), port, {
    pauseBetweenLinesMs: options.pauseBetweenLinesMs,
    onSegment: (segment) => options.onLineChange?.(segment.kind === 'line' ? segment.lineIndex : null),
    onComplete: () => {
      if (stopActiveSequence === stop) stopActiveSequence = null;
      options.onLineChange?.(null);
      options.onStatus?.('complete');
    },
    onError: () => {
      if (stopActiveSequence === stop) stopActiveSequence = null;
      options.onStatus?.('error');
    },
  });
  stopActiveSequence = () => {
    stop();
    options.onLineChange?.(null);
    options.onStatus?.('stopped');
  };
  return { ok: true };
}

/** Cancel current speech and any inter-line pause. Safe to call repeatedly. */
export function stopSpeaking(): void {
  const stop = stopActiveSequence;
  stopActiveSequence = null;
  if (stop) stop();
  else getSynthesis()?.cancel();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSpeaking();
  });
}
