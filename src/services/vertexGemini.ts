// Gemini on Vertex AI (AEG-NEWS-007): the production path for the Gemini models, billed to the Google Cloud project (and so to its credit), authorised by the local gcloud login or the Cloud Run service
// account, with no API key in the browser or in the code. This client makes ONE generateContent call and reports the real token counts the API returns (prompt, answer and thinking tokens), so the cost
// of every call is measured, not guessed. Thinking tokens are billed as output. It never sends a Google air or weather value (the script review sends one bulletin segment of code-written text).
import { tokenFor } from './gcpAuth.js';

export interface VertexUsage { promptTokens: number; outputTokens: number; thoughtsTokens: number; totalTokens: number }
export interface VertexReply { text: string; usage: VertexUsage; model: string; modelVersion: string | null; latencyMs: number; finishReason: string | null }
export interface VertexClient { model: string; project: string; location: string; generate(system: string, user: string, opts?: { maxOutputTokens?: number }): Promise<VertexReply> }
export interface VertexSettings { project: string; location?: string; model?: string; auth?: 'gcloud' | 'metadata'; fetchImpl?: typeof fetch; token?: () => Promise<string>; now?: () => number }

const SAFE = /^[A-Za-z0-9_.-]+$/;
const int = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; };

export function createVertexClient(s: VertexSettings): VertexClient {
  const location = s.location ?? 'global'; const model = s.model ?? 'gemini-4-argon';
  if (![s.project, location, model].every((x) => SAFE.test(x))) throw new Error('The Vertex project, location and model may contain only letters, digits, dot, dash and underscore');
  const fetchImpl = s.fetchImpl ?? fetch; const token = s.token ?? tokenFor(s.auth ?? 'metadata', fetchImpl); const now = s.now ?? (() => Date.now());
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return {
    model, project: s.project, location,
    async generate(system, user, opts) {
      const t0 = now();
      const r = await fetchImpl(`https://${host}/v1/projects/${s.project}/locations/${location}/publishers/google/models/${model}:generateContent`, {
        method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', 'x-goog-user-project': s.project }, signal: AbortSignal.timeout(100_000),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: opts?.maxOutputTokens ?? 1200, temperature: 0 } }),
      });
      const body = await r.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; usageMetadata?: Record<string, unknown>; modelVersion?: string; error?: { status?: string; message?: string } };
      if (!r.ok) throw new Error(`Vertex AI refused the request (HTTP ${r.status}${body.error?.status ? ` ${body.error.status}` : ''})`);
      const c = body.candidates?.[0]; const text = (c?.content?.parts ?? []).filter((p) => p.thought !== true).map((p) => p.text ?? '').join('').trim();
      if (!text) throw new Error(`Vertex AI returned no text (finish reason ${c?.finishReason ?? 'unknown'})`);
      const u = body.usageMetadata ?? {};
      const usage: VertexUsage = { promptTokens: int(u['promptTokenCount']), outputTokens: int(u['candidatesTokenCount']), thoughtsTokens: int(u['thoughtsTokenCount']), totalTokens: int(u['totalTokenCount']) };
      return { text, usage, model, modelVersion: body.modelVersion ?? null, latencyMs: now() - t0, finishReason: c?.finishReason ?? null };
    },
  };
}

/** From the environment, or null when Vertex AI is not configured. */
export function vertexFromEnv(env: NodeJS.ProcessEnv): VertexClient | null {
  const project = env['AEGIS_VERTEX_PROJECT']; if (!project) return null;
  return createVertexClient({ project, location: env['AEGIS_VERTEX_LOCATION'] || 'global', model: env['AEGIS_VERTEX_MODEL'] || 'gemini-4-argon', auth: env['AEGIS_VERTEX_AUTH'] === 'gcloud' ? 'gcloud' : 'metadata' });
}
