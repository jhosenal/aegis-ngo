// Google Cloud Translation (Basic, v2) as the FAST first pass for emergency bulletins (AEG-NEWS-007). It translates the code-written English; code then checks every number and name, a language model
// translates back to English for the reviewer, and a person who reads the language approves. Switched on with AEGIS_TRANSLATE_ENABLED=true; authorised by AEGIS_GOOGLE_TRANSLATE_API_KEY, else
// AEGIS_GOOGLE_TTS_API_KEY (one key restricted to Text-to-Speech and Translation), else, on Cloud Run, the service account token. Never given a Google air or weather value (bulletins hold none).
// Price: first 500,000 characters a month free, then 20 USD per 1M characters (Google pricing page; confirm in the price book before relying on it).
export interface MachineTranslator { name: string; translate(texts: string[], target: string, source?: string): Promise<string[]> }
export interface TranslateSettings { apiKey?: string | undefined; fetchImpl?: typeof fetch; token?: () => Promise<string> }

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const METADATA_TOKEN = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

async function metadataToken(fetchImpl: typeof fetch): Promise<string> {
  const r = await fetchImpl(METADATA_TOKEN, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error(`no service account token (HTTP ${r.status})`);
  return ((await r.json()) as { access_token: string }).access_token;
}

export function createGoogleTranslator(s: TranslateSettings): MachineTranslator {
  const fetchImpl = s.fetchImpl ?? fetch;
  return {
    name: 'google-cloud-translation',
    async translate(texts: string[], target: string, source = 'en'): Promise<string[]> {
      if (texts.length === 0) return [];
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (s.apiKey) headers['X-Goog-Api-Key'] = s.apiKey; else headers['authorization'] = `Bearer ${await (s.token ?? (() => metadataToken(fetchImpl)))()}`;
      const r = await fetchImpl(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ q: texts, source, target, format: 'text' }), signal: AbortSignal.timeout(20_000) });
      const body = await r.text();
      if (!r.ok) { let status = `HTTP ${r.status}`; try { const j = JSON.parse(body) as { error?: { status?: string } }; if (j.error?.status) status += ` ${j.error.status}`; } catch { /* keep the HTTP status only */ } throw new Error(`Google Cloud Translation failed (${status})`); }
      const out = (JSON.parse(body) as { data?: { translations?: { translatedText?: string }[] } }).data?.translations?.map((t) => t.translatedText ?? '') ?? [];
      if (out.length !== texts.length || out.some((t) => t.trim() === '')) throw new Error('Google Cloud Translation returned an incomplete answer');
      return out;
    },
  };
}

/** From the environment, or null when the fast path is not switched on. */
export function translatorFromEnv(env: NodeJS.ProcessEnv): MachineTranslator | null {
  if (env['AEGIS_TRANSLATE_ENABLED'] !== 'true') return null;
  return createGoogleTranslator({ apiKey: env['AEGIS_GOOGLE_TRANSLATE_API_KEY'] || env['AEGIS_GOOGLE_TTS_API_KEY'] || undefined });
}
