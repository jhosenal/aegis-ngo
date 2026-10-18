import { describe, expect, it } from 'vitest';
import { checkEnv, exampleLeaks, parseEnv } from '../../tools/check-env.js';

const good = { AEGIS_GOOGLE_API_KEY: 'g'.repeat(40), AEGIS_GOOGLE_MODEL: 'gemini-3.8-flash', AEGIS_REAPI_API_KEY: 'r'.repeat(30), AEGIS_REAPI_BASE_URL: 'https://reapi.ai/api/v1' };

describe('env check', () => {
  it('parses names and values and skips comments and blanks', () => {
    expect(parseEnv('# note\n\nA=1\r\nB = two words \nNOEQUALS\n')).toEqual({ A: '1', B: 'two words' });
  });

  it('flags a key value or a pasted key in the example file, but not empty placeholders', () => {
    expect(exampleLeaks('AEGIS_GOOGLE_API_KEY=\nAEGIS_REAPI_API_KEY=\nAEGIS_ENV=local\nAEGIS_REAPI_TOKEN_PARAM=max_completion_tokens\n')).toEqual([]);
    expect(exampleLeaks('AEGIS_GOOGLE_API_KEY=abc\n')).toEqual(['AEGIS_GOOGLE_API_KEY has a value in .env.example']);
    expect(exampleLeaks('# Gemini API Key\nAQ.FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE\n')).toEqual(['line 2 of .env.example looks like a pasted key']);
  });

  it('passes a good setup and never prints a secret value', () => {
    const report = checkEnv(good, 'AEGIS_ENV=local\n', true);
    expect(report.ok).toBe(true);
    const text = report.lines.join('\n');
    expect(text).toContain('Google key:   set (40 characters)');
    expect(text).not.toContain('ggggg');
    expect(text).not.toContain('rrrrr');
  });

  it('fails on a leaked example, a tracked .env, or a reAPI URL that is not reapi.ai', () => {
    expect(checkEnv(good, 'AEGIS_GOOGLE_API_KEY=x\n', true).ok).toBe(false);
    expect(checkEnv(good, '', false).ok).toBe(false);
    expect(checkEnv({ ...good, AEGIS_REAPI_BASE_URL: 'https://evil.example.org/v1' }, '', true).ok).toBe(false);
  });

  it('lists extra key lines by name and length, warns about one marked old, and never prints a value', () => {
    const report = checkEnv({ ...good, AEGIS_GOOGLE_API_KEY_2: 'x'.repeat(53), AEGIS_GOOGLE_API_KEY_OLD_FREE: 'y'.repeat(53) }, '', true);
    const text = report.lines.join('\n');
    expect(report.ok).toBe(true);
    expect(text).toContain('Extra key:    AEGIS_GOOGLE_API_KEY_2 set (53 characters)  (not read by the app)');
    expect(text).toContain('AEGIS_GOOGLE_API_KEY_OLD_FREE set (53 characters)  WARN');
    expect(text).not.toContain('xxxxx');
    expect(text).not.toContain('yyyyy');
  });

  it('reports missing keys without failing, and warns about a legacy Gemini 2.5 model', () => {
    const report = checkEnv({ AEGIS_GOOGLE_MODEL: 'gemini-2.5-flash' }, '', true);
    expect(report.ok).toBe(true);
    const text = report.lines.join('\n');
    expect(text).toContain('reAPI key:    not set');
    expect(text).toContain('legacy');
  });
});
