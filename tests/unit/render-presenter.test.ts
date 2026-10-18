import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// AEG-RENDER-001: the Linux/Docker port of the Recast presenter pipeline. These tests run the scripts in DRY-RUN mode (no GPU, no ffmpeg, no venv)
// and check the pins by reading the files: they prove the flow and the pins, NOT that the image builds or that a render works.
const dir = fileURLToPath(new URL('../../render/presenter/', import.meta.url)).replace(/\\/g, '/');
const has = (cmd: string, args: string[]): boolean => spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;
const hasBash = has('bash', ['-c', 'true']);
const python = has('python3', ['--version']) ? 'python3' : has('python', ['--version']) ? 'python' : '';
const read = (rel: string): string => readFileSync(dir + rel, 'utf8');
const sh = (script: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync('bash', [dir + script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

describe('presenter render job: pins are the kit pins', () => {
  const docker = read('Dockerfile');
  it('pins the MuseTalk commit, torch and CUDA wheels, Python versions and the mm packages', () => {
    for (const pin of ['0a89dec45a0192b824e3cf4daf96c239440c5ed8', 'torch==2.0.1', 'torchvision==0.15.2', 'torchaudio==2.0.2', 'whl/cu118', '--python 3.10', '--python 3.12',
      'mmcv==2.0.1', 'mmdet==3.1.0', 'mmpose==1.1.0', 'numpy==1.23.5', 'setuptools<81', 'diffusers==0.30.2', 'transformers==4.39.2', 'nvidia/cuda:11.8.0']) {
      expect(docker, pin).toContain(pin);
    }
  });
  it('applies the CPU-load patch and verifies weights and Kokoro files by hash, failing the build otherwise', () => {
    expect(docker).toContain('git -C /opt/runtime/src apply');
    expect(docker).toContain('verify-weights');
    expect(docker).toContain('verify-kokoro');
    expect(read('musetalk/unet_cpu_load.patch')).toContain("torch.load(model_path, map_location='cpu')");
    expect(read('tts/requirements.txt')).toMatch(/kokoro-onnx==0\.6\.1[\s\S]*onnxruntime==1\.31\.0/);
  });
  it('keeps the kit lip-sync flags unchanged in the bash port', () => {
    const port = read('scripts/make_presenter.sh');
    for (const flag of ['--version v15', '--use_float16', '--batch_size 4', '--fps 25', "max_split_size_mb:128", 'libvpx-vp9 -pix_fmt yuva420p', '-crf "$CRF"', 'D0']) {
      if (flag === 'D0') { expect(read('musetalk/keygreen.py')).toContain('D0, D1 = 38.0, 84.0'); continue; }
      expect(port, flag).toContain(flag);
    }
  });
});

describe.skipIf(!hasBash || !python)('presenter render job: scripts (dry run)', () => {
  it('splits a script into ordered beats of at most 25 words, longest sentences cut at commas', () => {
    const work = mkdtempSync(join(tmpdir(), 'render-'));
    const script = join(work, 'script.txt');
    const long = 'This sentence is deliberately very long, because it keeps going with several clauses, and each clause adds a few more words, so that the splitter has to cut it at the commas rather than leave one huge beat for the lip-sync.';
    writeFileSync(script, `﻿Welcome to Aegis. It is a pilot.\n\n${long}\nShort end.`, 'utf8');
    const out = join(work, 'beats.json');
    const r = spawnSync(python, [dir + 'scripts/pipeline_tools.py', 'split', '--script', script, '--out', out, '--max-words', '25'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const beats = JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>;
    expect(Object.keys(beats)).toEqual(Object.keys(beats).map((_, i) => `b${String(i + 1).padStart(3, '0')}`));
    for (const text of Object.values(beats)) expect(text.split(/\s+/).length).toBeLessThanOrEqual(25);
    expect(Object.values(beats).join(' ').replace(/\s+/g, ' ')).toBe(`Welcome to Aegis. It is a pilot. ${long} Short end.`.replace(/\s+/g, ' '));
    const short = spawnSync(python, [dir + 'scripts/pipeline_tools.py', 'split', '--script', script, '--out', out, '--max-beats', '1'], { encoding: 'utf8' });
    expect(Object.keys(JSON.parse(readFileSync(out, 'utf8')))).toEqual(['b001']);
    expect(short.stdout).toContain('1 beats');
  });

  it('make_presenter.sh --dry-run prints the five stages in order with the kit flags', () => {
    const r = sh('scripts/make_presenter.sh', ['--idle', 'idle.mp4', '--audio', 'a.wav', '--out', join(mkdtempSync(join(tmpdir(), 'mp-')), 'p.webm').replace(/\\/g, '/'), '--hold', '2.6', '--cut-at', '10.7', '--dry-run']);
    expect(r.status).toBe(0);
    const text = r.stdout;
    const order = ['trim the idle clip', 'pad the narration with 2.6 s', 'MuseTalk lip-sync', 'refine:', 'green key', 'encode the transparent WebM', 'encode the green-screen master', 'DONE'];
    let at = -1;
    for (const s of order) { const i = text.indexOf(s, at + 1); expect(i, s).toBeGreaterThan(at); at = i; }
    expect(text).toContain('-m scripts.inference');
    expect(text).toContain('--use_float16 --batch_size 4 --fps 25');
    expect(text).toContain('-frames:v 257 -t 10.7');   // 10.7 s x 24 fps, rounded as the kit does
    expect(text).toMatch(/keygreen\.py \S+ \S+ 0\.75/);
    expect(text).toMatch(/\[\d+s\] trim the idle clip/);   // timestamped
  });

  it('make_presenter.sh refuses a missing argument', () => {
    expect(sh('scripts/make_presenter.sh', ['--idle', 'x.mp4']).status).toBe(2);
  });

  it('entrypoint dry run with MAX_BEATS=2 plans Kokoro, two presenter beats, the join and the upload, each step timed', () => {
    const work = mkdtempSync(join(tmpdir(), 'ep-')).replace(/\\/g, '/');
    writeFileSync(`${work}/script.txt`, 'First line of the test. Second line of the test. Third line of the test. Fourth line that is not rendered.', 'utf8');
    const r = sh('scripts/entrypoint.sh', [], { DRY_RUN: '1', SCRIPT_FILE: `${work}/script.txt`, OUT_ROOT: `${work}/out`, JOB_ID: 'job-test', WORK_DIR: `${work}/w`, MAX_WORDS: '6', MAX_BEATS: '2', PYTHON: python });
    expect(r.status, r.stderr).toBe(0);
    const text = r.stdout;
    expect(text).toMatch(/\[\+\d+s\] job=job-test dry_run=1/);
    for (const s of ['step=split begin', 'step=kokoro begin', 'step=presenter beat=b001 begin', 'step=presenter beat=b002 begin', 'step=join begin']) expect(text, s).toContain(s);
    expect(text).not.toContain('beat=b003');
    expect(text).toContain('kokoro_tts.py');
    expect(text).toContain('af_heart 0.95');
    expect(text).toContain(`cp ${work}/w/presenter.webm ${work}/out/job-test/presenter.webm`);
    expect(text).toMatch(/DONE job=job-test/);
    const events = readFileSync(`${work}/w/timings.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { step: string; beat: string });
    expect(events.map((e) => `${e.step}:${e.beat}`)).toEqual(['split:', 'kokoro:', 'presenter:b001', 'presenter:b002', 'join:']);
    expect(JSON.parse(readFileSync(`${work}/w/timings.json`, 'utf8')).secondsPerStep).toHaveProperty('presenter');
  });
});

describe.skipIf(!python)('presenter render job: hash checks', () => {
  it('verify-kokoro and verify-weights fail on a wrong file and pass on the right one', () => {
    const work = mkdtempSync(join(tmpdir(), 'hash-'));
    const card = join(work, 'voice-card.json');
    const model = Buffer.from('model'); const voices = Buffer.from('voices');
    const sha = (b: Buffer): string => spawnSync(python, ['-c', 'import hashlib,sys;print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'], { input: b, encoding: 'utf8' }).stdout.trim();
    writeFileSync(card, JSON.stringify({ modelSha256: sha(model), voicePackSha256: sha(voices) }));
    writeFileSync(join(work, 'kokoro-v1.0.onnx'), model);
    writeFileSync(join(work, 'voices-v1.0.bin'), Buffer.from('tampered'));
    const tool = dir + 'scripts/pipeline_tools.py';
    expect(spawnSync(python, [tool, 'verify-kokoro', '--card', card, '--dir', work], { encoding: 'utf8' }).status).toBe(1);
    writeFileSync(join(work, 'voices-v1.0.bin'), voices);
    expect(spawnSync(python, [tool, 'verify-kokoro', '--card', card, '--dir', work], { encoding: 'utf8' }).status).toBe(0);
    const wcard = join(work, 'weights-card.json');
    writeFileSync(join(work, 'a.bin'), 'abc');
    writeFileSync(wcard, JSON.stringify([{ source: 't', file: 'sub\\a.bin', bytes: 3, sha256: sha(Buffer.from('abc')) }]));
    spawnSync('python', ['-c', `import os;os.makedirs(r'${work}/sub',exist_ok=True);os.replace(r'${work}/a.bin', r'${work}/sub/a.bin')`]);
    expect(spawnSync(python, [tool, 'verify-weights', '--card', wcard, '--models', work], { encoding: 'utf8' }).status).toBe(0);
    writeFileSync(wcard, JSON.stringify([{ source: 't', file: 'sub\\a.bin', bytes: 3, sha256: '0'.repeat(64) }]));
    expect(spawnSync(python, [tool, 'verify-weights', '--card', wcard, '--models', work], { encoding: 'utf8' }).status).toBe(1);
  });

  it('the container scripts have LF line endings (a CR in a shebang line makes a container exit with 127)', () => {
    for (const f of ['entrypoint.sh', 'make_presenter.sh', 'pipeline_tools.py']) {
      const text = readFileSync(new URL(`../../render/presenter/scripts/${f}`, import.meta.url), 'utf8');
      expect(text.includes('\r'), f).toBe(false);
    }
    expect(readFileSync(new URL('../../render/presenter/Dockerfile', import.meta.url), 'utf8').includes('\r')).toBe(false);
  });
});
