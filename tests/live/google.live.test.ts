import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GoogleProvider } from '../../src/providers/google.js';
import { ReapiProvider } from '../../src/providers/reapi.js';
import { RequestPacer } from '../../src/providers/pacer.js';
import { SEATS } from '../../src/roles/seats.js';
import type { ModelRequest } from '../../src/types/domain.js';

// DISABLED (S0038 finding 7). These checks called the providers directly, outside ModelGateway, its reservation path, the per-funding allowances
// and the SOP (testing on reAPI gpt-6-luna only; Gemini only as the single acceptance turn on the deployed live revision). Setting a flag could not
// enforce any of that, so the entry point is off. Governed replacement: S0036 step 5 (one real turn through the deployed gateway, after the cost gate
// and with the provider caps CONFIRMED). A routine reAPI check should be written to go through ModelGateway, not around it.
// The code below is kept only so the request shapes stay documented; nothing here runs.
const enabled = false as boolean;
const request = (model: string): ModelRequest => ({
  attemptId: 'LIVE-1', roleId: 'manager', model, system: 'Reply with exactly one JSON object.',
  user: 'Return {"ok":true}', responseSchemaId: 'manager-proposal-v1', maxOutputTokens: 256, dataClass: 'public',
});

function record(provider: string, label: string, model: string, reported: string | null, usage: unknown, ms: number): void {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const directory = join(process.cwd(), 'records', 'evidence');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `AEG-LIVE-${label}_${stamp}.md`), [
    `# LIVE ${provider} ${stamp}`, '',
    '| Field | Value |', '|---|---|',
    '| Written by | tests/live/google.live.test.ts (executed, not hand-written) |',
    `| Provider | ${provider} |`, `| Requested model | ${model} |`, `| Reported model | ${reported ?? 'none reported'} |`,
    `| Usage | ${JSON.stringify(usage)} |`, `| Latency ms | ${ms} |`, '| Calls | 1 |',
    '', 'One tiny public prompt; no key, prompt body or answer is recorded.', '',
  ].join('\n'));
}

describe.skipIf(!enabled)('live provider checks (DISABLED: ungoverned spend, see the comment at the top)', () => {
  it.skipIf(!process.env.AEGIS_GOOGLE_API_KEY)('Google answers one tiny request with usage and a reported model', async () => {
    const model = process.env.AEGIS_GOOGLE_MODEL ?? '';
    const provider = new GoogleProvider({
      apiKey: process.env.AEGIS_GOOGLE_API_KEY ?? '',
      pacer: new RequestPacer({ minIntervalMs: 12_000, dailyCap: 5, maxWaitMs: 15_000 }),
    });
    const started = Date.now();
    const result = await provider.call(request(model), AbortSignal.timeout(30_000));
    record('google', 'google', model, result.reportedModel, result.usage, Date.now() - started);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it.skipIf(!process.env.AEGIS_REAPI_API_KEY)('reAPI answers one tiny request with usage and a reported model', async () => {
    const provider = new ReapiProvider({
      apiKey: process.env.AEGIS_REAPI_API_KEY ?? '',
      baseUrl: process.env.AEGIS_REAPI_BASE_URL ?? '',
    });
    // One tiny call per distinct seat model, so every request profile is checked against the real endpoint.
    const models = [...new Set(Object.values(SEATS).map((seat) => seat.reapiModel))];
    for (const model of models) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));   // be gentle: one call at a time, spaced out
      const started = Date.now();
      const result = await provider.call(request(model), AbortSignal.timeout(60_000));
      record('reapi', `reapi-${model}`, model, result.reportedModel, result.usage, Date.now() - started);
      expect(result.text.length).toBeGreaterThan(0);
    }
  });
});
