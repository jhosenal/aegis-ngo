"""Downloads the MuseTalk v1.5 inference weights from their official sources and writes weights-card.json (sha256 and sizes).
Skips v1.0 weights and SyncNet (training / legacy only). usage: python get_weights.py --runtime <Runtime>   (the folder from install_musetalk.ps1)"""
import argparse, hashlib, json, time
from pathlib import Path
from huggingface_hub import hf_hub_download

ap = argparse.ArgumentParser(); ap.add_argument('--runtime', required=True); a = ap.parse_args()
R = Path(a.runtime); M = R / 'src' / 'models'
for d in ('musetalkV15', 'dwpose', 'face-parse-bisent', 'sd-vae', 'whisper'):
    (M / d).mkdir(parents=True, exist_ok=True)
jobs = [
    ('TMElyralab/MuseTalk', 'musetalkV15/musetalk.json', M),
    ('TMElyralab/MuseTalk', 'musetalkV15/unet.pth', M),
    ('stabilityai/sd-vae-ft-mse', 'config.json', M / 'sd-vae'),
    ('stabilityai/sd-vae-ft-mse', 'diffusion_pytorch_model.bin', M / 'sd-vae'),
    ('openai/whisper-tiny', 'config.json', M / 'whisper'),
    ('openai/whisper-tiny', 'pytorch_model.bin', M / 'whisper'),
    ('openai/whisper-tiny', 'preprocessor_config.json', M / 'whisper'),
    ('yzd-v/DWPose', 'dw-ll_ucoco_384.pth', M / 'dwpose'),
]
files = []
for repo, name, dest in jobs:
    t = time.time(); p = hf_hub_download(repo_id=repo, filename=name, local_dir=str(dest))
    print('ok', repo, name, round(time.time() - t, 1), 's', flush=True); files.append((repo, Path(p)))
fp = M / 'face-parse-bisent' / '79999_iter.pth'          # Google Drive id taken from the MuseTalk repo's own download script
if not fp.exists():
    import gdown; gdown.download(id='154JgKpzCPW82qINcVieuPH3fZ2e0P812', output=str(fp), quiet=True)
files.append(('gdrive:154JgKpzCPW82qINcVieuPH3fZ2e0P812', fp))
rn = M / 'face-parse-bisent' / 'resnet18-5c106cde.pth'
if not rn.exists():
    import urllib.request; urllib.request.urlretrieve('https://download.pytorch.org/models/resnet18-5c106cde.pth', rn)
files.append(('download.pytorch.org', rn))

def digest(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for c in iter(lambda: f.read(1 << 20), b''):
            h.update(c)
    return h.hexdigest()

card = [{'source': s, 'file': str(p.relative_to(M)), 'bytes': p.stat().st_size, 'sha256': digest(p)} for s, p in files]
(R / 'weights-card.json').write_text(json.dumps(card, indent=2), encoding='utf-8')
print('weights-card.json written;', len(card), 'files. Compare it with kit/musetalk/weights-card.json: a different hash means a different upstream file, re-check licence and quality.')
