# Aegis presenter render job (AEG-RENDER-001): script text in, transparent presenter WebM out. Built for a Cloud Run JOB with ONE NVIDIA L4
# (asia-southeast1, 4 vCPU, 16 GiB, no zonal redundancy). NOT BUILT AND NOT RUN: there is no Docker on the author's machine. See README.md for
# what is untested. Every pin below is the Recast kit's (kit/musetalk/install_musetalk.ps1, kit/tts/requirements.txt); do not change one without
# re-testing, the kit records that each workaround was paid for.
#
# Build context = this folder:   gcloud builds submit render/presenter --tag <region>-docker.pkg.dev/<project>/<repo>/aegis-render:<tag>
# The devel image (not runtime) is used so that `mim install mmcv==2.0.1` can compile if no prebuilt wheel matches; that fallback is slow.
FROM nvidia/cuda:11.8.0-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ffmpeg curl ca-certificates python3 python3-pip python3-dev build-essential libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
RUN pip3 install uv

# ---- MuseTalk 1.5 at the pinned commit, with the kit's CPU-load patch (an fp32 UNet does not fit a small GPU before the fp16 conversion) ----
RUN git clone https://github.com/TMElyralab/MuseTalk.git /opt/runtime/src \
 && git -C /opt/runtime/src checkout --quiet 0a89dec45a0192b824e3cf4daf96c239440c5ed8
COPY musetalk/unet_cpu_load.patch /tmp/unet_cpu_load.patch
RUN tr -d '\r' < /tmp/unet_cpu_load.patch > /tmp/unet.patch \
 && git -C /opt/runtime/src apply --check /tmp/unet.patch \
 && git -C /opt/runtime/src apply /tmp/unet.patch

# ---- Python 3.10 venv, torch 2.0.1 + CUDA 11.8 (runs on the newer driver Cloud Run mounts: 580, CUDA 13.0) ----
RUN uv venv --python 3.10 /opt/runtime/venv
RUN uv pip install --python /opt/runtime/venv/bin/python torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 --index-url https://download.pytorch.org/whl/cu118
# requirements (tensorflow, tensorboard and gradio are training / demo only and are skipped)
RUN uv pip install --python /opt/runtime/venv/bin/python diffusers==0.30.2 accelerate==0.28.0 numpy==1.23.5 opencv-python==4.9.0.80 soundfile==0.12.1 \
    transformers==4.39.2 huggingface_hub==0.30.2 librosa==0.11.0 einops==0.8.1 gdown requests "imageio[ffmpeg]" omegaconf ffmpeg-python moviepy
# mm packages (setuptools must stay below 81: newer ones drop pkg_resources and openmim fails)
RUN uv pip install --python /opt/runtime/venv/bin/python -U openmim "setuptools<81" wheel \
 && /opt/runtime/venv/bin/python -m mim install mmengine \
 && /opt/runtime/venv/bin/python -m mim install "mmcv==2.0.1" \
 && /opt/runtime/venv/bin/python -m mim install "mmdet==3.1.0"
# mmpose without mim: chumpy will not build under build isolation
RUN uv pip install --python /opt/runtime/venv/bin/python "numpy==1.23.5" \
 && uv pip install --python /opt/runtime/venv/bin/python --no-build-isolation chumpy \
 && uv pip install --python /opt/runtime/venv/bin/python json_tricks munkres scipy xtcocotools tomli \
 && uv pip install --python /opt/runtime/venv/bin/python --no-deps mmpose==1.1.0 \
 && uv pip install --python /opt/runtime/venv/bin/python "numpy==1.23.5"
RUN /opt/runtime/venv/bin/python -c "import numpy,cv2,mmcv,mmengine,mmdet,mmpose,torch;print('numpy',numpy.__version__,'cv2',cv2.__version__,'mmcv',mmcv.__version__,'mmdet',mmdet.__version__,'mmpose',mmpose.__version__,'torch',torch.__version__)"

# ---- kit scripts, then the weights, verified against the hashes of the original run (the build FAILS on any difference) ----
COPY musetalk/ /opt/presenter/musetalk/
COPY scripts/ /opt/presenter/scripts/
COPY tts/ /opt/presenter/tts/
RUN /opt/runtime/venv/bin/python /opt/presenter/musetalk/get_weights.py --runtime /opt/runtime \
 && python3 /opt/presenter/scripts/pipeline_tools.py verify-weights --card /opt/presenter/musetalk/weights-card.json --models /opt/runtime/src/models

# ---- Kokoro narration: Python 3.12 venv with the kit's pins; the model files are checked against voice-card.json, never trusted by URL ----
RUN uv venv --python 3.12 /opt/kokoro-venv \
 && uv pip install --python /opt/kokoro-venv/bin/python -r /opt/presenter/tts/requirements.txt
RUN mkdir -p /opt/models/kokoro \
 && curl -fL -o /opt/models/kokoro/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \
 && curl -fL -o /opt/models/kokoro/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin \
 && python3 /opt/presenter/scripts/pipeline_tools.py verify-kokoro --card /opt/presenter/tts/voice-card.json --dir /opt/models/kokoro

COPY assets/ /opt/presenter/assets/
RUN chmod +x /opt/presenter/scripts/*.sh
ENV PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:128
ENTRYPOINT ["/opt/presenter/scripts/entrypoint.sh"]
