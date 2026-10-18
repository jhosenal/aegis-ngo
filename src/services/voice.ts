// Voice for an approved bulletin (AEG-NEWS-007): Google Cloud Text-to-Speech reads the code-written, validated script. It never reads Google air or weather values (the script contains none).
// Switched on with AEGIS_TTS_ENABLED=true; the call is authorised by AEGIS_GOOGLE_TTS_API_KEY (a key allowed to call Cloud Text-to-Speech) or, on Cloud Run, the service account's own token.
// Standard voices cost 4 USD per 1M characters after 4M free each month (billing catalog, 2026-10-17); a bulletin is about 3,000 characters.
export interface SpeakOptions { voice: string; languageCode: string; /** 1 is normal speed; an emergency alert is read a little faster (0.25 to 4 allowed by Google). */ speakingRate?: number }
export interface Synthesizer { voice: string; synthesize(text: string, opts?: Partial<SpeakOptions> & { speakingRate?: number }): Promise<Buffer> }
export interface TtsSettings { apiKey?: string | undefined; voice: string; languageCode: string; fetchImpl?: typeof fetch; token?: () => Promise<string> }

const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const METADATA_TOKEN = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
export const MAX_REQUEST_BYTES = 4500;   // Google accepts up to 5,000 bytes of text per request

/** Splits a text into pieces that fit one request, at sentence ends where possible. */
export function splitForTts(text: string, maxBytes = MAX_REQUEST_BYTES): string[] {
  const out: string[] = []; let cur = '';
  const push = (piece: string): void => { if (piece) out.push(piece); };
  for (const sentence of text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)) {
    if (Buffer.byteLength(sentence) > maxBytes) { push(cur); cur = ''; const words = sentence.split(' '); let w = ''; for (const word of words) { if (Buffer.byteLength(`${w} ${word}`) > maxBytes) { push(w); w = word; } else w = w ? `${w} ${word}` : word; } push(w); continue; }
    if (Buffer.byteLength(`${cur} ${sentence}`) > maxBytes) { push(cur); cur = sentence; } else cur = cur ? `${cur} ${sentence}` : sentence;
  }
  push(cur);
  return out;
}

async function metadataToken(fetchImpl: typeof fetch): Promise<string> {
  const r = await fetchImpl(METADATA_TOKEN, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error(`no service account token (HTTP ${r.status})`);
  return ((await r.json()) as { access_token: string }).access_token;
}

export function createGoogleTts(s: TtsSettings): Synthesizer {
  const fetchImpl = s.fetchImpl ?? fetch;
  return {
    voice: s.voice,
    async synthesize(text: string, opts?: Partial<SpeakOptions>): Promise<Buffer> {
      const parts: Buffer[] = [];
      for (const piece of splitForTts(text)) {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (s.apiKey) headers['X-Goog-Api-Key'] = s.apiKey; else headers['authorization'] = `Bearer ${await (s.token ?? (() => metadataToken(fetchImpl)))()}`;
        const r = await fetchImpl(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ input: { text: piece }, voice: { languageCode: opts?.languageCode ?? s.languageCode, name: opts?.voice ?? s.voice }, audioConfig: { audioEncoding: 'MP3', ...(opts?.speakingRate && opts.speakingRate !== 1 ? { speakingRate: opts.speakingRate } : {}) } }) });
        const body = await r.text();
        if (!r.ok) { let status = `HTTP ${r.status}`; try { const j = JSON.parse(body) as { error?: { status?: string } }; if (j.error?.status) status += ` ${j.error.status}`; } catch { /* keep the HTTP status only */ } throw new Error(`Google Text-to-Speech refused the request (${status})`); }
        const audio = (JSON.parse(body) as { audioContent?: string }).audioContent;
        if (!audio) throw new Error('Google Text-to-Speech returned no audio');
        parts.push(Buffer.from(audio, 'base64'));
      }
      return Buffer.concat(parts);   // MP3 frames can simply follow each other
    },
  };
}

/** From the environment, or null when the voice is not switched on. */
export function ttsFromEnv(env: NodeJS.ProcessEnv): Synthesizer | null {
  if (env['AEGIS_TTS_ENABLED'] !== 'true') return null;
  return createGoogleTts({ apiKey: env['AEGIS_GOOGLE_TTS_API_KEY'] || undefined, voice: env['AEGIS_TTS_VOICE'] || 'en-GB-Standard-B', languageCode: env['AEGIS_TTS_LANGUAGE'] || 'en-GB' });
}
