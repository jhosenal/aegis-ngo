#!/usr/bin/env bash
# Linux port of the Recast kit's make_presenter.ps1 (AEG-RENDER-001). One idle clip (flat green) + one narration WAV
# -> transparent presenter WebM (VP9 alpha + Opus) and a green-screen H.264 master.
# Stages, flags, thresholds and pins are the kit's, unchanged: trim -> MuseTalk lip-sync -> refine -> green key -> encode.
# usage: make_presenter.sh --idle idle.mp4 --audio line.wav --out out/presenter.webm [--runtime /opt/runtime] [--ffmpeg ffmpeg]
#        [--trim-start 1.0] [--hold 0] [--cut-at 0] [--crf 24] [--scale 0.75] [--tools DIR] [--dry-run]
# --hold pads the narration with silence so the presenter rests with a closed mouth after the last word. --cut-at ends the clip at a time.
# --dry-run prints every command and runs none of them (used by the tests; it needs no GPU, no venv and no ffmpeg).
set -euo pipefail

IDLE=''; AUDIO=''; OUT=''; RUNTIME='/opt/runtime'; FFMPEG='ffmpeg'; TRIM_START='1.0'; HOLD='0'; CUT_AT='0'; CRF='24'; SCALE='0.75'; DRY=0
TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../musetalk" && pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --idle) IDLE="$2"; shift 2;;       --audio) AUDIO="$2"; shift 2;;    --out) OUT="$2"; shift 2;;
    --runtime) RUNTIME="$2"; shift 2;; --ffmpeg) FFMPEG="$2"; shift 2;;  --trim-start) TRIM_START="$2"; shift 2;;
    --hold) HOLD="$2"; shift 2;;       --cut-at) CUT_AT="$2"; shift 2;;  --crf) CRF="$2"; shift 2;;
    --scale) SCALE="$2"; shift 2;;     --tools) TOOLS="$2"; shift 2;;    --dry-run) DRY=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
for v in IDLE AUDIO OUT; do [ -n "${!v}" ] || { echo "missing --$(echo "$v" | tr 'A-Z' 'a-z')" >&2; exit 2; }; done

PY="$RUNTIME/venv/bin/python"; SRC="$RUNTIME/src"
if [ "$DRY" = 0 ]; then
  for p in "$PY" "$SRC" "$IDLE" "$AUDIO"; do [ -e "$p" ] || { echo "missing: $p" >&2; exit 1; }; done
fi
WORK="$OUT.work"; mkdir -p "$WORK" "$(dirname "$OUT")"
T0=$(date +%s)
say() { printf '[%ss] %s\n' "$(( $(date +%s) - T0 ))" "$1"; }
run() { if [ "$DRY" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }

say 'trim the idle clip (near lossless)'
run "$FFMPEG" -v error -y -ss "$TRIM_START" -i "$IDLE" -an -c:v libx264 -crf 10 -preset slow -pix_fmt yuv420p "$WORK/idle_trim.mp4"
AUDIO_IN="$AUDIO"
if awk "BEGIN{exit !($HOLD > 0)}"; then
  say "pad the narration with $HOLD s of silence"
  AUDIO_IN="$WORK/audio_padded.wav"
  run "$FFMPEG" -v error -y -i "$AUDIO" -af "apad=pad_dur=$HOLD" -c:a pcm_s24le "$AUDIO_IN"
fi
cat > "$WORK/run.yaml" <<YAML
task_0:
 video_path: "$WORK/idle_trim.mp4"
 audio_path: "$AUDIO_IN"
YAML

say 'MuseTalk lip-sync'
export PYTORCH_CUDA_ALLOC_CONF='max_split_size_mb:128'
if [ "$DRY" = 0 ]; then cd "$SRC"; fi
run "$PY" -m scripts.inference --inference_config "$WORK/run.yaml" --result_dir "$WORK/mt" \
  --unet_model_path models/musetalkV15/unet.pth --unet_config models/musetalkV15/musetalk.json \
  --version v15 --use_float16 --batch_size 4 --fps 25 --output_vid_name lipsync.mp4
if [ "$DRY" = 0 ] && [ ! -f "$WORK/mt/v15/lipsync.mp4" ]; then
  echo 'MuseTalk produced no output (a final save_dir_full cleanup message after the file exists is harmless)' >&2; exit 1
fi
say 'refine: MuseTalk pixels only at the lips, everything else from the source frames'
run "$PY" "$TOOLS/refine_face.py" "$WORK/mt/v15/lipsync.mp4" "$WORK/idle_trim.mp4" "$WORK/refined"

say 'green key'
run "$PY" -I "$TOOLS/keygreen.py" "$WORK/refined" "$WORK/keyed" "$SCALE"
CUT=()
if awk "BEGIN{exit !($CUT_AT > 0)}"; then
  N=$(awk "BEGIN{printf \"%d\", ($CUT_AT * 24) + 0.5}")
  CUT=(-frames:v "$N" -t "$CUT_AT")
fi
say 'encode the transparent WebM'
run "$FFMPEG" -v error -y -framerate 24 -i "$WORK/keyed/%05d.png" -i "$WORK/mt/v15/lipsync.mp4" -map 0:v -map 1:a ${CUT[@]+"${CUT[@]}"} \
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf "$CRF" -auto-alt-ref 0 -c:a libopus -b:a 96k "$OUT"
say 'encode the green-screen master (also the Safari fallback source)'
run "$FFMPEG" -v error -y -framerate 24 -i "$WORK/refined/%05d.png" -i "$WORK/mt/v15/lipsync.mp4" -map 0:v -map 1:a ${CUT[@]+"${CUT[@]}"} \
  -c:v libx264 -crf 17 -pix_fmt yuv420p -c:a aac -b:a 128k "${OUT%.webm}_green_master.mp4"
say "DONE -> $OUT"
