import {useEffect,useId,useRef,useState} from 'react';
import schedule from '../../../content/broadcast/schedule.json';
const names:Record<string,string>={morning:'Morning news',midday:'Midday news',evening:'Evening news',night:'Night news'};
// Archive placeholders describe the example clip, never imply these recordings exist.
export function NewsMenu(){
 const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);const id=useId();
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 const entries=[{slot:'morning',date:'17 Oct 2026',available:true},{slot:'night',date:'16 Oct 2026',available:false},{slot:'evening',date:'16 Oct 2026',available:false}];
 return <div className="map-news-menu" ref={root} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}}}>
 <button ref={trigger} type="button" className="map-news-button" aria-label="Latest news" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><svg className="map-control-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m4 2 4 4-4 4" stroke="currentColor" strokeWidth="1.5"/></svg>Latest news</button>
 <div id={id} className="map-news-archive" hidden={!open} aria-label="News bulletins">{entries.map(entry=><button type="button" key={entry.slot} disabled={!entry.available} onClick={()=>{setOpen(false);window.dispatchEvent(new CustomEvent('aegis-play-latest-news'));}}><strong>{names[entry.slot]}</strong><span>{entry.date} ? {schedule.slots.find(s=>s.id===entry.slot)?.airLocal} MYT</span><small>{entry.available?'Latest ? Example bulletin':'Archive placeholder ? Not available yet'}</small></button>)}</div>
 </div>;
}
