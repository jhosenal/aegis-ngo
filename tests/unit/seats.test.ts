import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';
import { bindingForRole } from '../../src/roles/manager.js';
import { SEATS } from '../../src/roles/seats.js';

const base = { AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_GOOGLE_MODEL: 'gemini-3.8-flash' };
const withReapi = { ...base, AEGIS_REAPI_API_KEY: 'k', AEGIS_REAPI_BASE_URL: 'https://reapi.ai/api/v1' };

describe('role seats', () => {
  it('every runtime role has a seat with its own limits and job', () => {
    expect(Object.keys(SEATS).sort()).toEqual(['advisor', 'coordinator', 'helper', 'manager', 'reviewer', 'specialist']);
    expect(SEATS.advisor.maxInputChars).toBeGreaterThan(SEATS.manager.maxInputChars);
    for (const seat of Object.values(SEATS)) expect(seat.job.length).toBeGreaterThan(20);
  });

  it('bindings use the Google model as primary and a per-seat reAPI backup', () => {
    const config = loadConfig(withReapi);
    expect(bindingForRole('manager', config)).toMatchObject({ primaryModel: 'gemini-3.8-flash', backupModel: 'gpt-6-luna', maxOutputTokens: 512 });
    expect(bindingForRole('specialist', config)).toMatchObject({ backupModel: 'gpt-6-luna', maxOutputTokens: 1024 });
    expect(bindingForRole('reviewer', config).backupModel).toBe('gpt-6-sol');
    expect(bindingForRole('advisor', config).backupModel).toBe('claude-opus-5-5');
  });

  it('with reAPI as the primary provider, luna leads and Google is the backup', () => {
    const config = loadConfig({ ...withReapi, AEGIS_PRIMARY_PROVIDER: 'reapi', AEGIS_GOOGLE_API_KEY: 'g' });
    expect(config.primaryProvider).toBe('reapi');
    for (const role of ['manager', 'coordinator', 'specialist'] as const) {
      expect(bindingForRole(role, config)).toMatchObject({ primaryModel: 'gpt-6-luna', backupModel: 'gemini-3.8-flash' });
    }
    expect(bindingForRole('reviewer', config)).toMatchObject({ primaryModel: 'gpt-6-sol', backupModel: 'gemini-3.8-flash' });
    expect(bindingForRole('advisor', config).primaryModel).toBe('claude-opus-5-5');
  });

  it('with reAPI primary and no Google settings there is no backup, and overrides apply by position', () => {
    const solo = loadConfig({ AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_PRIMARY_PROVIDER: 'reapi', AEGIS_REAPI_API_KEY: 'k', AEGIS_REAPI_BASE_URL: 'https://reapi.ai/api/v1' });
    expect(bindingForRole('manager', solo)).toMatchObject({ primaryModel: 'gpt-6-luna', backupModel: null });
    const custom = loadConfig({ ...withReapi, AEGIS_PRIMARY_PROVIDER: 'reapi', AEGIS_ROLE_MANAGER_PRIMARY_MODEL: 'gpt-6-sol', AEGIS_ROLE_MANAGER_BACKUP_MODEL: 'gemini-3.5-flash-lite' });
    expect(bindingForRole('manager', custom)).toMatchObject({ primaryModel: 'gpt-6-sol', backupModel: 'gemini-3.5-flash-lite' });
  });

  it('live mode with reAPI primary needs the reAPI key and URL, not the Google key', () => {
    const live = { AEGIS_ENV: 'test', AEGIS_DB_PATH: ':memory:', AEGIS_PROVIDER_MODE: 'live', AEGIS_PRIMARY_PROVIDER: 'reapi', AEGIS_PRICE_SNAPSHOT_ID: 'P', AEGIS_PRICE_INPUT_MICRO_PER_MTOK: '1', AEGIS_PRICE_OUTPUT_MICRO_PER_MTOK: '1', AEGIS_PRICE_CAPTURED_AT: '2026-10-13T00:00:00Z', AEGIS_BUDGET_ACCOUNT_MICRO: '1', AEGIS_BUDGET_DAY_MICRO: '1', AEGIS_BUDGET_TASK_MICRO: '1' };
    expect(() => loadConfig(live)).toThrow('AEGIS_REAPI_API_KEY and AEGIS_REAPI_BASE_URL are required');
    expect(() => loadConfig({ ...live, AEGIS_REAPI_API_KEY: 'k', AEGIS_REAPI_BASE_URL: 'https://reapi.ai/api/v1' })).not.toThrow();
    expect(() => loadConfig({ ...live, AEGIS_PRIMARY_PROVIDER: 'maybe' })).toThrow('AEGIS_PRIMARY_PROVIDER');
  });

  it('there is no backup model unless reAPI is configured', () => {
    expect(bindingForRole('manager', loadConfig(base)).backupModel).toBeNull();
  });

  it('role overrides beat AEGIS_REAPI_MODEL, which beats the seat default', () => {
    const config = loadConfig({
      ...withReapi, AEGIS_REAPI_MODEL: 'kimi-k3',
      AEGIS_ROLE_SPECIALIST_BACKUP_MODEL: 'gpt-6-sol', AEGIS_ROLE_ADVISOR_PRIMARY_MODEL: 'gemini-3.1-pro-preview',
    });
    expect(bindingForRole('manager', config).backupModel).toBe('kimi-k3');
    expect(bindingForRole('specialist', config).backupModel).toBe('gpt-6-sol');
    expect(bindingForRole('advisor', config)).toMatchObject({ primaryModel: 'gemini-3.1-pro-preview', backupModel: 'kimi-k3' });
  });
});
