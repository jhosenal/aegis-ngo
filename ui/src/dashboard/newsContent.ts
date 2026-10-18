// Registered introduction copy. This is not a model-generated or current-news bulletin.
// Source: Recast presenter kit sample (docs/handoff/aegis-presenter, AGENT.md); the line below is the exact narration of the video.
export const WELCOME = {
  id: 'aegis-welcome-anchor-v1',
  title: 'Welcome to AEGIS',
  video: '/media/aegis-presenter-welcome.webm',
  videoWidth: 816,
  videoHeight: 960,
  voice: 'Synthetic voice (Kokoro, stock voice, no cloning)',
  label: 'AI-generated presenter',
  paragraphs: [
    'Welcome to Aegis, providing continuous disaster telemetry across 120 plus local monitoring zones in Singapore, Malaysia, and Brunei.',
  ],
} as const;

/** The station jingle played before the presenter speaks (owner's own track "Sound Effects", walkingwithairo, supplied 2026-10-16 in E:\Aegis\import; 4.82 s long, the first 4 s are used with a short fade). */
export const JINGLE = { src: '/media/news-jingle.mp3', seconds: 4.0, fadeSeconds: 0.5, volume: 0.9 } as const;

export const SUBTITLE_LANGUAGES = [
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'zh', label: 'CN', name: 'Chinese' },
  { id: 'ms', label: 'BM', name: 'Malay' },
  { id: 'ta', label: 'TA', name: 'Tamil' },
] as const;
export type SubtitleLanguage = typeof SUBTITLE_LANGUAGES[number]['id'];

// Manually timed sample captions; translations follow the existing narration,
// including its stated coverage. These are subtitles, not translated audio.
export const INTRO_CAPTIONS: { start: number; end: number; text: Record<SubtitleLanguage, string> }[] = [
  { start: 0, end: 1.95, text: { en: 'Welcome to Aegis,', zh: '欢迎 来到 Aegis，', ms: 'Selamat datang ke Aegis,', ta: 'ஏஜிஸுக்கு வரவேற்கிறோம்,' } },
  { start: 1.95, end: 4.9, text: { en: 'providing continuous disaster telemetry', zh: '持续 提供 灾害 监测数据，', ms: 'menyediakan pemantauan bencana berterusan', ta: 'தொடர்ச்சியான பேரிடர் கண்காணிப்புத் தரவுகளை வழங்குகிறோம்,' } },
  { start: 4.9, end: 7.6, text: { en: 'across 120 plus local monitoring zones', zh: '覆盖 超过 120 个 本地 监测区，', ms: 'di lebih 120 zon pemantauan tempatan', ta: '120-க்கும் மேற்பட்ட உள்ளூர் கண்காணிப்பு மண்டலங்களில்,' } },
  { start: 7.6, end: 10.7, text: { en: 'in Singapore, Malaysia, and Brunei.', zh: '分布于 新加坡、 马来西亚 和 文莱。', ms: 'di Singapura, Malaysia dan Brunei.', ta: 'சிங்கப்பூர், மலேசியா மற்றும் புருனையில்.' } },
];

/** Map camera views the news reader can ask for while the presenter speaks (a test, AEG-NEWS-006). Bounds are south/west/north/east in degrees. */
export const CAMERA_VIEWS = {
  asean: { south: -11, west: 92, north: 22, east: 141 },
  sgp: { south: 1.12, west: 103.58, north: 1.50, east: 104.12 },
  mys: { south: 0.8, west: 99.5, north: 7.5, east: 119.4 },
  brn: { south: 4.0, west: 113.9, north: 5.1, east: 115.45 },
} as const;
export type CameraView = keyof typeof CAMERA_VIEWS;

/**
 * ONE zoom in and ONE zoom out (owner, 2026-10-16): the Malaysia frame (`mys`) already holds Singapore just below the peninsula and Brunei between Sabah and Sarawak,
 * so the map goes there once, when the first of the three is named, and back 2 s after the last. The welcome line "in Singapore, Malaysia, and Brunei." is captioned
 * 7.6 to 10.7 s; word times inside a caption are NOT measured (the first word starts about 7.8 s, the last ends about 10.7 s). Adjust after watching it.
 */
export const WELCOME_MENTIONS: { view: CameraView; at: number; end: number }[] = [{ view: 'mys', at: 7.8, end: 10.7 }];
