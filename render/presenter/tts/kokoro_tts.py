"""Local stock Kokoro narration for the Aegis practice film (same engine and licences as the Aiden opening: Kokoro-82M v1.0 Apache-2.0, kokoro-onnx MIT).
No Microsoft or Edge speech, no voice cloning. One WAV per beat; writes voice-card.json with hashes and the real sample-clock durations.
usage: python kokoro_tts.py <narration.json> <model_dir> <out_dir> <voice> <speed>"""
import hashlib, importlib.metadata, json, sys, time
from pathlib import Path
import numpy as np, soundfile as sf, espeakng_loader
from kokoro_onnx import Kokoro
from kokoro_onnx.config import EspeakConfig

def digest(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for c in iter(lambda: f.read(1 << 20), b''):
            h.update(c)
    return h.hexdigest()

def main():
    script, models, out = map(Path, sys.argv[1:4]); voice, speed = sys.argv[4], float(sys.argv[5])
    out.mkdir(parents=True, exist_ok=True)
    texts = json.loads(script.read_text(encoding='utf-8'))
    k = Kokoro(str(models / 'kokoro-v1.0.onnx'), str(models / 'voices-v1.0.bin'), espeak_config=EspeakConfig(lib_path=espeakng_loader.get_library_path(), data_path=espeakng_loader.get_data_path()))
    t0 = time.perf_counter(); cues = {}
    for beat, text in texts.items():
        s, sr = k.create(text, voice=voice, speed=speed, lang='en-us')
        if sr != 24000 or not np.all(np.isfinite(s)) or np.max(np.abs(s)) < .01:
            raise ValueError('invalid speech for ' + beat)
        s = s * (.8 / float(np.max(np.abs(s))))
        sf.write(out / f'{beat}.wav', s, sr, subtype='PCM_24'); cues[beat] = round(len(s) / sr, 3); print(beat, cues[beat], 's', flush=True)
    card = {'provider': 'local Kokoro ONNX', 'model': 'hexgrad/Kokoro-82M v1.0', 'modelLicense': 'Apache-2.0', 'runtimeLicense': 'MIT', 'voice': voice, 'speed': speed, 'stockVoice': True, 'voiceCloned': False,
            'modelSha256': digest(models / 'kokoro-v1.0.onnx'), 'voicePackSha256': digest(models / 'voices-v1.0.bin'), 'scriptSha256': digest(script), 'durations': cues, 'generationSeconds': time.perf_counter() - t0,
            'versions': {n: importlib.metadata.version(n) for n in ['kokoro-onnx', 'onnxruntime', 'espeakng-loader']}, 'licenseSources': ['https://huggingface.co/hexgrad/Kokoro-82M', 'https://github.com/thewh1teagle/kokoro-onnx'], 'label': 'Synthetic voice (Kokoro, stock voice, no cloning)'}
    (out / 'voice-card.json').write_text(json.dumps(card, indent=2) + '\n', encoding='utf-8')

main()
