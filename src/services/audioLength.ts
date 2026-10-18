// Length of an MP3 in seconds from its first frame header (Google Text-to-Speech writes constant-bit-rate MP3). Used to size a presenter render from the real voice; falls back to 64 kbit/s.
const MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
export function mp3Seconds(audio: Buffer): number {
  let i = 0;
  if (audio.length > 10 && audio.toString('latin1', 0, 3) === 'ID3') i = 10 + (((audio[6]! & 0x7f) << 21) | ((audio[7]! & 0x7f) << 14) | ((audio[8]! & 0x7f) << 7) | (audio[9]! & 0x7f));
  for (; i + 4 < audio.length && i < 100_000; i += 1) {
    if (audio[i] === 0xff && (audio[i + 1]! & 0xe0) === 0xe0) {
      const version = (audio[i + 1]! >> 3) & 3; const idx = (audio[i + 2]! >> 4) & 15;
      const kbps = (version === 3 ? MPEG1 : MPEG2)[idx] ?? 0;
      if (kbps > 0) return (audio.length * 8) / (kbps * 1000);
    }
  }
  return (audio.length * 8) / 64_000;
}
