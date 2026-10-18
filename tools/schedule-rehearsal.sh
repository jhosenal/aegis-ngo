#!/usr/bin/env bash
# Waits until HH:MM local time (default 20:55) and then runs one dry rehearsal of the capture, writing data/rehearsal-HHMM.txt. Usage: bash tools/schedule-rehearsal.sh [HHMM]
set -u
target="${1:-2055}"
until [ $((10#$(date +%H%M))) -ge $((10#$target)) ]; do sleep 20; done
cd "$(dirname "$0")/.." && node --env-file-if-exists=.env node_modules/tsx/dist/cli.mjs tools/rehearse-capture.ts --out "data/rehearsal-${target}.txt"
