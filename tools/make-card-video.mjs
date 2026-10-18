// Makes an MP4 of a warning card with the voice and subtitles in step (AEG-NEWS-007): the Google voice MP3 stored with the bulletin, the card SVG, and one frame per subtitle cue
// (Chrome draws the frames, so every script renders: Tamil, Chinese, Khmer ...). No presenter. The Google voice is "AI-generated"; say so wherever the video is shown.
//   node tools/make-card-video.mjs --db data/aegis.db --id BULL-... --lang ms --dir records/e2e/.../followup --out file.mp4 --ffmpeg path/to/ffmpeg.exe
// ffmpeg is NOT a project dependency: pass a binary you have installed. The drill label stays on the card.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from '@playwright/test';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const [dbPath, id, lang, dir, out, ffmpeg] = ['db', 'id', 'lang', 'dir', 'out', 'ffmpeg'].map(arg);
if (!dbPath || !id || !lang || !dir || !out || !ffmpeg) { console.error('usage: --db --id --lang --dir --out --ffmpeg'); process.exit(2); }
const db = new Database(dbPath, { readonly: true });
const row = lang === 'en' ? db.prepare('SELECT audio FROM bulletin_voice WHERE bulletin_id = ?').get(id) : db.prepare('SELECT audio FROM bulletin_voice_ml WHERE bulletin_id = ? AND language = ?').get(id, lang);
if (!row) { console.error(`no voice stored for ${id} ${lang}`); process.exit(1); }
const work = join(dir, `_video_${lang}`); mkdirSync(work, { recursive: true });
const mp3 = join(work, 'voice.mp3'); writeFileSync(mp3, row.audio);
const probe = (() => { try { execFileSync(ffmpeg, ['-i', mp3], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return String(e.stderr); } return ''; })();
const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(probe); if (!m) { console.error('could not read the audio length'); process.exit(1); }
const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
const cues = JSON.parse(readFileSync(join(dir, `${lang}.cues.json`), 'utf8')).cues;
const svg = readFileSync(join(dir, `${lang}.svg`), 'utf8');
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
const frames = [];
const frame = async (text, name) => {
  await page.setContent(`<body style="margin:0;background:#06121d"><div style="position:relative;width:1200px;height:675px">${svg}${text ? `<div style="position:absolute;left:36px;right:36px;bottom:60px;min-height:56px;display:flex;align-items:center;justify-content:center;text-align:center;padding:10px 18px;border-radius:10px;background:rgba(0,0,0,.80);color:#fff;font:26px/1.35 'Segoe UI','Nirmala UI','Microsoft YaHei','Khmer UI','Leelawadee UI',Arial,sans-serif">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>` : ''}</div></body>`);
  const file = join(work, name); await page.screenshot({ path: file }); return file;
};
let at = 0;
for (let i = 0; i < cues.length; i += 1) {
  const c = cues[i]; const start = c.start * seconds; const end = (i === cues.length - 1 ? 1 : cues[i + 1].start) * seconds;
  frames.push({ file: await frame(c.text, `f${String(i).padStart(3, '0')}.png`), dur: Math.max(0.2, end - Math.max(start, at)) }); at = end;
}
await browser.close();
const abs = (f) => resolve(f).replace(/\\/g, '/');
const list = frames.map((f) => `file '${abs(f.file)}'\nduration ${f.dur.toFixed(3)}`).join('\n') + `\nfile '${abs(frames[frames.length - 1].file)}'\n`;
writeFileSync(join(work, 'list.txt'), list);
execFileSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-i', mp3, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '25', '-vf', 'scale=1200:674', '-c:a', 'aac', '-b:a', '96k', '-shortest', out], { stdio: ['ignore', 'ignore', 'pipe'] });
console.log(`${out}: ${seconds.toFixed(1)} s, ${cues.length} subtitle frames`);
