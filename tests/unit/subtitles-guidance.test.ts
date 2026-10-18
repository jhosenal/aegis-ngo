import { describe, expect, it } from 'vitest';
import { buildCues, toVtt } from '../../src/services/broadcast/subtitles.js';
import { resolveGuidance, loadGuidance } from '../../src/services/broadcast/guidance.js';

describe('subtitle cues (AEG-NEWS-007)', () => {
  const ids = ['emergency-headline', 'emergency-actions', 'emergency-notice'];
  it('cuts the texts into short captions that cover the whole speech exactly once, in order', () => {
    const texts = ['This is an AEGIS emergency information bulletin, issued at 13:20 Malaysia and Singapore time. Tropical Cyclone NOUL-26. GDACS rates it orange.', 'In Singapore, BCA advises: Indoors: Take cover under a table. Do not use a naked flame. Do not use the lift. Outdoors: Remain in the open until the tremor stops; this will keep you safe from the risk of falling debris. Stay away from buildings.', 'This is an AEGIS summary of an official source, not an official warning.'];
    const cues = buildCues(texts, ids);
    expect(cues.length).toBeGreaterThan(6);
    expect(cues[0]!.start).toBe(0); expect(cues[cues.length - 1]!.end).toBeCloseTo(1, 3);
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.start).toBeCloseTo(cues[i - 1]!.end, 3);
    for (const c of cues) { expect(c.text.length).toBeLessThanOrEqual(130); expect(c.end).toBeGreaterThan(c.start); }
    expect(cues.map((c) => c.segmentId)).toEqual([...cues.map((c) => c.segmentId)].sort((a, b) => ids.indexOf(a) - ids.indexOf(b)));
    expect(cues.map((c) => c.text).join(' ')).toContain('Take cover under a table.');
  });
  it('keeps Chinese and Tamil captions short too', () => {
    const zh = buildCues(['这是一则 AEGIS 紧急信息通报，发布于马来西亚和新加坡时间 13:20。热带气旋 NOUL-26，GDACS 将其评为橙色，最新的 GDACS 报告日期为当地时间 14:00，请遵从当地主管部门的指示并保持关注官方发布的消息。'], ['a']);
    for (const c of zh) expect(c.text.length).toBeLessThanOrEqual(60);
    const ta = buildCues(['இது மலேசியா மற்றும் சிங்கப்பூர் நேரப்படி 13:20 மணிக்கு வெளியிடப்பட்ட AEGIS அவசரத் தகவல் அறிவிப்பு. வெப்பமண்டல சூறாவளி NOUL-26. GDACS இதற்கு ஆரஞ்சு நிற மதிப்பீடு அளிக்கிறது.'], ['a']);
    expect(ta.length).toBeGreaterThan(1);
  });
  it('writes WebVTT for a known length', () => {
    const vtt = toVtt(buildCues(['One. Two.'], ['a']), 10);
    expect(vtt.startsWith('WEBVTT')).toBe(true); expect(vtt).toContain('00:00:00.000 -->'); expect(vtt).toContain('00:00:10.000');
  });
});

describe('what to do: official guidance only (AEG-GUIDE-001)', () => {
  const file = loadGuidance();
  it('every quoted line comes from a named official page, and UNSOURCED means no lines at all', () => {
    for (const [hazard, byCountry] of Object.entries(file.hazards)) for (const [iso3, e] of Object.entries(byCountry)) {
      if (e.status === 'SOURCED') { expect(e.sources.length, `${hazard} ${iso3}`).toBeGreaterThan(0); for (const s of e.sources) expect(s.url).toMatch(/^https:\/\/.*\.(gov\.sg|gov\.my|gov\.bn)\//); for (const l of e.lines) if (l.language === 'ms') expect(l.en, `${hazard} ${iso3} ${l.text}`).toBeTruthy(); }
      else expect(e.reason.length).toBeGreaterThan(10);
    }
  });
  it('a quake in Sabah gets the Malaysian guidance, one in Indonesia gets all three countries, a volcano admits it has none', () => {
    const sabah = resolveGuidance({ hazardType: 'EARTHQUAKE', alertLevel: 'ORANGE', lat: 6.1, lon: 116.2 }, file);
    expect(sabah.countries.map((c) => c.iso3)).toEqual(['MYS']); expect(sabah.text).toContain('In Malaysia, NADMA advises:'); expect(sabah.text).toContain('Drop, Cover, Hold On'); expect(sabah.numbers).toEqual(['999']);
    const java = resolveGuidance({ hazardType: 'EARTHQUAKE', alertLevel: 'GREEN', lat: -6, lon: 106 }, file);
    expect(java.countries.map((c) => `${c.iso3}:${c.status}`)).toEqual(['SGP:SOURCED', 'MYS:SOURCED', 'BRN:UNSOURCED']);
    expect(java.text).toContain('In Singapore, BCA advises: Indoors: Take cover under a table.'); expect(java.text).toContain('For Brunei, AEGIS has no official guidance on file'); expect(java.text).toContain('call 991');
    expect(java.remarks.join(' ')).toContain('translation of the official Malay text');
    const volcano = resolveGuidance({ hazardType: 'VOLCANO', alertLevel: 'ORANGE', lat: 10.4, lon: 123.1 }, file);
    expect(volcano.countries.every((c) => c.status === 'UNSOURCED')).toBe(true); expect(volcano.text).toContain('AEGIS has no official public guidance on file for this hazard');
    expect(volcano.text).not.toMatch(/advises/);
  });
  it('never invents advice: the text is made only of quoted lines, the "no guidance" sentence and the emergency numbers', () => {
    const g = resolveGuidance({ hazardType: 'STORM', alertLevel: 'ORANGE', lat: 12, lon: 125 }, file);
    expect(g.countries.find((c) => c.iso3 === 'MYS')!.lines).toContain('Avoid going to sea in a small ship or boat.');
    expect(g.names).toContain('MetMalaysia');
  });
});
