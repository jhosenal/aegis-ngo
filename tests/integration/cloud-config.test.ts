import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from '../../src/config/config.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');
const cloudEnv = { AEGIS_ENV: 'cloud', PORT: '8080', AEGIS_STORAGE_MODE: 'sqlite-ephemeral-demo', AEGIS_DB_PATH: '/tmp/aegis.db' };

describe('TSK-020 hosted demo configuration', () => {
  it('AEG-UXD-001 a cloud environment builds the expected config', () => {
    const config = loadConfig(cloudEnv);
    expect(config).toMatchObject({
      env: 'cloud', host: '0.0.0.0', port: 8080, storageMode: 'sqlite-ephemeral-demo',
      dbPath: '/tmp/aegis.db', providerMode: 'stub', modelsEnabled: false,
    });
  });

  it('AEG-UXD-001 cloud refuses sqlite-local storage and a missing PORT', () => {
    expect(() => loadConfig({ ...cloudEnv, AEGIS_STORAGE_MODE: 'sqlite-local' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...cloudEnv, AEGIS_STORAGE_MODE: 'sqlite-local' })).toThrow('sqlite-ephemeral-demo');
    const { PORT: _omitted, ...withoutPort } = cloudEnv;
    expect(() => loadConfig(withoutPort)).toThrow('PORT is required');
  });

  it('AEG-UXD-001 the Dockerfile runs as a non-root user with safe defaults and no secrets', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toContain('AEGIS_ENV=cloud');
    expect(dockerfile).toContain('AEGIS_STORAGE_MODE=sqlite-ephemeral-demo');
    expect(dockerfile).toContain('AEGIS_PROVIDER_MODE=stub');
    expect(dockerfile).toContain('AEGIS_MODELS_ENABLED=false');
    expect(dockerfile).toMatch(/AS runtime/);
    expect(dockerfile).not.toMatch(/AEGIS_[A-Z_]*(KEY|SECRET)\s*=\s*\S/);
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
  });

  it('AEG-UXD-001 the Docker context excludes secrets, databases and dependencies', () => {
    const lines = read('.dockerignore').split(/\r?\n/);
    for (const entry of ['.env', '.env.*', 'node_modules', '/data', '*.db', '*.pem', '*.key']) expect(lines).toContain(entry);
  });

  it('the image carries the Assist content and the release record, and the context keeps only records/releases', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('COPY --chown=node:node content ./content');
    expect(dockerfile).toContain('COPY --chown=node:node records/releases ./records/releases');
    const lines = read('.dockerignore').split(/\r?\n/);
    expect(lines).toContain('records/*');
    expect(lines).toContain('!records/releases');
    expect(lines).not.toContain('records');
    expect(lines).not.toContain('content');
  });

  it('the demo service runs Assist only as a private preview (never released by configuration alone)', () => {
    const service = read('deploy/service.yaml');
    expect(service).toMatch(/AEGIS_ASSIST_ENABLED\s+value: "true"/);
    expect(service).toMatch(/AEGIS_ASSIST_PREVIEW\s+value: "true"/);
    expect(service).not.toMatch(/AEGIS_ASSIST_DRAFT_MEDICAL/);
  });

  it('AEG-UXD-001 the Cloud Run service is a single private-by-default instance with no inline secrets', () => {
    const service = read('deploy/service.yaml');
    expect(service).toContain('autoscaling.knative.dev/maxScale: "1"');
    expect(service).toContain('sqlite-ephemeral-demo');
    expect(service).toContain('path: /api/health');
    expect(service).not.toContain('allUsers');
    expect(service).not.toMatch(/value:\s*["']?(AIza|sk-)/);
  });

  it('AEG-UXD-001 the deploy README uses the honest wording and never claims durability', () => {
    const readme = read('deploy/README-deploy.md');
    expect(readme).toContain('Hosted demo, synthetic data, ephemeral storage, not an operational system.');
    expect(readme).toContain('REQ-016');
    expect(readme).toContain('pending');
    expect(readme).not.toMatch(/\bdurable storage is (provided|included)\b/i);
  });

  it('.gcloudignore does not import .gitignore (its unanchored `data/` would drop src/data) and still covers every secret pattern of .gitignore', () => {
    const gcloudignore = read('.gcloudignore');
    expect(gcloudignore).not.toMatch(/#!include:\.gitignore/);
    const lines = new Set(gcloudignore.split(/\r?\n/));
    for (const entry of ['.env', '.env.*', '*.pem', '*.key', '*.db', '*.db-wal', '*.db-shm', '*.sqlite', '*.sqlite-wal', '*.sqlite-shm', '*.log', 'node_modules']) expect(lines, entry).toContain(entry);
  });

  it('the .dockerignore keeps every source file the Dockerfile copies', () => {
    const r = spawnSync('git', ['ls-files', '-c', '-i', '--exclude-from=.dockerignore'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const dropped = r.stdout.split('\n').filter((f) => /^(src|migrations|fixtures|content|records\/releases)\//.test(f));
    expect(dropped).toEqual([]);
  });

  it('the source upload of `gcloud run deploy --source .` (simulated with .gcloudignore) contains what the build needs and nothing sensitive or heavy', () => {
    const list = (args: string[]): string[] => {
      const r = spawnSync('git', ['ls-files', ...args, '--exclude-from=.gcloudignore'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      expect(r.status).toBe(0);
      return r.stdout.split('\n').filter(Boolean);
    };
    // git applies --exclude-from only to untracked files unless -i is used, so: upload set = every file minus the files the patterns match
    const all = new Set(list(['-c', '-o']));
    for (const ignored of [...list(['-c', '-i']), ...list(['-o', '-i'])]) all.delete(ignored);
    const files = [...all].filter((f) => existsSync(f));
    for (const needed of ['Dockerfile', 'package.json', 'package-lock.json', 'tsconfig.json', 'src/api/main.ts', 'ui/index.html', 'migrations/001_init.sql', 'records/releases/assist-release.json']) expect(files, needed).toContain(needed);
    expect(files.some((f) => f.startsWith('content/assist/') && f.endsWith('.cards.json'))).toBe(true);
    // Every source file the image copies must be in the upload: an unanchored pattern such as `data` also matches `src/data/` (found by the first real deploy, 2026-10-14)
    const wanted = list(['-c']).filter((f) => /^(src|migrations|fixtures)\//.test(f) && existsSync(f));
    expect(wanted.length).toBeGreaterThan(20);
    expect(wanted.filter((f) => !all.has(f)), 'tracked source files missing from the upload').toEqual([]);
    expect(files.filter((f) => f === '.env' || f.startsWith('.env.') || f.startsWith('docs/') || f.startsWith('tests/') || f.startsWith('research/') || f.startsWith('data/') || f.startsWith('.git/') || f.startsWith('.agents/') || f.startsWith('records/baselines') || f.startsWith('records/costs') || /\.(pdf|mhtml|db|pem|key)$/.test(f))).toEqual([]);
    const bytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
    // Our own guard, not a Google limit (owner, 2026-10-16: not a blocker). 16 MiB: 8 MiB plus the 5.4 MB "Latest news" presenter clip (ui/public/media/news-latest.webm, re-encoded from 56 MB, owner request 2026-10-17); the point is still to catch an accidental heavy or sensitive file.
    expect(bytes, `upload set is ${bytes} bytes`).toBeLessThan(16 * 1024 * 1024);
  });
});
