"""Helpers for the presenter render job (AEG-RENDER-001). Pure Python 3, standard library only, so it runs in any venv and in the tests.

  split          script.txt -> beats.json  ({"b001": "text", ...}), beats of at most --max-words spoken words, in order
  verify-kokoro  check the two Kokoro model files against the hashes recorded in tts/voice-card.json (exit 1 on any mismatch)
  verify-weights check the MuseTalk weights against musetalk/weights-card.json: size and sha256 (exit 1 on any mismatch)
  concat-list    write an ffmpeg concat list for the finished segment files, in beat order
  summarise      timings.jsonl (+ optional gpu_mem.csv) -> timings.json: seconds per step, total, peak GPU memory
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def words(text: str) -> list[str]:
    return text.split()


def sentences(paragraph: str) -> list[str]:
    return [s.strip() for s in re.split(r'(?<=[.!?])\s+', paragraph.strip()) if s.strip()]


def clauses(sentence: str, max_words: int) -> list[str]:
    """A sentence longer than max_words is cut at commas, semicolons and colons first, then by words, so no beat exceeds the limit."""
    if len(words(sentence)) <= max_words:
        return [sentence]
    parts = [p.strip() for p in re.split(r'(?<=[,;:])\s+', sentence) if p.strip()]
    out: list[str] = []
    for part in parts:
        w = words(part)
        if len(w) <= max_words:
            out.append(part)
        else:
            out.extend(' '.join(w[i:i + max_words]) for i in range(0, len(w), max_words))
    return out


def split_beats(text: str, max_words: int = 25) -> list[str]:
    pieces: list[str] = []
    for paragraph in re.split(r'\n\s*\n|\n', text):
        for sentence in sentences(paragraph):
            pieces.extend(clauses(sentence, max_words))
    beats: list[str] = []
    current = ''
    for piece in pieces:
        candidate = f'{current} {piece}'.strip()
        if current and len(words(candidate)) > max_words:
            beats.append(current)
            current = piece
        else:
            current = candidate
    if current:
        beats.append(current)
    return beats


def cmd_split(a: argparse.Namespace) -> int:
    text = Path(a.script).read_text(encoding='utf-8-sig')   # UTF-8, a BOM is tolerated
    beats = split_beats(text, a.max_words)
    if a.max_beats and a.max_beats > 0:
        beats = beats[: a.max_beats]
    if not beats:
        print('error: the script has no text', file=sys.stderr)
        return 1
    Path(a.out).write_text(json.dumps({f'b{i + 1:03d}': t for i, t in enumerate(beats)}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(beats)} beats, {sum(len(words(b)) for b in beats)} words')
    return 0


def cmd_verify_kokoro(a: argparse.Namespace) -> int:
    card = json.loads(Path(a.card).read_text(encoding='utf-8'))
    d = Path(a.dir)
    bad = 0
    for name, key in (('kokoro-v1.0.onnx', 'modelSha256'), ('voices-v1.0.bin', 'voicePackSha256')):
        p = d / name
        if not p.exists():
            print(f'MISSING {name}')
            bad += 1
            continue
        got = sha256_of(p)
        ok = got == card[key]
        print(f'{"ok" if ok else "MISMATCH"} {name} {got[:12]} expected {card[key][:12]}')
        bad += 0 if ok else 1
    return 1 if bad else 0


def cmd_verify_weights(a: argparse.Namespace) -> int:
    card = json.loads(Path(a.card).read_text(encoding='utf-8'))
    models = Path(a.models)
    bad = 0
    for entry in card:
        p = models / entry['file'].replace('\\', '/')   # the card was written on Windows
        if not p.exists():
            print(f'MISSING {entry["file"]}')
            bad += 1
            continue
        size_ok = p.stat().st_size == entry['bytes']
        got = sha256_of(p) if size_ok else ''
        ok = size_ok and got == entry['sha256']
        print(f'{"ok" if ok else "MISMATCH"} {entry["file"]} ({entry["source"]})')
        bad += 0 if ok else 1
    print(f'{len(card) - bad} of {len(card)} weight files match')
    return 1 if bad else 0


def cmd_concat_list(a: argparse.Namespace) -> int:
    beats = json.loads(Path(a.beats).read_text(encoding='utf-8'))
    lines = []
    for beat in beats:
        p = Path(a.dir) / f'{beat}{a.suffix}'
        if not p.exists():
            print(f'error: missing segment {p}', file=sys.stderr)
            return 1
        lines.append(f"file '{p.as_posix()}'")
    Path(a.out).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return 0


def cmd_summarise(a: argparse.Namespace) -> int:
    events = [json.loads(line) for line in Path(a.events).read_text(encoding='utf-8').splitlines() if line.strip()]
    steps: dict[str, float] = {}
    for e in events:
        steps[e['step']] = round(steps.get(e['step'], 0.0) + (e['end'] - e['start']), 1)
    peak = None
    if a.gpu and Path(a.gpu).exists():
        vals = [int(v) for v in Path(a.gpu).read_text().split() if v.strip().isdigit()]
        peak = max(vals) if vals else None
    out = {
        'jobId': a.job_id,
        'totalSeconds': round(max(e['end'] for e in events) - min(e['start'] for e in events), 1) if events else 0,
        'secondsPerStep': steps,
        'perBeat': [e for e in events if e.get('beat')],
        'peakGpuMemoryMiB': peak,
        'audioSeconds': a.audio_seconds,
        'note': 'instance seconds are what Cloud Run bills; add container start and image pull, which this file cannot see',
    }
    Path(a.out).write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({k: out[k] for k in ('totalSeconds', 'secondsPerStep', 'peakGpuMemoryMiB')}))
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('split'); s.add_argument('--script', required=True); s.add_argument('--out', required=True)
    s.add_argument('--max-words', type=int, default=25); s.add_argument('--max-beats', type=int, default=0); s.set_defaults(fn=cmd_split)
    k = sub.add_parser('verify-kokoro'); k.add_argument('--card', required=True); k.add_argument('--dir', required=True); k.set_defaults(fn=cmd_verify_kokoro)
    w = sub.add_parser('verify-weights'); w.add_argument('--card', required=True); w.add_argument('--models', required=True); w.set_defaults(fn=cmd_verify_weights)
    c = sub.add_parser('concat-list'); c.add_argument('--beats', required=True); c.add_argument('--dir', required=True); c.add_argument('--suffix', required=True); c.add_argument('--out', required=True); c.set_defaults(fn=cmd_concat_list)
    m = sub.add_parser('summarise'); m.add_argument('--events', required=True); m.add_argument('--gpu'); m.add_argument('--out', required=True)
    m.add_argument('--job-id', default=''); m.add_argument('--audio-seconds', type=float, default=0.0); m.set_defaults(fn=cmd_summarise)
    a = p.parse_args()
    return a.fn(a)


if __name__ == '__main__':
    sys.exit(main())
