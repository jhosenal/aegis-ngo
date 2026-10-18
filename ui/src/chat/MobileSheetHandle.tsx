import {useRef} from 'react';
import {Icon} from '../dashboard/Icon.js';
export type MobileSheetState='peek'|'half'|'full';
const states:MobileSheetState[]=['peek','half','full'];
export function MobileSheetHandle({state,onChange,onNews}:{state:MobileSheetState;onChange:(state:MobileSheetState)=>void;onNews:()=>void}){
 const start=useRef<{y:number;time:number}|null>(null);
 return <div className="mobile-sheet-header">
 <button className="mobile-sheet-grip" aria-label="Resize AEGIS Assist sheet" aria-valuetext={state==='peek'?'Collapsed':state==='half'?'Half screen':'Expanded'} onPointerDown={e=>{start.current={y:e.clientY,time:Date.now()};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{const from=start.current;start.current=null;if(!from)return;const delta=e.clientY-from.y;if(Math.abs(delta)>30)onChange(states[Math.max(0,Math.min(2,states.indexOf(state)+(delta<0?1:-1)))]);}} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();onChange(states[Math.max(0,Math.min(2,states.indexOf(state)+(e.key==='ArrowUp'?1:-1)))]);}if(e.key==='Home')onChange('peek');if(e.key==='End')onChange('full');}} onClick={()=>{if(start.current)return;}}><span/></button>
 {state==='peek'?<div className="mobile-sheet-peek"><button onClick={()=>onChange('half')}><Icon name="spark" size={20}/><span>Ask AEGIS...</span></button><button disabled aria-label="Microphone input unavailable" title="Voice input is not connected"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8"/></svg></button></div>:<div className="mobile-sheet-options"><strong>AEGIS Assist</strong><button onClick={onNews}>Latest news</button><button aria-label={state==='full'?'Use half-screen Assist':'Expand Assist'} onClick={()=>onChange(state==='full'?'half':'full')}><Icon name="expand" size={17}/></button><button aria-label="Collapse Assist" onClick={()=>onChange('peek')}><span aria-hidden="true">⌄</span></button></div>}
 </div>;
}
