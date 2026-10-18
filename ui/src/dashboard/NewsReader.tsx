import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { WELCOME, INTRO_CAPTIONS, SUBTITLE_LANGUAGES, CAMERA_VIEWS, WELCOME_MENTIONS, JINGLE } from './newsContent.js';
import { planCamera, stepAt, type CameraStep } from './cameraPlan.js';
import { stopSpeaking } from '../assist/audio/speech.js';
import { Icon } from './Icon.js';
import { loadPreviewBulletin, bulletinCues, bulletinMentions, type PreviewBulletin } from './bulletinPreview.js';
import { loadLatestNews, type LatestNews } from './latestNews.js';
import { getMapLanguage, selectMapLanguage } from './googleMaps.js';
import { COUNTRY_CAMERA_BOUNDS } from './countryCamera.js';
import type { SubtitleLanguage } from './newsContent.js';
import './NewsReader.css';

const SUBTITLE_LANGUAGE_KEY = 'aegis-news-subtitle-language';

function readSubtitleLanguage(): SubtitleLanguage {
  try {
    const saved = window.localStorage.getItem(SUBTITLE_LANGUAGE_KEY);
    if (saved === 'en' || saved === 'zh' || saved === 'ms' || saved === 'ta') return saved;
  } catch { /* Keep the default if browser storage is unavailable. */ }
  return getMapLanguage();
}

/** A transparent 1920x1080 presentation stage, independent of the map camera.
 * The presenter is a pre-rendered transparent WebM with its own audio (Recast kit; AI-generated, synthetic stock voice).
 * Safari does not render WebM alpha; the green-master fallback is a pending item (C0008).
 */
function WelcomeReader({ bulletin, speed = 1, clip, playToken = 0, notice = '', countryView=false }: { bulletin?: PreviewBulletin; speed?: number; clip?: LatestNews; playToken?: number; notice?: string; countryView?:boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const stageBox = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const caption = useRef<HTMLSpanElement>(null);
  const disclosure = useRef<HTMLSpanElement>(null);
  const [fullscreen, setFullscreen] = useState<Element | null>(null);
  const [playing, setPlaying] = useState(false);
  const [jingle, setJingle] = useState(false);
  const jingleAudio = useRef<HTMLAudioElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [paused,setPaused]=useState(false);
  const [muted,setMuted]=useState(false);
  const [duration,setDuration]=useState(0);
  const [error, setError] = useState('');
  const [subtitleLanguage, setSubtitleLanguage] = useState<SubtitleLanguage>(readSubtitleLanguage);
  const [captionTime, setCaptionTime] = useState(0);
  const attempt = useRef(0);
  const playbackRequested = useRef(false);
  const resume = useRef<number | null>(null);

  const lastFrame = (player: HTMLVideoElement) => {
    if (Number.isFinite(player.duration) && player.duration > 0) player.currentTime = Math.max(0, player.duration - .001);
  };

  const stop = (completed = false) => {
    playbackRequested.current = false;
    attempt.current++;
    jingleAudio.current?.pause(); jingleAudio.current = null; setJingle(false);
    const player = video.current;
    if (player) { player.pause(); lastFrame(player); }
    setPlaying(false);
    setPaused(false);
    setCaptionTime(completed ? (bulletin?.estimatedSeconds ?? (player && Number.isFinite(player.duration) ? player.duration : duration)) : 0);
  };

  useEffect(() => {
    const map = host.current?.closest('.regional-map');
    // Moving the stage into the fullscreen subtree remounts the video element; remember where it was and carry on from there.
    const sync = () => {
      const player = video.current;
      if (player && !player.paused) resume.current = player.currentTime;
      setFullscreen(document.fullscreenElement && map?.contains(document.fullscreenElement) ? document.fullscreenElement : null);
    };
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('visibilitychange', visibility);
      attempt.current++;
      video.current?.pause();
    };
  }, []);

  useEffect(() => {
    const player = video.current;
    const at = resume.current;
    if (!player || at === null) return;
    resume.current = null;
    player.currentTime = at;
    void player.play().catch(() => { setPlaying(false); setError('Video could not continue after the view change. Press Play.'); });
  }, [fullscreen]);

  useEffect(() => {
    if (!bulletin || !playing || paused) return;
    const total = bulletin.estimatedSeconds;
    const startedAt = performance.now() - captionTime * 1000 / speed;
    let frame = 0;
    const tick = () => {
      const t = (performance.now() - startedAt) / 1000 * speed;
      if (t >= total) { naturalEnd.current = true; stop(true); return; }
      setCaptionTime(t); frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, paused, bulletin, speed]);

  useEffect(() => {
    const player = video.current;
    if (!player || !playing || bulletin) return;
    let frame = 0;
    const tick = () => { setCaptionTime(player.currentTime); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, collapsed, fullscreen]);

  useEffect(() => {
    const map = host.current?.closest<HTMLElement>('.regional-map');
    const stage = stageBox.current;
    if (!map || !stage || collapsed) return;
    const resized = new ResizeObserver(() => align());
    const align = () => {
      const box = stage.getBoundingClientRect();
      const credits = [...map.querySelectorAll<HTMLElement>('.gm-style-cc, .map-attribution')].filter(node => {
        const bounds = node.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 && bounds.bottom > box.bottom - 30;
      });
      if (!credits.length) return;
      const bounds = credits.map(node => { resized.observe(node); return node.getBoundingClientRect(); });
      const edge = Math.min(...bounds.map(rect => rect.left));
      const bottom = Math.max(...bounds.map(rect => rect.bottom));
      const height = Math.max(...bounds.map(rect => rect.height));
      stage.style.setProperty('--reader-credit-right', `${Math.max(0, box.right - edge)}px`);
      stage.style.setProperty('--reader-credit-bottom', `${Math.max(0, box.bottom - bottom)}px`);
      stage.style.setProperty('--reader-credit-height', `${height}px`);
    };
    const changed = new MutationObserver(align);
    changed.observe(map, { childList:true, subtree:true, characterData:true });
    resized.observe(map);
    align();
    return () => { changed.disconnect(); resized.disconnect(); };
  }, [collapsed, fullscreen]);

  // Place the video on the same 1920x1080 stage grid as before: 710 px tall, right edge clear of the map controls, 16 px above the legal strip.
  useEffect(() => {
    const mapRoot = host.current?.closest<HTMLElement>('.regional-map');
    // Visibility is independent of the camera; keep its existing framing reservation.
    if (collapsed) return;
    const box = stageBox.current;
    const layout = () => {
      const player = video.current;
      if (!box || !player) return;
      const cssWidth = Math.max(1, box.clientWidth);
      const cssHeight = Math.max(1, box.clientHeight);
      const scale = cssWidth / 1920;
      const height = 710;
      const width = height * WELCOME.videoWidth / WELCOME.videoHeight;
      const landingLeft = .64 * 1920 + 16 * 1920 / cssWidth;
      const left = countryView ? (cssWidth-64)/scale-width : (fullscreen ? 1870-width : landingLeft)-30*1920/cssWidth;
      const legal = 16 * 1080 / cssHeight;
      player.style.left = `${left * scale}px`;
      player.style.top = `${(1080 - legal - height) * cssHeight / 1080}px`;
      player.style.width = `${width * scale}px`;
      player.style.height = `${height * cssHeight / 1080}px`;
      const cssLeft = left * scale;
      box.style.setProperty('--reader-presenter-left', `${cssLeft}px`);
      if (mapRoot && cssWidth > 700 && mapRoot.dataset.presenterLeft !== String(Math.round(cssLeft))) {
        mapRoot.dataset.presenterLeft = String(Math.round(cssLeft));
        mapRoot.dispatchEvent(new Event('aegis-presenter-layout'));
      }
    };
    layout();
    const resized = new ResizeObserver(layout);
    if (box) resized.observe(box);
    return () => resized.disconnect();
  }, [collapsed, fullscreen, clip?.id, countryView]);   // a new clip remounts the video element: place it again

  /** The station jingle: the first JINGLE.seconds of the track with a short fade, then the presenter starts. Resolves false if the viewer pressed stop meanwhile; a jingle that cannot play is skipped. */
  const playJingle = async (token: number): Promise<boolean> => {
    const audio = new Audio(JINGLE.src);
    audio.volume = JINGLE.volume;
    audio.muted = muted;
    jingleAudio.current = audio;
    try { await audio.play(); } catch { jingleAudio.current = null; return true; }
    setJingle(true);
    return new Promise<boolean>(resolve => {
      const timer = window.setInterval(() => {
        if (attempt.current !== token) { window.clearInterval(timer); audio.pause(); resolve(false); return; }
        const left = JINGLE.seconds - audio.currentTime;
        if (left < JINGLE.fadeSeconds) audio.volume = Math.max(0, JINGLE.volume * left / JINGLE.fadeSeconds);
        if (left <= 0 || audio.ended) { window.clearInterval(timer); audio.pause(); jingleAudio.current = null; setJingle(false); resolve(true); }
      }, 40);
    });
  };

  const play = async () => {
    setCollapsed(false);
    setPaused(false);
    setError('');
    setCaptionTime(0);
    const current = ++attempt.current;
    stopSpeaking();
    if (!(await playJingle(current))) return;   // stopped during the jingle
    if (bulletin) { setCaptionTime(0); setPlaying(true); return; }   // preview: captions run on our own clock, no video
    playbackRequested.current = true;
    await new Promise(resolve => setTimeout(resolve, 0));   // the video element mounts when the presenter was hidden
    const player = video.current;
    if (!player) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setPaused(false);
    try {
      player.currentTime = 0;
      await player.play();
      if (current === attempt.current) setPlaying(true);
    } catch {
      playbackRequested.current = false;
      if (current === attempt.current) { setPlaying(false); setError('Video could not play. Try Play again.'); }
    }
  };

  // The "Latest news" button asks for the news clip: stop whatever plays and start it from the jingle.
  useEffect(() => { if (playToken > 0 && clip) { if (playing || jingle) stop(); void play(); } }, [playToken]);   // eslint-disable-line react-hooks/exhaustive-deps

  const cues = bulletin ? bulletinCues(bulletin) : clip ? clip.cues : INTRO_CAPTIONS.map(item => ({ ...item, lowerThird: undefined as string | undefined }));
  // Map camera: while the presenter speaks the reader asks the map to move to the country being named, one second early; when it stops the map goes back (AEG-NEWS-006).
  const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width:767px)').matches === true;
  // Phone welcome: slow 2 s zoom into Singapore at about half of the 10.7 s message, hold 2 s, then a slow 2 s zoom back out.
  const cameraPlan: CameraStep[] = bulletin ? planCamera(bulletinMentions(bulletin)) : clip ? [
    { at: 38.33, view: 'sgp', travelSec: 3.2 },
    { at: 117.31, view: 'mys', travelSec: 3.2 },
    { at: 160.02, view: 'brn', travelSec: 3.2 },
  ] : phone ? planCamera([{ view: 'sgp', at: 5.4, end: 9.4 }], { leadSec: 0, travelSec: 2, minGapSec: 0.8, returnDelaySec: 0 }) : planCamera(WELCOME_MENTIONS);
  const cameraView = useRef<string | null>(null);
  const lastTime = useRef(0);
  const naturalEnd = useRef(false);
  const go = (root: Element, view: string, travelSec: number) => {
    if (view === 'default') root.dispatchEvent(new CustomEvent('aegis-camera-reset', { detail: { travelSec } }));
    else root.dispatchEvent(new CustomEvent('aegis-camera', { detail: { bounds: clip ? ({ sgp: COUNTRY_CAMERA_BOUNDS.Singapore, mys: COUNTRY_CAMERA_BOUNDS.Malaysia, brn: COUNTRY_CAMERA_BOUNDS.Brunei } as Record<string, typeof COUNTRY_CAMERA_BOUNDS.Singapore>)[view] ?? CAMERA_VIEWS.asean : CAMERA_VIEWS[view as keyof typeof CAMERA_VIEWS], travelSec } }));
  };
  useEffect(() => {
    const root = host.current?.closest('.regional-map');
    if (!root) return;
    if (playing) {
      lastTime.current = captionTime;
      const step = stepAt(cameraPlan, captionTime);
      const view = step?.view ?? null;
      if (clip && view && view !== cameraView.current) {
        (root as HTMLElement).dataset.newsCamera = 'true';
        window.dispatchEvent(new CustomEvent('aegis-news-country', { detail: { country: { sgp: 'Singapore', mys: 'Malaysia', brn: 'Brunei' }[view as 'sgp' | 'mys' | 'brn'] } }));
      }
      if (view !== cameraView.current) { cameraView.current = view; if (view && step) go(root, view, step.travelSec); }
      return;
    }
    if (clip && cameraView.current) {
      cameraView.current = null;
      if (naturalEnd.current) {
        naturalEnd.current = false;
        (root as HTMLElement).dataset.newsCamera = 'true';
        window.dispatchEvent(new CustomEvent('aegis-news-country', { detail: { country: '' } }));
        go(root, 'asean', 3.2);
        const timer = window.setTimeout(() => { delete (root as HTMLElement).dataset.newsCamera; }, 3300);
        return () => window.clearTimeout(timer);
      }
      delete (root as HTMLElement).dataset.newsCamera;
      return;
    }
    if (!cameraView.current || cameraView.current === 'default') { cameraView.current = null; return; }
    // Stopped while zoomed in: go back smoothly. When the clip ended by itself, wait for the formula's return time (2 s after the last country was said).
    const back = cameraPlan.find((s) => s.view === 'default');
    const wait = naturalEnd.current && back ? Math.max(0, back.at - lastTime.current) * 1000 : 0;
    naturalEnd.current = false;
    const timer = window.setTimeout(() => { go(root, 'default', 1.2); cameraView.current = null; }, wait);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, captionTime, bulletin]);
  const cue = cues.find(item => captionTime >= item.start && captionTime < item.end);
  const subtitleText = (cue?.text as Partial<Record<SubtitleLanguage, string>> | undefined)?.[subtitleLanguage] ?? cue?.text.en;
  const words = subtitleText?.split(' ') ?? [];
  const captionText = words.join(' ');
  const fade = cue ? Math.min(.3,(cue.end-cue.start)/4) : .3;
  const opacity = cue ? Math.max(0, Math.min(1, (captionTime - cue.start) / fade, (cue.end - captionTime) / fade)) : 0;
  useLayoutEffect(() => {
    const text = caption.current;
    const band = text?.parentElement;
    if (!text || !band) return;
    const fit = () => {
      let size = 18;
      text.style.fontSize = `${size}px`;
      while (size > 8 && (text.scrollHeight > band.clientHeight - 4 || text.scrollWidth > band.clientWidth - 16)) {
        size -= .5; text.style.fontSize = `${size}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(band);
    return () => observer.disconnect();
  }, [captionText, playing, collapsed, fullscreen]);


  const stage = <div ref={stageBox} className={`news-reader ${collapsed ? 'is-collapsed' : ''}`} data-testid="news-reader" data-stage="1920x1080">
    {!collapsed && <video ref={video} key={clip?.id ?? 'welcome'} src={clip ? clip.video : WELCOME.video} className="news-reader-video" playsInline muted={muted} preload="metadata" onLoadedMetadata={event => { setDuration(Number.isFinite(event.currentTarget.duration)?event.currentTarget.duration:0); if (!playbackRequested.current && event.currentTarget.paused) lastFrame(event.currentTarget); }} aria-label="AI-generated AEGIS presenter, transparent video" onTimeUpdate={event => { if (playbackRequested.current) setCaptionTime(event.currentTarget.currentTime); }} onSeeked={event => { if (playbackRequested.current) setCaptionTime(event.currentTarget.currentTime); }} onEnded={() => { if (!playbackRequested.current) return; naturalEnd.current = true; stop(true); }} onError={() => { playbackRequested.current = false; setPlaying(false); setError('Video unavailable. Try again later.'); }}/>}
    {!collapsed && playing && cue && <div className="reader-subtitles" style={{ opacity }} lang={subtitleText && cue?.text[subtitleLanguage] ? subtitleLanguage : 'en'} role="region" aria-label="Spoken subtitles">
      <span ref={caption}>{captionText}</span>
    </div>}
    {bulletin && <div className="news-preview-banner" role="status">PREVIEW for approval · not published · {bulletin.bulletinId === 'DRAFT' ? 'draft as at now (not stored)' : `${bulletin.slotId} bulletin`}{bulletin.reviewLabel ? ` · ${bulletin.reviewLabel}` : ''}</div>}
    {bulletin && !collapsed && playing && cue?.lowerThird && <div className="news-preview-lower" aria-label="Lower third">{cue.lowerThird}</div>}
    {bulletin && !collapsed && <span className="news-preview-note">Presenter placeholder: the video for this bulletin is not rendered yet. No audio. Subtitles are timed from estimated lengths.</span>}
    {!collapsed && <span ref={disclosure} className="reader-disclosure">{clip ? `AI-generated presenter & voice • ${clip.label}${clip.machineTranslated ? ' • Machine-translated subtitles, not human-reviewed' : ''}` : 'AI-generated presenter & Voice • 4× Daily Airtime • Env. telemetry sampled 1h prior for 125 monitoring pins'}</span>}
    <div className="news-reader-actions reader-language-controls" role="group" aria-label="Map and spoken subtitle language">{SUBTITLE_LANGUAGES.map(item => <button key={item.id} type="button" className="reader-language" lang={item.id} aria-label={`${item.name} map and subtitles`} aria-pressed={subtitleLanguage === item.id} title={`${item.name} map and subtitles`} onClick={() => { setSubtitleLanguage(item.id); try { window.localStorage.setItem(SUBTITLE_LANGUAGE_KEY, item.id); } catch { /* Current-page captions still change when storage is unavailable. */ } selectMapLanguage(item.id); }}>{item.label}</button>)}</div>
    <div className="news-reader-actions reader-visibility-control"><button type="button" aria-label={collapsed?'Show presenter':'Hide presenter'} aria-pressed={!collapsed} title={collapsed?'Show presenter':'Hide presenter'} onClick={()=>{if(!collapsed){cameraView.current=null;host.current?.closest('.regional-map')?.dispatchEvent(new Event('aegis-camera-hold'));stop();}setCollapsed(!collapsed);}}><Icon name={collapsed?'person':'personOff'} size={18}/></button></div>
    {!collapsed && <section className="news-reader-controls reader-standard-player" aria-label="Presenter video controls">
      <div className="news-reader-actions"><button type="button" className="reader-play" aria-label={jingle?'Stop introduction':playing&&!paused?'Pause video':paused?'Resume video':'Play introduction'} onClick={()=>{
        if(jingle){stop();return;}
        if(playing&&!paused){video.current?.pause();setPaused(true);return;}
        if(paused){void video.current?.play().then(()=>setPaused(false)).catch(()=>setError('Video could not resume.'));return;}
        void play();
      }}><span aria-hidden="true">{playing&&!paused?'⏸':'▶'}</span></button>
      <input className="reader-seek" type="range" aria-label="Video position" min="0" max={duration||1} step="0.1" value={Math.min(captionTime,duration||1)} style={{ '--reader-progress': `${duration > 0 ? Math.min(100, Math.max(0, captionTime / duration * 100)) : 0}%` } as CSSProperties} disabled={!duration||jingle||!!bulletin} onChange={e=>{const time=Number(e.target.value);if(video.current)video.current.currentTime=time;setCaptionTime(time);}}/>
      <span className="reader-time">{Math.floor(captionTime/60)}:{String(Math.floor(captionTime%60)).padStart(2,'0')} / {Math.floor(duration/60)}:{String(Math.floor(duration%60)).padStart(2,'0')}</span>
      <button type="button" aria-label={muted?'Unmute video':'Mute video'} aria-pressed={muted} onClick={()=>{setMuted(!muted);if(jingleAudio.current)jingleAudio.current.muted=!muted;}}><Icon name={muted?'muted':'volume'} size={16}/></button></div>
      {error && <span className="reader-status" role="alert">{error}</span>}
      {notice && <span className="reader-notice-sr" role="status">{notice}</span>}
    </section>}

  </div>;

  // Google fullscreen isolates its own DOM subtree. Portal the same controls/stage
  // into that subtree; keep audio outside so switching fullscreen never restarts it.
  return <div ref={host} className="news-reader-host">{fullscreen ? createPortal(stage, fullscreen) : stage}</div>;
}

/** The landing-page news reader. With ?previewBulletin=ID (opened by the administrator's News approval tab) the SAME reader shows that bulletin for approval instead of the welcome video. */
export function NewsReader({countryView=false}:{countryView?:boolean}) {
  const params = (() => { try { return new URLSearchParams(window.location.search); } catch { return null; } })();
  const id = params?.get('previewBulletin') ?? null;
  const speed = Math.max(1, Math.min(16, Number(params?.get('speed') ?? 1) || 1));
  const [bulletin, setBulletin] = useState<PreviewBulletin | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => { if (id) loadPreviewBulletin(id).then(setBulletin).catch((e: unknown) => setError(e instanceof Error ? e.message : 'The preview could not be loaded.')); }, [id]);
  const [latest, setLatest] = useState<LatestNews | undefined>(undefined);
  const [token, setToken] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const open = () => { setNotice(''); loadLatestNews().then((clip) => { setLatest(clip); setToken((t) => t + 1); }).catch((e: unknown) => setNotice(e instanceof Error ? e.message : 'The latest news could not be loaded.')); };
    window.addEventListener('aegis-play-latest-news', open);
    return () => window.removeEventListener('aegis-play-latest-news', open);
  }, []);
  if (!id) return <WelcomeReader countryView={countryView} {...(latest ? { clip: latest } : {})} playToken={token} notice={notice}/>;
  if (!bulletin) return error ? <div className="news-reader news-preview"><div className="news-preview-error" role="alert">{error}</div></div> : null;
  return <WelcomeReader countryView={countryView} bulletin={bulletin} speed={speed}/>;
}
