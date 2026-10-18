import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/config.js';

describe('loadConfig', () => {
  it('defaults are safe', () => {
    const config = loadConfig({});

    expect(config.modelsEnabled).toBe(false);
    expect(config.providerMode).toBe('stub');
    expect(config.budget).toEqual({ priceSnapshotId: '', googleMicro: 0, reapiMicro: 0, accountMicro: 0, dayMicro: 0, taskMicro: 0 });
    expect(config.host).toBe('127.0.0.1');
    expect(config.storageMode).toBe('sqlite-local');
  });

  it('live mode needs key model price and budget', () => {
    try {
      loadConfig({ AEGIS_PROVIDER_MODE: 'live' });
      throw new Error('Expected ConfigError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigError);
      if (error instanceof ConfigError) {
        expect(error.problems).toEqual(expect.arrayContaining([
          'AEGIS_GOOGLE_API_KEY is required when AEGIS_PROVIDER_MODE is live',
          'AEGIS_GOOGLE_MODEL is required when AEGIS_PROVIDER_MODE is live',
          'AEGIS_PRICE_SNAPSHOT_ID is required when AEGIS_PROVIDER_MODE is live',
          'AEGIS_BUDGET_ACCOUNT_MICRO must be greater than 0 in live mode',
          'AEGIS_BUDGET_DAY_MICRO must be greater than 0 in live mode',
          'AEGIS_BUDGET_TASK_MICRO must be greater than 0 in live mode',
        ]));
      }
    }
  });

  it('cloud mode', () => {
    expect(() => loadConfig({ AEGIS_ENV: 'cloud' })).toThrow(ConfigError);
    expect(() => loadConfig({ AEGIS_ENV: 'cloud', PORT: '8787' })).toThrow(ConfigError);

    const config = loadConfig({
      AEGIS_ENV: 'cloud',
      PORT: '8787',
      AEGIS_STORAGE_MODE: 'sqlite-ephemeral-demo',
    });
    expect(config.host).toBe('0.0.0.0');
    expect(config.storageMode).toBe('sqlite-ephemeral-demo');
  });

  it('non-loopback host is rejected locally', () => {
    expect(() => loadConfig({ AEGIS_HOST: '0.0.0.0' })).toThrow(ConfigError);
  });

  it('max primary attempts above max total is rejected', () => {
    expect(() => loadConfig({
      AEGIS_MAX_ATTEMPTS_TOTAL: '2',
      AEGIS_MAX_PRIMARY_ATTEMPTS: '3',
    })).toThrow(ConfigError);
  });

  it('invalid values are all reported at once', () => {
    try {
      loadConfig({
        AEGIS_ENV: 'remote',
        AEGIS_PRODUCT_ID: 'OTHER',
        AEGIS_MODELS_ENABLED: 'yes',
        PORT: '8787.5',
        AEGIS_REAPI_ALLOWED_DATA_CLASSES: 'public,secret',
      });
      throw new Error('Expected ConfigError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigError);
      if (error instanceof ConfigError) expect(error.problems.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('secrets never appear in error messages', () => {
    try {
      loadConfig({ AEGIS_GOOGLE_API_KEY: 'SECRET123', AEGIS_MODELS_ENABLED: 'yes' });
      throw new Error('Expected ConfigError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigError);
      if (error instanceof Error) expect(error.message).not.toContain('SECRET123');
    }
  });
  it('provider pacing, data classes and price caps load with safe defaults and reject bad values', () => {
    const config = loadConfig({});
    expect(config.google).toMatchObject({ allowedDataClasses: ['public', 'tenant_private'], minIntervalMs: 12000, dailyRequestCap: 200 });
    expect(config.reapi.tokenParam).toBe('max_completion_tokens');
    expect(config.price).toEqual({ inputMicroPerMTok: 0, outputMicroPerMTok: 0, capturedAt: '', source: '' });
    expect(() => loadConfig({ AEGIS_GOOGLE_ALLOWED_DATA_CLASSES: 'everything' })).toThrow('AEGIS_GOOGLE_ALLOWED_DATA_CLASSES');
    expect(() => loadConfig({ AEGIS_REAPI_TOKEN_PARAM: 'tokens' })).toThrow('AEGIS_REAPI_TOKEN_PARAM');
    expect(() => loadConfig({ AEGIS_PROVIDER_MODE: 'live', AEGIS_GOOGLE_API_KEY: 'k', AEGIS_GOOGLE_MODEL: 'm', AEGIS_PRICE_SNAPSHOT_ID: 'P', AEGIS_BUDGET_ACCOUNT_MICRO: '1', AEGIS_BUDGET_DAY_MICRO: '1', AEGIS_BUDGET_TASK_MICRO: '1' }))
      .toThrow('AEGIS_PRICE_INPUT_MICRO_PER_MTOK');
  });
});
