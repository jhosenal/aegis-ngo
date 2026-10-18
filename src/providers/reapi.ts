import { ProviderError, type ModelProvider, type ModelRequest, type ModelResponse } from '../types/domain.js';
import { RequestPacer } from './pacer.js';

/**
 * reAPI backup adapter. reAPI is an OpenAI-compatible aggregator (https://reapi.ai/docs): POST <base>/chat/completions with
 * `Authorization: Bearer <key>`, a reply carrying choices[0].message.content and usage.prompt_tokens / completion_tokens.
 * The request shape follows the working client in the QZEEX project (checked there 2026-10-06). It fails closed: it only
 * ever calls reapi.ai over https, and the key never appears in an error message.
 */
export const REAPI_HOST = 'reapi.ai';
const MAX_RESPONSE_CHARS = 262_144;
const MAX_COOLDOWN_MS = 5_000;
const JSON_SCHEMA_IDS = new Set(['manager-proposal-v1', 'helper-turn-v1', 'translation-v1']);

/**
 * How each reAPI model wants its request. From the QZEEX project's price table (read 2026-10-06; its live tests of 2026-10-01 found
 * the Claude models ignore strict JSON and deepseek has no JSON mode). A model not listed gets the safe default: no JSON mode, so the
 * answer is checked by code afterwards, and the output-limit field from the options.
 */
export interface ReapiModelProfile { tokenParam: 'max_completion_tokens' | 'max_tokens'; jsonMode: boolean; reasoningEffort: 'low' | null }
export const REAPI_MODEL_PROFILES: Readonly<Record<string, ReapiModelProfile>> = {
  'gpt-6-luna': { tokenParam: 'max_completion_tokens', jsonMode: true, reasoningEffort: 'low' },
  'gpt-6-sol': { tokenParam: 'max_completion_tokens', jsonMode: true, reasoningEffort: 'low' },
  'kimi-k3': { tokenParam: 'max_completion_tokens', jsonMode: true, reasoningEffort: 'low' },
  'deepseek-v4.1-flash': { tokenParam: 'max_tokens', jsonMode: false, reasoningEffort: 'low' },
  'claude-opus-5-5': { tokenParam: 'max_tokens', jsonMode: false, reasoningEffort: 'low' },
};

export interface ReapiOptions {
  apiKey: string;
  baseUrl: string;
  /** Output-limit field for a model that has no profile: max_completion_tokens (default) or max_tokens. */
  tokenParam?: 'max_completion_tokens' | 'max_tokens';
  fetchImpl?: typeof fetch;
  pacer?: RequestPacer;
}

interface ChatBody {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  model?: unknown;
  error?: { message?: unknown };
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseBody(text: string): ChatBody | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value as ChatBody : null;
  } catch {
    return null;
  }
}

export class ReapiProvider implements ModelProvider {
  readonly id = 'reapi' as const;
  readonly isStub = false;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pacer: RequestPacer;

  constructor(private readonly options: ReapiOptions) {
    if (!options.apiKey) throw new ProviderError('AUTH', 'reAPI key is not configured');
    let base: URL;
    try { base = new URL(options.baseUrl); } catch { throw new ProviderError('BAD_REQUEST', 'reAPI base URL is not a URL'); }
    if (base.protocol !== 'https:' || base.hostname !== REAPI_HOST || base.username || base.password || (base.port && base.port !== '443')) {
      throw new ProviderError('BAD_REQUEST', `The reAPI adapter only calls ${REAPI_HOST} over https`);
    }
    this.endpoint = `${base.origin}${base.pathname.replace(/\/+$/, '')}/chat/completions`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pacer = options.pacer ?? new RequestPacer({ minIntervalMs: 200, dailyCap: 0, maxWaitMs: 5_000 });
  }

  async call(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    await this.pacer.acquire(signal);
    const profile = REAPI_MODEL_PROFILES[req.model];
    const wantsJson = JSON_SCHEMA_IDS.has(req.responseSchemaId) && (profile?.jsonMode ?? false);
    const effort = profile?.reasoningEffort ?? null;
    // reAPI's json_object mode rejects a request whose messages lack the lowercase word "json".
    // This provider checks the user content for its JSON-mode keyword, even
    // when the system instruction already requests JSON.
    const needsHint = wantsJson && !/json/i.test(req.user);
    const user = needsHint ? `${req.user}

(Respond with a single json object.)` : req.user;
    const system = req.system;
    const payload = JSON.stringify({
      model: req.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      [profile?.tokenParam ?? this.options.tokenParam ?? 'max_completion_tokens']: req.maxOutputTokens,
      ...(effort ? { reasoning_effort: effort } : {}),
      ...(wantsJson ? { response_format: { type: 'json_object' } } : {}),
    });
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
        body: payload,
        signal,
      });
    } catch (error: unknown) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new ProviderError('TIMEOUT', 'reAPI request timed out', true);
      }
      throw new ProviderError('TRANSIENT', 'reAPI request failed before a response');
    }
    const text = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
    const body = parseBody(text);
    if (response.status !== 200) throw this.statusError(response, body);
    return this.readSuccess(body);
  }

  private statusError(response: Response, body: ChatBody | null): ProviderError {
    const status = response.status;
    const reason = typeof body?.error?.message === 'string' ? `: ${body.error.message.split(this.options.apiKey).join('[key]').slice(0, 160)}` : '';
    if (status === 429 || status >= 500) {
      const after = Number(response.headers.get('retry-after'));
      if (Number.isFinite(after) && after > 0) this.pacer.blockFor(Math.min(after * 1000, MAX_COOLDOWN_MS));
      return new ProviderError('TRANSIENT', `reAPI returned HTTP ${status}`);
    }
    if (status === 401 || status === 403) return new ProviderError('AUTH', `reAPI rejected the credentials (${status})`);
    if (status === 408) return new ProviderError('TIMEOUT', 'reAPI timed out (408)', true);
    return new ProviderError('BAD_REQUEST', `reAPI rejected the request (${status})${reason}`);
  }

  private readSuccess(body: ChatBody | null): ModelResponse {
    if (!body) throw new ProviderError('MALFORMED', 'reAPI returned a body that is not JSON', true);
    const choice = body.choices?.[0];
    if (!choice) throw new ProviderError('MALFORMED', 'reAPI returned no choice', true);
    if (choice.finish_reason === 'content_filter') throw new ProviderError('REFUSAL', 'reAPI filtered the answer', true);
    if (choice.finish_reason === 'length') throw new ProviderError('MALFORMED', 'reAPI answer was cut off at the token limit', true);
    const content = choice.message?.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content) ? content.map((part: { text?: unknown }) => (typeof part?.text === 'string' ? part.text : '')).join('') : '';
    if (text === '') throw new ProviderError('MALFORMED', 'reAPI returned an empty answer', true);
    const input = nonNegativeInteger(body.usage?.prompt_tokens);
    const output = nonNegativeInteger(body.usage?.completion_tokens);
    return {
      text,
      reportedModel: typeof body.model === 'string' ? body.model : null,
      usage: input === null || output === null ? null : { inputTokens: input, outputTokens: output },
    };
  }
}
