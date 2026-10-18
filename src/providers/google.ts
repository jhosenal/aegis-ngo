import { ProviderError, type ModelProvider, type ModelRequest, type ModelResponse } from '../types/domain.js';
import { RequestPacer } from './pacer.js';

/**
 * Google Gemini API adapter (REST generateContent), written against
 * https://ai.google.dev/api/generate-content and https://ai.google.dev/gemini-api/docs/troubleshooting
 * as read on 2026-10-13. The API key goes in the x-goog-api-key header, never in the URL, and never into an error message.
 */
export const GOOGLE_HOST = 'generativelanguage.googleapis.com';
const JSON_SCHEMA_IDS = new Set(['manager-proposal-v1', 'helper-turn-v1', 'translation-v1']);
const MAX_RESPONSE_CHARS = 262_144;
const DEFAULT_COOLDOWN_MS = 60_000;
const REFUSAL_FINISH = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']);

export interface GoogleOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  pacer?: RequestPacer;
  /** Thinking effort for Gemini 3 models (thoughts count toward maxOutputTokens and add latency). Default low; supported by 3.5 Flash-Lite and 3.8 Flash. */
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
}

interface GeminiPart { text?: unknown; thought?: unknown }
interface GeminiBody {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; thoughtsTokenCount?: unknown };
  modelVersion?: unknown;
  error?: { status?: string; message?: string; details?: Array<Record<string, unknown>> };
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Seconds from a Retry-After header or a Google RetryInfo detail such as "34s"; null when absent. */
function retryDelayMs(headers: Headers, body: GeminiBody | null): number | null {
  const header = Number(headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  for (const detail of body?.error?.details ?? []) {
    const raw = detail['retryDelay'];
    const match = typeof raw === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(raw) : null;
    if (match?.[1]) return Number(match[1]) * 1000;
  }
  return null;
}

function parseBody(text: string): GeminiBody | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value as GeminiBody : null;
  } catch {
    return null;
  }
}

function invalidKey(body: GeminiBody | null): boolean {
  return (body?.error?.details ?? []).some((detail) => detail['reason'] === 'API_KEY_INVALID')
    || /api key not valid|api_key_invalid/i.test(body?.error?.message ?? '');
}

export class GoogleProvider implements ModelProvider {
  readonly id = 'google' as const;
  readonly isStub = false;
  private readonly endpointBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pacer: RequestPacer;
  /** A 429 is usually about ONE model (for example a model the plan has no quota for): only that model cools down, so a refused Argon request cannot stop Flash for everyone. */
  private readonly modelBlockedUntil = new Map<string, number>();

  constructor(private readonly options: GoogleOptions) {
    if (!options.apiKey) throw new ProviderError('AUTH', 'Google API key is not configured');
    const base = new URL(options.baseUrl ?? `https://${GOOGLE_HOST}`);
    if (base.protocol !== 'https:' || base.hostname !== GOOGLE_HOST || base.username || base.password) {
      throw new ProviderError('BAD_REQUEST', `The Google adapter only calls ${GOOGLE_HOST} over https`);
    }
    this.endpointBase = `${base.origin}/v1beta/models/`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pacer = options.pacer ?? new RequestPacer({ minIntervalMs: 12_000, dailyCap: 200, maxWaitMs: 15_000 });
  }

  async call(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    if (this.pacer.currentTime() < (this.modelBlockedUntil.get(req.model) ?? 0)) throw new ProviderError('TRANSIENT', `Google is cooling down for ${req.model} after a rate-limit response`);
    await this.pacer.acquire(signal);
    const wantsJson = JSON_SCHEMA_IDS.has(req.responseSchemaId);
    const payload = JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens,
        temperature: 0,
        ...(wantsJson ? { responseMimeType: 'application/json' } : {}),
        ...(/^gemini-3/.test(req.model) ? { thinkingConfig: { thinkingLevel: this.options.thinkingLevel ?? 'low' } } : {}),
      },
    });
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpointBase}${encodeURIComponent(req.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        body: payload,
        signal,
      });
    } catch (error: unknown) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new ProviderError('TIMEOUT', 'Google request timed out', true);
      }
      throw new ProviderError('TRANSIENT', 'Google request failed before a response');
    }

    const text = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
    const body = parseBody(text);
    if (response.status !== 200) throw this.statusError(response, body, req.model);
    return this.readSuccess(body);
  }

  private statusError(response: Response, body: GeminiBody | null, model: string): ProviderError {
    const status = response.status;
    if (status === 429) {
      this.modelBlockedUntil.set(model, this.pacer.currentTime() + (retryDelayMs(response.headers, body) ?? DEFAULT_COOLDOWN_MS));
      return new ProviderError('TRANSIENT', 'Google rate limit (429)');
    }
    if (status === 401 || status === 403 || (status === 400 && invalidKey(body))) return new ProviderError('AUTH', `Google rejected the credentials (${status})`);
    if (status === 408 || status === 504) return new ProviderError('TIMEOUT', `Google timed out (${status})`, true);
    if (status >= 500) {
      const delay = retryDelayMs(response.headers, body);
      if (delay !== null) this.pacer.blockFor(delay);
      return new ProviderError('TRANSIENT', `Google server error (${status})`);
    }
    const reason = typeof body?.error?.message === 'string' ? `: ${body.error.message.split(this.options.apiKey).join('[key]').slice(0, 160)}` : '';
    return new ProviderError('BAD_REQUEST', `Google rejected the request (${status})${reason}`);
  }

  private readSuccess(body: GeminiBody | null): ModelResponse {
    if (!body) throw new ProviderError('MALFORMED', 'Google returned a body that is not JSON', true);
    if (body.promptFeedback?.blockReason) throw new ProviderError('REFUSAL', `Google blocked the prompt (${body.promptFeedback.blockReason})`);
    const candidate = body.candidates?.[0];
    if (!candidate) throw new ProviderError('MALFORMED', 'Google returned no candidate', true);
    if (candidate.finishReason && REFUSAL_FINISH.has(candidate.finishReason)) {
      throw new ProviderError('REFUSAL', `Google stopped the answer (${candidate.finishReason})`, true);
    }
    if (candidate.finishReason === 'MAX_TOKENS') throw new ProviderError('MALFORMED', 'Google answer was cut off at the token limit', true);
    const text = (candidate.content?.parts ?? [])
      .filter((part) => part.thought !== true && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('');
    if (text === '') throw new ProviderError('MALFORMED', 'Google returned an empty answer', true);
    const input = nonNegativeInteger(body.usageMetadata?.promptTokenCount);
    const output = nonNegativeInteger(body.usageMetadata?.candidatesTokenCount);
    const thoughts = nonNegativeInteger(body.usageMetadata?.thoughtsTokenCount) ?? 0;
    return {
      text,
      reportedModel: typeof body.modelVersion === 'string' ? body.modelVersion : null,
      usage: input === null || output === null ? null : { inputTokens: input, outputTokens: output + thoughts },
    };
  }
}
