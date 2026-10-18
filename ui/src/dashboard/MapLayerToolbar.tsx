import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './map-layer-toolbar.css';
import { mapToolbarLayout } from '../formulations/pageTemplates.js';

export interface MapLayerChoice { id:string; label:string; icon?:ReactNode; count:number|null; enabled:boolean; toggle:()=>void }
export function MapLayerToolbar({ layers, onToggleAll, children }: { layers:readonly MapLayerChoice[];onToggleAll:(enabled:boolean)=>void;children?:ReactNode }) {
  const [open,setOpen]=useState<boolean>(mapToolbarLayout.initiallyExpanded);const id=useId();const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);
  const enabled=layers.filter(layer=>layer.enabled).length;
  const state=enabled===layers.length?'on':enabled===0?'off':'partial';
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
  return <div ref={root} className="map-layer-group" data-ui-formulation={`${mapToolbarLayout.id}/${mapToolbarLayout.version}`} data-state={state} onKeyDown={event=>{if(event.key==='Escape'&&open){event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
    <div className="map-layer-heading"><button ref={trigger} className="map-layer-disclosure" aria-label="Map layers" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><svg className="map-control-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m4 2 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg><span>{mapToolbarLayout.title}</span></button>
    <button className="map-layer-master" role="checkbox" aria-label="All map layers" aria-checked={state==='partial'?'mixed':state==='on'} onClick={()=>onToggleAll(state!=='on')}><span className="map-master-indicator" aria-hidden="true"/><span>{state==='partial'?'Partial':state==='on'?'On':'Off'}</span></button></div>
    <div id={id} className="map-layer-panel" hidden={!open}>
      <div className="map-layer-control" role="group" aria-label="Individual map layers">{layers.map(layer=><button key={layer.id} aria-label={layer.label} aria-pressed={layer.enabled} onClick={layer.toggle}>{layer.icon}<span>{layer.label}</span><span className="map-layer-count" aria-hidden="true">{layer.count??'\u2014'}</span><span className="map-toggle" aria-hidden="true"/></button>)}</div>
      {children && <div className="map-layer-status">{children}</div>}
    </div>
  </div>;
}
