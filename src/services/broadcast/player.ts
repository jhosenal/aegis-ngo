// The emergency card player (AEG-NEWS-007): one page that shows the warning card, reads the bulletin aloud and shows the subtitles in step with the voice, in the language the person chooses.
// The voice is the MP3 Google Cloud Text-to-Speech made (when it exists); otherwise the browser reads it, one caption at a time. The server sets a strict content security policy (no inline script), so the
// script is served separately (PLAYER_JS). Only approved bulletins are shown, and never an exercise.
import { CARD_LABELS } from './card.js';
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const LANG_LABEL: Record<string, { name: string; speech: string; play: string; stop: string; subtitles: string; listen: string }> = {
  en: { name: 'English', speech: 'en-GB', play: 'Play the voice', stop: 'Stop', subtitles: 'Subtitles', listen: 'Listen' },
  ms: { name: 'Bahasa Melayu', speech: 'ms-MY', play: 'Mainkan suara', stop: 'Henti', subtitles: 'Sarikata', listen: 'Dengar' },
  zh: { name: '中文', speech: 'zh-CN', play: '播放语音', stop: '停止', subtitles: '字幕', listen: '收听' },
  ta: { name: 'தமிழ்', speech: 'ta-IN', play: 'குரலை இயக்கு', stop: 'நிறுத்து', subtitles: 'வசன வரிகள்', listen: 'கேளுங்கள்' },
};

export function playerHtml(p: { bulletinId: string; language: string; languages: string[]; headline: string; actions: string; notice: string; guidanceSources: string[] }): string {
  const L = LANG_LABEL[p.language] ?? LANG_LABEL['en']!;
  const id = encodeURIComponent(p.bulletinId);
  const chips = p.languages.map((l) => `<a class="chip${l === p.language ? ' on' : ''}" href="/public/emergency/${id}?lang=${l}" lang="${l}" ${l === p.language ? 'aria-current="true"' : ''}>${esc(LANG_LABEL[l]?.name ?? l)}</a>`).join('');
  return `<!doctype html>
<html lang="${p.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AEGIS emergency information</title>
<style>body{margin:0;background:#06121d;color:#eaf2f8;font:16px/1.45 'Segoe UI','Nirmala UI','Noto Sans Tamil','Microsoft YaHei','Noto Sans SC',Arial,sans-serif}main{max-width:1000px;margin:0 auto;padding:12px}
.card{position:relative}.card img{display:block;width:100%;height:auto;border-radius:8px}.cap{position:absolute;left:3%;right:3%;bottom:12%;min-height:2.6em;display:flex;align-items:center;justify-content:center;text-align:center;padding:8px 14px;border-radius:8px;background:rgba(0,0,0,.78);font-size:clamp(15px,2.6vw,26px);line-height:1.35}.cap:empty{display:none}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.chip{padding:6px 12px;border-radius:999px;border:1px solid #4b7da3;color:#cfe6f7;text-decoration:none}.chip.on{background:#1b6fb8;color:#fff;border-color:#a6dfff}
button{font:inherit;font-weight:700;padding:8px 18px;border-radius:999px;border:1px solid #a6dfff;background:#1b6fb8;color:#fff;cursor:pointer}audio{height:36px;max-width:100%}h2{font-size:15px;letter-spacing:.04em;color:#ffb74d;margin:18px 0 4px}p{margin:4px 0}small{color:#9fb8cc}</style></head>
<body><main>
<div class="card"><img id="card" src="/public/broadcast/card/${id}?lang=${p.language}" alt="${esc(p.headline.slice(0, 160))}" width="1200" height="675"><div class="cap" id="cap" role="status" aria-live="polite"></div></div>
<div class="bar"><button id="play" type="button" data-play="${esc(L.play)}" data-stop="${esc(L.stop)}">${esc(L.play)}</button><audio id="audio" controls preload="auto" src="/public/broadcast/voice/${id}?lang=${p.language}" aria-label="${esc(L.listen)}"></audio><span>${chips}</span></div>
<h2>${esc(L.subtitles)}</h2><p><small id="status"></small></p>
<h2 lang="${p.language}">${esc((CARD_LABELS[p.language] ?? CARD_LABELS['en']!).whatToDo)}</h2>
<p lang="${p.language}">${esc(p.headline)}</p><p lang="${p.language}">${esc(p.actions)}</p><p lang="${p.language}"><small>${esc(p.notice)}</small></p>
<h2>Sources</h2><ul>${p.guidanceSources.map((s) => `<li><small>${esc(s)}</small></li>`).join('')}</ul>
</main><script src="/public/emergency-player.js" data-id="${id}" data-lang="${p.language}" data-speech="${L.speech}" defer></script></body></html>`;
}

export const PLAYER_JS = `(function(){
  var s=document.currentScript, id=s.dataset.id, lang=s.dataset.lang, speech=s.dataset.speech;
  var a=document.getElementById('audio'), cap=document.getElementById('cap'), btn=document.getElementById('play'), st=document.getElementById('status');
  var cues=[], browserVoice=false, timer=null;
  function show(t){ cap.textContent=t||''; }
  function at(f){ for(var i=0;i<cues.length;i++){ if(f>=cues[i].start && f<cues[i].end) return cues[i].text; } return ''; }
  fetch('/public/broadcast/cues/'+id+'?lang='+encodeURIComponent(lang)).then(function(r){return r.ok?r.json():null;}).then(function(j){ cues=j?j.cues:[]; if(!cues.length) st.textContent='No subtitles for this language.'; });
  a.addEventListener('timeupdate',function(){ if(a.duration>0) show(at(a.currentTime/a.duration)); });
  a.addEventListener('ended',function(){ show(''); btn.textContent=btn.dataset.play; });
  a.addEventListener('error',function(){ browserVoice=true; st.textContent='The recorded voice is not available: your browser will read it.'; });
  function speakAll(){
    if(!('speechSynthesis' in window)){ st.textContent='This browser cannot read aloud. The subtitles and the text below are the message.'; return; }
    speechSynthesis.cancel(); var i=0;
    (function next(){ if(i>=cues.length){ show(''); btn.textContent=btn.dataset.play; return; }
      var c=cues[i++]; var u=new SpeechSynthesisUtterance(c.text); u.lang=speech; u.onstart=function(){ show(c.text); }; u.onend=next; u.onerror=next; speechSynthesis.speak(u); })();
  }
  btn.addEventListener('click',function(){
    if(btn.textContent===btn.dataset.stop){ a.pause(); if(window.speechSynthesis) speechSynthesis.cancel(); show(''); btn.textContent=btn.dataset.play; return; }
    btn.textContent=btn.dataset.stop;
    if(browserVoice||a.error){ speakAll(); } else { a.currentTime=0; a.play().catch(function(){ browserVoice=true; speakAll(); }); }
  });
})();`;
