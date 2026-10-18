import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';

/** Reads deploy/service.live.yaml and checks that its plain env values form a valid live configuration (keys replaced by stubs). */
function liveEnv(): Record<string, string> {
  const text = readFileSync('deploy/service.live.yaml', 'utf8');
  const env: Record<string, string> = { PORT: '8080' };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const name = /^\s+- name: (AEGIS_\w+)\s*$/.exec(lines[i] ?? '');
    const value = /^\s+value: "?([^"\n]*)"?\s*$/.exec(lines[i + 1] ?? '');
    if (name && value) env[name[1]!] = value[1]!;
  }
  return env;
}

describe('deploy/service.live.yaml and the spend authority (S0038 findings 2 and 3)', () => {
  const book = JSON.parse(readFileSync('records/costs/budget.json', 'utf8')) as { funding: { OTHER: { balanceUsd: string }; GEMINI_PREPAY: { balanceUsd: string } } };
  const micro = (usd: string): number => Math.round(Number(usd) * 1_000_000);

  it('does not allow more reAPI or Google runtime spend than the cost engine funds', () => {
    const env = liveEnv();
    expect(Number(env.AEGIS_BUDGET_REAPI_MICRO)).toBeGreaterThan(0);
    expect(Number(env.AEGIS_BUDGET_REAPI_MICRO)).toBeLessThanOrEqual(micro(book.funding.OTHER.balanceUsd));
    expect(Number(env.AEGIS_BUDGET_GOOGLE_MICRO)).toBeLessThanOrEqual(micro(book.funding.GEMINI_PREPAY.balanceUsd));
    expect(Number(env.AEGIS_PROVIDER_CAP_REAPI_MICRO)).toBeLessThanOrEqual(Number(env.AEGIS_BUDGET_REAPI_MICRO));
    expect(Number(env.AEGIS_PROVIDER_CAP_GOOGLE_MICRO)).toBeLessThanOrEqual(Number(env.AEGIS_BUDGET_GOOGLE_MICRO));
  });

  it('is refused by the configuration in the cloud without a provider-side cap, so a restart cannot renew the allowance', () => {
    const base = { ...liveEnv(), AEGIS_GOOGLE_API_KEY: 'stub-google', AEGIS_REAPI_API_KEY: 'stub-reapi' };
    expect(() => loadConfig({ ...base, AEGIS_SPEND_AUTHORITY: '' })).toThrow(/AEGIS_SPEND_AUTHORITY/);
    expect(() => loadConfig({ ...base, AEGIS_PROVIDER_CAP_GOOGLE_MICRO: '0' })).toThrow(/AEGIS_PROVIDER_CAP_GOOGLE_MICRO/);
    expect(() => loadConfig({ ...base, AEGIS_PROVIDER_CAP_REAPI_MICRO: '0' })).toThrow(/AEGIS_PROVIDER_CAP_REAPI_MICRO/);
    expect(() => loadConfig({ ...base, AEGIS_PROVIDER_CAP_GOOGLE_MICRO: '9000000' })).toThrow(/AEGIS_PROVIDER_CAP_GOOGLE_MICRO/);
  });

  it('stays marked not deployable until the owner confirms the provider caps', () => {
    const caps = JSON.parse(readFileSync('records/costs/provider-caps.json', 'utf8')) as { status: string; items: { status: string }[] };
    const yaml = readFileSync('deploy/service.live.yaml', 'utf8');
    if (caps.status !== 'CONFIRMED') expect(yaml).toContain('NOT DEPLOYABLE until records/costs/provider-caps.json says CONFIRMED');
    if (caps.status === 'CONFIRMED') expect(caps.items.every((item) => item.status === 'CONFIRMED')).toBe(true);
  });
});

describe('deploy/service.live.yaml', () => {
  it('holds no key values and references both secrets', () => {
    const text = readFileSync('deploy/service.live.yaml', 'utf8');
    expect(text).toContain('AEGIS_GOOGLE_API_KEY');
    expect(text).toContain('AEGIS_REAPI_API_KEY');
    expect(text).not.toMatch(/AIza|AQ\.|sk-/);
  });

  it('validates as a live configuration once the secrets are supplied', () => {
    const env = { ...liveEnv(), AEGIS_GOOGLE_API_KEY: 'stub-google', AEGIS_REAPI_API_KEY: 'stub-reapi' };
    const config = loadConfig(env);
    expect(config.providerMode).toBe('live');
    expect(config.modelsEnabled).toBe(true);
    expect(config.primaryProvider).toBe('google');
  });

  it('keeps the runtime caps inside the owner-approved numbers', () => {
    const env = liveEnv();
    expect(Number(env.AEGIS_BUDGET_ACCOUNT_MICRO)).toBeLessThanOrEqual(2_000_000);
    expect(Number(env.AEGIS_BUDGET_DAY_MICRO)).toBeLessThanOrEqual(1_000_000);
    expect(Number(env.AEGIS_BUDGET_TASK_MICRO)).toBeLessThanOrEqual(20_000);
  });
});
