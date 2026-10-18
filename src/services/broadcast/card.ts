// The warning card of a bulletin (AEG-NEWS-007): a 1200 x 675 picture for one language, made from the owner's AI-illustrated hazard artwork (public/brand/hazard-gallery.webp, cropped per hazard),
// an alert-level band, the headline in that language, "what to do" (the official guidance lines, in that language) and the "not an official warning" line. Built as an SVG with the artwork embedded,
// so it works as an image anywhere and renders to a PNG in a browser. The fixed labels below are written by us and need a native-speaker check before public release (listed in AEG-SOP-003).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from '../../data/db.js';
import type { Bulletin } from './script.js';

export const CARD = { width: 1200, height: 675 } as const;
/** Crops of the gallery picture (1672 x 941) that are photographs without the baked-in symbols, the same regions the site uses. */
const CROPS: Record<string, [number, number, number, number]> = { seismic: [44, 120, 510, 230], hydrological: [581, 120, 510, 230], meteorological: [1118, 120, 512, 230], wildfire: [44, 495, 380, 224], volcanic: [1250, 495, 379, 224] };
const HAZARD_ART: Record<string, string> = { EARTHQUAKE: 'seismic', FLOOD: 'hydrological', STORM: 'meteorological', WILDFIRE: 'wildfire', VOLCANO: 'volcanic' };

interface Labels { emergency: string; drill: string; red: string; orange: string; alert: string; whatToDo: string; disclaimer: string }
export const CARD_LABELS: Record<string, Labels> = {
  en: { emergency: 'EMERGENCY INFORMATION', drill: 'EXERCISE · NOT A REAL EVENT', red: 'RED ALERT', orange: 'ORANGE ALERT', alert: 'ALERT', whatToDo: 'WHAT TO DO (OFFICIAL GUIDANCE)', disclaimer: 'AEGIS summary of an official source. Not an official warning. Follow your local authority.' },
  ms: { emergency: 'MAKLUMAN KECEMASAN', drill: 'LATIHAN · BUKAN KEJADIAN SEBENAR', red: 'AMARAN MERAH', orange: 'AMARAN JINGGA', alert: 'AMARAN', whatToDo: 'APA YANG PERLU DILAKUKAN (PANDUAN RASMI)', disclaimer: 'Ringkasan AEGIS daripada sumber rasmi. Bukan amaran rasmi. Ikut arahan pihak berkuasa tempatan.' },
  // Vietnamese labels written by us, NOT yet read by a Vietnamese reader. Khmer and Hmong fall back to the English labels until a reader supplies them.
  vi: { emergency: 'THÔNG TIN KHẨN CẤP', drill: 'DIỄN TẬP · KHÔNG PHẢI SỰ KIỆN THẬT', red: 'CẢNH BÁO ĐỎ', orange: 'CẢNH BÁO CAM', alert: 'CẢNH BÁO', whatToDo: 'VIỆC CẦN LÀM (HƯỚNG DẪN CHÍNH THỨC)', disclaimer: 'Tóm tắt của AEGIS từ nguồn chính thức. Không phải cảnh báo chính thức. Hãy làm theo hướng dẫn của chính quyền địa phương.' },
  zh: { emergency: '紧急信息', drill: '演练 · 非真实事件', red: '红色警报', orange: '橙色警报', alert: '警报', whatToDo: '应采取的行动（官方指引）', disclaimer: 'AEGIS 对官方来源的摘要，并非官方警告。请遵从当地主管部门的指示。' },
  ta: { emergency: 'அவசரத் தகவல்', drill: 'பயிற்சி · உண்மையான நிகழ்வு அல்ல', red: 'சிவப்பு எச்சரிக்கை', orange: 'ஆரஞ்சு எச்சரிக்கை', alert: 'எச்சரிக்கை', whatToDo: 'என்ன செய்ய வேண்டும் (அதிகாரப்பூர்வ வழிகாட்டுதல்)', disclaimer: 'அதிகாரப்பூர்வ மூலத்தின் AEGIS சுருக்கம். இது அதிகாரப்பூர்வ எச்சரிக்கை அல்ல. உள்ளூர் அதிகாரிகளின் வழிகாட்டுதலைப் பின்பற்றவும்.' },
};
const FONT = "'Segoe UI','Nirmala UI','Noto Sans Tamil','Khmer UI','Leelawadee UI','Noto Sans Khmer','Microsoft YaHei','Noto Sans SC','Noto Sans',Arial,sans-serif";
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let gallery: string | null = null;
function galleryDataUri(): string {
  if (gallery) return gallery;
  const root = projectRoot();
  const file = [resolve(root, 'ui/dist/brand/hazard-gallery.webp'), resolve(root, 'ui/public/brand/hazard-gallery.webp')].find((f) => existsSync(f));
  gallery = file ? `data:image/webp;base64,${readFileSync(file).toString('base64')}` : '';
  return gallery;
}
export const levelColour = (level: string): string => (level.toUpperCase() === 'RED' ? '#c62828' : level.toUpperCase() === 'ORANGE' ? '#e65100' : '#1565c0');

/** The texts of a bulletin by role: the headline and the "what to do" lines (the segments written for the card), in whatever language `texts` is in (same order as the bulletin's segments). */
export function cardTexts(bulletin: Bulletin, texts: string[]): { headline: string; actions: string } {
  const at = (id: string): string => { const i = bulletin.segments.findIndex((s) => s.id === id); return i >= 0 ? texts[i] ?? '' : ''; };
  return { headline: at('emergency-headline') || texts[0] || '', actions: at('emergency-actions') };
}

/** The card for a bulletin in a language. `texts` are the segment texts in that language (English: the bulletin's own, in order). */
export function buildCardSvg(p: { bulletin: Bulletin; language: string; texts: string[]; drill?: boolean }): string {
  const labels = CARD_LABELS[p.language] ?? CARD_LABELS['en']!;
  const inc = p.bulletin.incident;
  const level = (inc?.alertLevel ?? 'UNRATED').toUpperCase();
  const levelText = level === 'RED' ? labels.red : level === 'ORANGE' ? labels.orange : labels.alert;
  const art = inc ? HAZARD_ART[inc.hazardType.toUpperCase()] : undefined;
  const crop = art ? CROPS[art] : undefined;
  const W = CARD.width; const H = CARD.height; const heroH = 270; const bandH = 52; const footH = 58;
  const { headline, actions } = cardTexts(p.bulletin, p.texts);
  const hero = crop && galleryDataUri()
    ? `<svg x="0" y="0" width="${W}" height="${heroH}" viewBox="${crop.join(' ')}" preserveAspectRatio="xMidYMid slice"><image href="${galleryDataUri()}" width="1672" height="941"/></svg>`
    : `<rect width="${W}" height="${heroH}" fill="#0b2638"/>`;
  const colour = levelColour(level);
  const lower = p.bulletin.segments[0]?.lowerThird ?? '';
  const top = heroH + bandH;                               // where the text starts
  const headSize = headline.length <= 230 ? 22 : headline.length <= 330 ? 20 : 18;
  const headH = 92; const labelY = top + 12 + headH + 22;  // the headline box, then the small label
  const actTop = labelY + 8; const actH = H - footH - actTop - 6;
  const actSize = actions.length <= 360 ? 20 : actions.length <= 560 ? 18 : 16;
  const actLines = Math.max(3, Math.floor(actH / (actSize * 1.32)));
  const headLines = Math.max(2, Math.floor(headH / (headSize * 1.32)));
  const box = (size: number, lines: number, colour2: string): string => `font-family:${esc(FONT)};font-size:${size}px;line-height:1.32;color:${colour2};overflow:hidden;display:-webkit-box;-webkit-line-clamp:${lines};-webkit-box-orient:vertical;`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${labels.emergency}: ${headline.slice(0, 120)}`)}">
  <rect width="${W}" height="${H}" fill="#0a1b2b"/>
  ${hero}
  <rect x="0" y="${heroH - 70}" width="${W}" height="70" fill="#0a1b2b" opacity="0.5"/>
  <rect x="0" y="${heroH}" width="${W}" height="${bandH}" fill="${colour}"/>
  <text x="32" y="${heroH + 36}" font-family="${FONT}" font-size="26" font-weight="700" fill="#ffffff">${esc(labels.emergency)}</text>
  <text x="${W - 32}" y="${heroH + 36}" text-anchor="end" font-family="${FONT}" font-size="26" font-weight="700" fill="#ffffff">${esc(levelText)}</text>
  ${p.drill ? `<rect x="32" y="22" rx="6" width="${Math.min(560, 60 + labels.drill.length * 16)}" height="42" fill="#ffd34d"/><text x="48" y="51" font-family="${FONT}" font-size="21" font-weight="700" fill="#3b2a00">${esc(labels.drill)}</text>` : ''}
  <foreignObject x="32" y="${top + 12}" width="${W - 64}" height="${headH}">
    <xhtml:div style="${box(headSize, headLines, '#f2f7fb')}">${esc(headline)}</xhtml:div>
  </foreignObject>
  ${actions ? `<text x="32" y="${labelY}" font-family="${FONT}" font-size="15" font-weight="700" letter-spacing="1" fill="${colour === '#1565c0' ? '#7fb8ff' : '#ffb74d'}">${esc(labels.whatToDo)}</text>
  <foreignObject x="32" y="${actTop}" width="${W - 64}" height="${actH}">
    <xhtml:div style="${box(actSize, actLines, '#dfeaf3')}">${esc(actions)}</xhtml:div>
  </foreignObject>` : ''}
  <rect x="0" y="${H - footH}" width="${W}" height="${footH}" fill="#06121d"/>
  <foreignObject x="32" y="${H - footH + 4}" width="${W - 64}" height="${footH - 6}">
    <xhtml:div style="font-family:${esc(FONT)};font-size:16px;line-height:1.3;color:#9fb8cc;overflow:hidden;">${esc(labels.disclaimer)} · ${esc(lower)}</xhtml:div>
  </foreignObject>
</svg>`;
}
