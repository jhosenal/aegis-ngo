import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {ChatMessageView} from '../state/store.js';
import {Icon} from '../dashboard/Icon.js';
import {useChatWorkspace,messageText} from './ChatWorkspace.js';
import {GoogleModelSelector} from './GoogleModelSelector.js';

interface ModeOption { id:string; label:string; available:boolean }
interface ModeState { mode:string; modes:ModeOption[] }

export function ChatDock({children,attachments,onClose}:{children:ReactNode;messages:ChatMessageView[];attachments:{cardId:string;revision:number}[];onClose?:()=>void}){
 const chat=useChatWorkspace();
 const [menuOpen,setMenuOpen]=useState(false);
 const [contextOpen,setContextOpen]=useState(false);
 const [status,setStatus]=useState('');
 const [modeState,setModeState]=useState<ModeState>({mode:'auto',modes:[]});
 const root=useRef<HTMLDivElement>(null);
 const menuTrigger=useRef<HTMLButtonElement>(null);
 const contextTrigger=useRef<HTMLButtonElement>(null);

 const sent=chat.messages.flatMap(message=>message.attachments??[]);
 const blocks=chat.messages.flatMap(message=>message.blocks);
 const cardRefs=blocks.flatMap(block=>block.type==='cardRef'||block.type==='mapFocus'?[{cardId:block.cardId,revision:block.revision}]:[]);
 const credits=[...new Set(blocks.flatMap(block=>block.type==='places'?[block.credit]:[]))];
 const hasContext=attachments.length+sent.length+cardRefs.length+credits.length>0;
 const title=chat.title;
 const text=()=>[title,chat.messageCursor?'Local export: loaded messages only (more messages available).':'Local conversation export',...chat.messages.map(message=>`${message.role??'assistant'}: ${messageText(message)}`),...sent.map(ref=>`Attached: ${ref.cardId} revision ${ref.revision}`),...cardRefs.map(ref=>`Reply reference: ${ref.cardId} revision ${ref.revision}`),...credits].join('\n\n');

 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)){setMenuOpen(false);setContextOpen(false);}};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){if(menuOpen){setMenuOpen(false);menuTrigger.current?.focus();}else if(contextOpen){setContextOpen(false);contextTrigger.current?.focus();}}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
 },[menuOpen,contextOpen]);
 useEffect(()=>{setMenuOpen(false);setContextOpen(false);setStatus('');},[chat.currentId]);
 useEffect(()=>{
  const state=(event:Event)=>setModeState((event as CustomEvent<ModeState>).detail);
  window.addEventListener('aegis-chat-mode-state',state);
  window.dispatchEvent(new CustomEvent('aegis-chat-mode-query'));
  return()=>window.removeEventListener('aegis-chat-mode-state',state);
 },[]);

 const copy=()=>{setMenuOpen(false);void navigator.clipboard.writeText(text()).then(()=>setStatus('Copied locally. No public link created.')).catch(()=>setStatus('Copy unavailable. Use Download instead.'));};
 const download=()=>{setMenuOpen(false);const url=URL.createObjectURL(new Blob([text()],{type:'text/markdown;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='aegis-conversation.md';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setStatus('Downloaded locally. No public link created.');};
 const selectMode=(id:string)=>{window.dispatchEvent(new CustomEvent('aegis-chat-mode-select',{detail:id}));setMenuOpen(false);setStatus('Model selection updated.');};

 return <div ref={root} className="chat-dock-workspace" data-ui-formulation="AEG.UI.CONVERSATION/1.0.0">
  <header className="chat-conversation-header">
   <div className="chat-assist-brand"><span>AEGIS Assist</span><span className="assist-source-badge" title="Responses use checked AEGIS sources and conversation context"><Icon name="shield" size={13}/><span>Sourced &amp; Checked</span></span></div>
   <div className="chat-header-actions">
    <div className="chat-context-anchor">
     <button ref={contextTrigger} type="button" aria-label="Used in this chat" title={hasContext?'Used in this chat':'No sources or attachments in this chat'} aria-expanded={contextOpen} disabled={!hasContext} onClick={()=>{setContextOpen(value=>!value);setMenuOpen(false);}}><Icon name="layers" size={17}/></button>
     {contextOpen&&hasContext&&<section className="chat-context-panel" aria-label="Used in this chat">
      {sent.length+attachments.length>0&&<><strong>Attachments</strong>{sent.map((ref,index)=><p key={`sent-${index}`}>{ref.cardId} · revision {ref.revision}</p>)}{attachments.map(ref=><p key={`next-${ref.cardId}`}>{ref.cardId} · revision {ref.revision} (for next message)</p>)}</>}
      {cardRefs.length+credits.length>0&&<><strong>Sources &amp; references</strong>{cardRefs.map((ref,index)=><p key={`reference-${index}`}>{ref.cardId} · revision {ref.revision}</p>)}{credits.map(credit=><p key={credit}>{credit}</p>)}</>}
     </section>}
    </div>
    <div className="chat-header-menu-anchor">
    <button ref={menuTrigger} type="button" aria-label="Assistant menu" title="Assistant menu" aria-expanded={menuOpen} onClick={()=>{setMenuOpen(value=>!value);setStatus('');setContextOpen(false);}}><Icon name="settings" size={17}/></button>
     {menuOpen&&<section className="chat-header-menu" aria-label="Assistant menu">
      <button type="button" onClick={()=>{setMenuOpen(false);void chat.create();}}><Icon name="plus" size={16}/><span>New conversation</span></button>
      <div className="chat-header-menu-divider"/>
      <button type="button" onClick={copy}><Icon name="include" size={16}/><span>Copy conversation</span></button>
      <button type="button" onClick={download}><Icon name="report" size={16}/><span>Download Markdown</span></button>
      <div className="chat-header-menu-divider"/>
      <GoogleModelSelector mode={modeState.mode} modes={modeState.modes} onSelect={selectMode}/>
     </section>}
    </div>
    {onClose&&<button type="button" aria-label="Close AEGIS Assist" title="Close AEGIS Assist" onClick={onClose}><Icon name="close" size={17}/></button>}
   </div>
  </header>
  {status&&<p className="chat-action-status" role="status">{status}</p>}
  {chat.loadingMessages&&<p className="chat-thread-status" role="status">Loading conversation...</p>}
  {chat.error&&<p className="chat-thread-status" role="alert">{chat.error}</p>}
  {chat.interrupted&&<p className="chat-thread-status" role="status">This conversation was interrupted. You can continue here.</p>}
  {chat.messageCursor&&<button className="chat-load-messages" onClick={()=>void chat.loadMoreMessages()} disabled={chat.loadingMessages}>Load more messages</button>}
  <div className="chat-live-panel"><div className="chat-slot-anchor">{children}</div></div>
 </div>;
}
