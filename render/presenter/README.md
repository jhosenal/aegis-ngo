# Presenter render job (AEG-RENDER-001)

Linux and Docker port of the Recast presenter pipeline (kit: `E:\OAG_Storyboard\docs\handoff\aegis-presenter`, written 2026-10-16) for a **Cloud Run job with one NVIDIA L4**. Input: a UTF-8 script text file. Output: a transparent presenter WebM (VP9 alpha + Opus), a green-screen H.264 master, the beats, the voice card and a timing report, written to a mounted bucket path.

**Status: written, dry-run tested, NEVER BUILT, NEVER RUN.** There is no Docker on the author's machine and nothing has touched GCP. Run it only after the cost gate (`docs/99-inbox/O0001`, `O0002`) and only by the operations agent (AEG-SOP-002).

## Layout
| Path | What |
|---|---|
| `Dockerfile` | CUDA 11.8 devel base, MuseTalk at commit `0a89dec4…` + the CPU-load patch, Python 3.10 venv (torch 2.0.1 cu118, mmcv 2.0.1, mmdet 3.1.0, mmpose 1.1.0), weights verified by hash, Kokoro in a Python 3.12 venv with hash-checked model files |
| `scripts/entrypoint.sh` | the job: split script into beats, Kokoro, render each beat, join, summarise, copy to the bucket. Every step timed |
| `scripts/make_presenter.sh` | bash port of the kit's `make_presenter.ps1`; same stages, flags and thresholds |
| `scripts/pipeline_tools.py` | beat splitter, hash verifiers, concat list, timing summary (standard library only) |
| `musetalk/`, `tts/` | the kit's own scripts and cards, unchanged (the patch has its line endings normalised to LF) |
| `assets/idle_calm_g_h3_original.mp4` | the kit's idle clip (sha256 `3afc1b28…535b`), AI-generated source |

## Design decisions
- **Beat by beat.** Cloud Run's local disk is in memory and counts against the container's memory; 3 minutes of PNG frames in three stages would not fit in 16 GiB. Each beat (at most `MAX_WORDS` = 25 spoken words, the kit's own advice) is rendered, encoded, and its frame folders deleted before the next one. The segments are joined at the end (`CONCAT_MODE=copy`, or `reencode`).
- **Output is copied last** to the bucket: Cloud Storage FUSE stages a write in memory until the file is closed.
- **Pins are the kit's** and are asserted by `tests/unit/render-presenter.test.ts`. `batch_size 4` and `fps 25` are kept as the kit has them (an L4 could take a larger batch; that is a tuning step for after the first measurement).
- **Short test:** `MAX_BEATS=3` renders only the first three beats (about 25 s), matching the gate decision #10.

## Environment (job variables)
`SCRIPT_FILE` (default `/mnt/bucket/in/script.txt`), `OUT_ROOT` (`/mnt/bucket/out`), `JOB_ID`, `MAX_BEATS` (0 = all), `MAX_WORDS`, `VOICE` (`af_heart`), `SPEED` (`0.95`), `HOLD_LAST` (`2.6`), `CRF` (`24`), `SCALE` (`0.75`), `CONCAT_MODE`, `DRY_RUN=1` (plan only, no GPU needed).

## Outputs in `OUT_ROOT/JOB_ID/`
`presenter.webm`, `presenter_green_master.mp4`, `beats.json`, `voice-card.json`, `timings.json` (seconds per step, per beat, total, peak GPU memory MiB, audio seconds), `timings.jsonl`. The log lines on stdout read `[+123s] step=presenter beat=b002 begin` / `end (41.2 s)`.

## Commands for the operations agent (NOT RUN; written from Google's docs read 2026-10-16)
```
# build (Cloud Build; needs its own gate call)
gcloud builds submit render/presenter --tag asia-southeast1-docker.pkg.dev/PROJECT/REPO/aegis-render:TAG
# job: one L4, no zonal redundancy, 4 vCPU, 16 GiB. The flags below the first three are the gate's conditions.
gcloud run jobs create aegis-render --region asia-southeast1 --image IMAGE_URL \
  --cpu 4 --memory 16Gi --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy \
  --task-timeout 900s --max-retries 0 --tasks 1 --parallelism 1 \
  --add-volume name=bucket,type=cloud-storage,bucket=BUCKET --add-volume-mount volume=bucket,mount-path=/mnt/bucket \
  --set-env-vars MAX_BEATS=3
```
Task timeout is 900 s for the gate #10 trial and 3600 s for #11; the gate prices the timeout. `--task-timeout`, `--max-retries` and `--tasks` are standard job flags that Google's GPU page does not itself show: check them with `gcloud run jobs create --help` before use. The service identity needs `roles/storage.objectUser` on the bucket. A bucket mount adds to start-up time (the job fails if mounting takes more than 30 s).

## NOT TESTED (be honest about these)
1. **The image has never been built.** No step of the Dockerfile has run, including: `uv` finding Python 3.10 on Ubuntu 22.04, the CUDA 11.8 devel tag existing, `mim install mmcv==2.0.1` finding a Linux wheel for torch 2.0.1 (otherwise it compiles from source for a long time), `chumpy`, `xtcocotools`, the apt `ffmpeg` (4.4) instead of the kit's 6.1.1.
2. **`get_weights.py` over the network** was not run even in the kit's own validation. The Google Drive download of `79999_iter.pth` (`gdown`) can fail or be rate-limited at build time. The build is designed to fail on any hash difference.
3. **The Kokoro model URLs** (kokoro-onnx release `model-files-v1.0`) are from memory of the project's release page; the kit never recorded a URL. A wrong URL fails the build; a wrong file fails the hash check. Kokoro on Python 3.12 with `numpy==2.5.4` was tested by the kit only on its own machine.
4. **Linux, an L4 GPU, and a driver 580 host** were never tested by the kit (its validation: Windows 11, RTX 4050 6 GB). Speed on an L4 is unknown: the laptop took 436 s of MuseTalk per 10 s of speech.
5. **`ffmpeg -f concat -c copy` on VP9-with-alpha WebM**: not tested. If the joined file loses its alpha or glitches at joins, use `CONCAT_MODE=reencode`.
6. **Beat joins are hard cuts**: each beat restarts from the idle clip's first frame, so the head position jumps at each join. The kit says to cut segments with a short cross-fade (AGENT.md section 3); the Recast news engine does that in its compose step, which is not used here.
7. **Cloud Run specifics**: the GCS FUSE write path, memory use per beat (estimated, not measured), the 30 s mount limit, GPU quota, and `nvidia-smi` sampling inside the container.
8. **Licences of the weights and the idle clip are UNVERIFIED** (kit AGENT.md section 14). This is a private image for measurement, not a release.
What was tested: the beat splitter, both hash verifiers, the argument and stage order of `make_presenter.sh` and `entrypoint.sh` in dry-run, the timing log and summary, and that the Dockerfile contains every kit pin (`tests/unit/render-presenter.test.ts`, 8 tests).
