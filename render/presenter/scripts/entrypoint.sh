#!/usr/bin/env bash
# Cloud Run job entry point for the presenter render (AEG-RENDER-001).
# Input : a UTF-8 text file (SCRIPT_FILE). Output: a transparent presenter WebM (+ green-screen master, narration, voice card, timings, log)
#         copied to OUT_ROOT/JOB_ID/, where OUT_ROOT is the mounted Cloud Storage bucket path.
# Cloud Run's local disk is in memory and counts against the container memory, so the video is rendered BEAT BY BEAT (at most MAX_WORDS spoken
# words each, the kit's own advice), the frame folders of a beat are deleted as soon as its segments are encoded, and the segments are joined at the end.
# Every step is timed: a line "[+123s] step ..." on stdout, one JSON line per step in timings.jsonl, and a timings.json summary at the end.
#
# Environment (all optional except that SCRIPT_FILE must exist):
#   SCRIPT_FILE=/mnt/bucket/in/script.txt   OUT_ROOT=/mnt/bucket/out   JOB_ID=<execution name or a timestamp>
#   MAX_BEATS=0 (0 = all; 3 gives the short ~25 s test)   MAX_WORDS=25   VOICE=af_heart   SPEED=0.95   HOLD_LAST=2.6 (rest after the last beat)
#   CRF=24   SCALE=0.75   IDLE_CLIP=/opt/presenter/assets/idle_calm_g_h3_original.mp4   CONCAT_MODE=copy|reencode   WORK_DIR=/tmp/render
#   DRY_RUN=1 prints the plan and every command, runs nothing and needs no GPU
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SCRIPT_FILE="${SCRIPT_FILE:-/mnt/bucket/in/script.txt}"
OUT_ROOT="${OUT_ROOT:-/mnt/bucket/out}"
JOB_ID="${JOB_ID:-${CLOUD_RUN_EXECUTION:-local-$(date -u +%Y%m%dT%H%M%SZ)}}"
WORK="${WORK_DIR:-/tmp/render}"
MAX_BEATS="${MAX_BEATS:-0}"; MAX_WORDS="${MAX_WORDS:-25}"; VOICE="${VOICE:-af_heart}"; SPEED="${SPEED:-0.95}"; HOLD_LAST="${HOLD_LAST:-2.6}"
CRF="${CRF:-24}"; SCALE="${SCALE:-0.75}"; IDLE_CLIP="${IDLE_CLIP:-$ROOT/assets/idle_calm_g_h3_original.mp4}"; CONCAT_MODE="${CONCAT_MODE:-copy}"
RUNTIME="${RUNTIME:-/opt/runtime}"; KOKORO_PY="${KOKORO_PY:-/opt/kokoro-venv/bin/python}"; KOKORO_MODELS="${KOKORO_MODELS:-/opt/models/kokoro}"
DRY="${DRY_RUN:-0}"; PYTHON="${PYTHON:-python3}"
TOOLS="$HERE/pipeline_tools.py"

T0=$(date +%s.%N)
now() { date +%s.%N; }
say() { printf '[+%ss] %s\n' "$(awk "BEGIN{printf \"%.0f\", $(now) - $T0}")" "$*"; }
run() { if [ "$DRY" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }
EVENTS="$WORK/timings.jsonl"
mkdir -p "$WORK"; : > "$EVENTS"
STEP_NAME=''; STEP_BEAT=''; STEP_START=''
step_begin() { STEP_NAME="$1"; STEP_BEAT="${2:-}"; STEP_START=$(now); say "step=$STEP_NAME${STEP_BEAT:+ beat=$STEP_BEAT} begin"; }
step_end() {
  local end; end=$(now)
  printf '{"step":"%s","beat":"%s","start":%s,"end":%s}\n' "$STEP_NAME" "$STEP_BEAT" "$STEP_START" "$end" >> "$EVENTS"
  say "step=$STEP_NAME${STEP_BEAT:+ beat=$STEP_BEAT} end ($(awk "BEGIN{printf \"%.1f\", $end - $STEP_START}") s)"
}

say "job=$JOB_ID dry_run=$DRY script=$SCRIPT_FILE out=$OUT_ROOT/$JOB_ID max_beats=$MAX_BEATS max_words=$MAX_WORDS voice=$VOICE speed=$SPEED"
GPU_PID=''
if [ "$DRY" = 0 ]; then
  [ -f "$SCRIPT_FILE" ] || { echo "SCRIPT_FILE not found: $SCRIPT_FILE" >&2; exit 1; }
  if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader | sed 's/^/[gpu] /'
    nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits -l 5 > "$WORK/gpu_mem.csv" 2>/dev/null &
    GPU_PID=$!
  else
    echo '[gpu] nvidia-smi not found: this run has no GPU' >&2
  fi
else
  [ -f "$SCRIPT_FILE" ] || printf '[dry-run] (SCRIPT_FILE does not exist here; a real run would stop)\n'
fi
trap '[ -n "$GPU_PID" ] && kill "$GPU_PID" 2>/dev/null || true' EXIT

step_begin split
if [ -f "$SCRIPT_FILE" ]; then
  "$PYTHON" "$TOOLS" split --script "$SCRIPT_FILE" --out "$WORK/beats.json" --max-words "$MAX_WORDS" --max-beats "$MAX_BEATS"
else
  printf '{"b001": "dry run"}\n' > "$WORK/beats.json"
fi
step_end
BEATS=$("$PYTHON" -c "import json,sys; print(' '.join(json.load(open(sys.argv[1]))))" "$WORK/beats.json")
LAST=$(echo "$BEATS" | awk '{print $NF}')

step_begin kokoro
mkdir -p "$WORK/wav" "$WORK/seg"
run "$KOKORO_PY" "$ROOT/tts/kokoro_tts.py" "$WORK/beats.json" "$KOKORO_MODELS" "$WORK/wav" "$VOICE" "$SPEED"
step_end

for b in $BEATS; do
  HOLD=0; [ "$b" = "$LAST" ] && HOLD="$HOLD_LAST"
  step_begin presenter "$b"
  MP=("$HERE/make_presenter.sh" --idle "$IDLE_CLIP" --audio "$WORK/wav/$b.wav" --out "$WORK/seg/$b.webm" --runtime "$RUNTIME" --hold "$HOLD" --crf "$CRF" --scale "$SCALE")
  if [ "$DRY" = 1 ]; then "${MP[@]}" --dry-run; else "${MP[@]}"; fi
  # free the frame folders of this beat now: the local disk is memory
  run rm -rf "$WORK/seg/$b.webm.work"
  # keep every finished beat in the bucket at once: a job that hits its timeout must not lose the beats it already rendered (the first GCP trial lost everything)
  if [ "$DRY" = 1 ]; then printf '[dry-run] cp %s %s/seg/
' "$WORK/seg/$b.webm" "$OUT_ROOT/$JOB_ID"; else
    mkdir -p "$OUT_ROOT/$JOB_ID/seg" && cp "$WORK/seg/$b.webm" "$WORK/seg/${b}_green_master.mp4" "$OUT_ROOT/$JOB_ID/seg/" && say "saved beat $b to $OUT_ROOT/$JOB_ID/seg" || echo "warning: beat $b could not be saved to the bucket" >&2
  fi
  step_end
done

step_begin join
if [ "$DRY" = 1 ]; then
  printf '[dry-run] concat lists are written from the finished beat files (%s)
' "$BEATS"
else
  "$PYTHON" "$TOOLS" concat-list --beats "$WORK/beats.json" --dir "$WORK/seg" --suffix .webm --out "$WORK/concat_webm.txt"
  "$PYTHON" "$TOOLS" concat-list --beats "$WORK/beats.json" --dir "$WORK/seg" --suffix _green_master.mp4 --out "$WORK/concat_green.txt"
fi
if [ "$CONCAT_MODE" = copy ]; then CODEC=(-c copy); else CODEC=(-c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf "$CRF" -auto-alt-ref 0 -c:a libopus -b:a 96k); fi
run ffmpeg -v error -y -f concat -safe 0 -i "$WORK/concat_webm.txt" "${CODEC[@]}" "$WORK/presenter.webm"
run ffmpeg -v error -y -f concat -safe 0 -i "$WORK/concat_green.txt" -c copy "$WORK/presenter_green_master.mp4"
step_end

AUDIO_SECONDS=0
if [ -f "$WORK/wav/voice-card.json" ]; then
  AUDIO_SECONDS=$("$PYTHON" -c "import json,sys; print(round(sum(json.load(open(sys.argv[1]))['durations'].values()),3))" "$WORK/wav/voice-card.json")
fi
[ -n "$GPU_PID" ] && kill "$GPU_PID" 2>/dev/null || true; GPU_PID=''
GPU_ARG=(); [ -f "$WORK/gpu_mem.csv" ] && GPU_ARG=(--gpu "$WORK/gpu_mem.csv")
"$PYTHON" "$TOOLS" summarise --events "$EVENTS" ${GPU_ARG[@]+"${GPU_ARG[@]}"} --out "$WORK/timings.json" --job-id "$JOB_ID" --audio-seconds "$AUDIO_SECONDS"

# copy to the mounted bucket last: Cloud Storage FUSE stages a write in memory until the file is closed
OUT_DIR="$OUT_ROOT/$JOB_ID"
run mkdir -p "$OUT_DIR"
for f in presenter.webm presenter_green_master.mp4 beats.json timings.json timings.jsonl; do
  if [ "$DRY" = 1 ]; then printf '[dry-run] cp %s %s
' "$WORK/$f" "$OUT_DIR/$f"; elif [ -f "$WORK/$f" ]; then cp "$WORK/$f" "$OUT_DIR/$f"; else echo "note: $f was not produced" >&2; fi
done
[ "$DRY" = 1 ] || { [ -f "$WORK/wav/voice-card.json" ] && cp "$WORK/wav/voice-card.json" "$OUT_DIR/voice-card.json" || true; }
say "DONE job=$JOB_ID -> $OUT_DIR"
