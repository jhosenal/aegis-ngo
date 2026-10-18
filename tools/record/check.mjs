#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const recordingRoot = join(root, 'data', 'recordings');
const expected = ['assist-sg-mask', 'assist-my-offline', 'assist-phone', 'domains', 'overview-desktop', 'overview-phone', 'overview-states', 'workspace', 'hazard-map'];

function pngPixels(buffer) {
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a PNG file');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressed = [];
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (type === 'IHDR') { width = buffer.readUInt32BE(dataStart); height = buffer.readUInt32BE(dataStart + 4); bitDepth = buffer[dataStart + 8]; colorType = buffer[dataStart + 9]; }
    if (type === 'IDAT') compressed.push(buffer.subarray(dataStart, dataEnd));
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType)) throw new Error('unsupported PNG format');
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(compressed));
  const rows = [];
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source++];
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source++];
      const left = x >= channels ? row[x - channels] : 0;
      const up = y > 0 ? rows[y - 1][x] : 0;
      const upperLeft = y > 0 && x >= channels ? rows[y - 1][x - channels] : 0;
      let predict = 0;
      if (filter === 1) predict = left;
      else if (filter === 2) predict = up;
      else if (filter === 3) predict = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
        predict = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
      } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      row[x] = (value + predict) & 255;
    }
    rows.push(row);
  }
  const samples = new Set();
  const xStride = Math.max(1, Math.floor(width / 80));
  const yStride = Math.max(1, Math.floor(height / 80));
  for (let y = 0; y < height; y += yStride) for (let x = 0; x < width; x += xStride) {
    const i = x * channels;
    samples.add(`${rows[y][i]},${rows[y][i + 1]},${rows[y][i + 2]}`);
  }
  return { width, height, colors: samples.size };
}

async function main() {
  let passed = 0;
  let totalBytes = 0;
  for (const id of expected) {
    const directory = join(recordingRoot, id);
    const paths = [`${id}.webm`, `${id}.json`, `${id}-end.png`].map((name) => join(directory, name));
    const [videoStat, metadataStat, screenshotStat] = await Promise.all(paths.map((path) => stat(path).catch(() => null)));
    if (!videoStat || !metadataStat || !screenshotStat || videoStat.size === 0) throw new Error(`${id}: one or more recording files are missing or empty`);
    const metadata = JSON.parse(await readFile(paths[1], 'utf8'));
    if (metadata.scene !== id) throw new Error(`${id}: metadata scene id does not match`);
    if (!metadata.viewport || !Number.isInteger(metadata.viewport.width) || !Number.isInteger(metadata.viewport.height)) throw new Error(`${id}: viewport is missing or invalid`);
    if (!Number.isFinite(metadata.durationMs) || metadata.durationMs < 20_000 || metadata.durationMs > 45_000) throw new Error(`${id}: logged video duration is outside 20 to 45 seconds`);
    if (!Array.isArray(metadata.steps) || metadata.steps.length < 2 || metadata.steps.some((step) => !Number.isFinite(step.startedMs))) throw new Error(`${id}: scene step log is incomplete`);
    const image = pngPixels(await readFile(paths[2]));
    if (image.width < metadata.viewport.width * 2 || image.height < metadata.viewport.height * 2 || image.colors < 20) throw new Error(`${id}: end screenshot is blank, low detail or below 2x pixel density`);
    totalBytes += videoStat.size + metadataStat.size + screenshotStat.size;
    passed += 1;
    console.log(`PASS ${id}: ${metadata.viewport.width}x${metadata.viewport.height}, ${(metadata.durationMs / 1000).toFixed(1)} s log, ${image.width}x${image.height} screenshot`);
  }
  const extra = (await readdir(recordingRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !expected.includes(entry.name));
  if (extra.length) console.log(`Note: ignored extra recording directories: ${extra.map((entry) => entry.name).join(', ')}`);
  console.log(`Recording check: ${passed}/${expected.length} scenes passed; ${(totalBytes / 1_048_576).toFixed(2)} MiB total for listed scene files.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Recording check failed.'); process.exitCode = 1; });
