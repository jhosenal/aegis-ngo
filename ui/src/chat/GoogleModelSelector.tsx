import {Icon} from '../dashboard/Icon.js';

export interface ChatModeOption { id:string; label:string; available:boolean; note?:string }
const GOOGLE_MODELS = [
 {id:'gemini-3.5-flash-lite',label:'Gemini 3.5 Flash-Lite',tag:'LITE',description:'Lightweight queries and telemetry parsing',icon:'spark'},
 {id:'gemini-3.8-flash',label:'Gemini 3.8 Flash',tag:'DEFAULT',description:'Everyday chat, translation and summaries',icon:'spark'},
 {id:'gemini-4-argon',label:'Gemini 4 Argon',tag:'PRO',description:'Multi-source reasoning and broadcast drafts',icon:'layers'},
];

export function GoogleModelSelector({mode,modes,onSelect}:{mode:string;modes:ChatModeOption[];onSelect:(id:string)=>void}){
 const auto=modes.find(option=>option.id==='auto');
 const pending=GOOGLE_MODELS.some(model=>!modes.some(option=>option.id===model.id));
 return <section className="google-model-selector" aria-label="Google AI Engine">
  <h3>Google AI Engine</h3>
  <button type="button" className="google-model-auto" aria-pressed={mode==='auto'} disabled={!auto?.available} onClick={()=>onSelect('auto')}><Icon name="settings" size={16}/><span>Auto routing</span>{mode==='auto'&&<Icon name="include" size={16}/>}</button>
  <div role="group" aria-label="Google models">
   {GOOGLE_MODELS.map(model=>{
    const option=modes.find(item=>item.id===model.id);
    const available=option?.available===true;
    const selected=available&&mode===model.id;
    const reason=available?undefined:model.tag==='PRO'?'Admin/Pro clearance required.' :option?.note||'Model activation pending.';
    return <div key={model.id} className="google-model-card">
    <button type="button" className="google-model-option" aria-disabled={!available} aria-describedby={!available?`${model.id}-availability`:undefined} aria-pressed={selected} onClick={()=>{if(available)onSelect(model.id);}}>
     <Icon name={model.icon} size={19}/>
     <span className="google-model-copy"><strong>{model.label}</strong><small>{model.description}</small></span>
     <span className="google-model-indicators"><span className={`google-model-tag google-model-tag-${model.tag.toLowerCase()}`}>{model.tag}</span>{selected&&<Icon name="include" size={16}/ >}{!available&&model.tag==='PRO'&&<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-label="Locked"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>}</span>
    </button>
    {!available&&<span className="google-model-tooltip" id={`${model.id}-availability`} role="tooltip">{reason}{model.tag==='PRO'&&!option?' Model activation is also pending.':''}</span>}
    </div>;
   })}
  </div>
  {pending&&<p className="google-model-status">Google model activation pending. Auto uses the current server configuration.</p>}
 </section>;
}
