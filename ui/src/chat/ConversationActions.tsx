import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {apiRequest} from '../api/client.js';
import {Icon} from '../dashboard/Icon.js';
import type {ConversationSummary} from './ChatWorkspace.js';

/** Row actions never select a thread or issue a map/presenter command. */
export function ConversationActions({thread,token,onRename,onDelete,onTogglePin,isPinned}:{thread:ConversationSummary;token:string;onRename:()=>void;onDelete:()=>void;onTogglePin:()=>void;isPinned:boolean}) {
 const [open,setOpen]=useState(false);const [share,setShare]=useState(false);const [busy,setBusy]=useState(false);const [status,setStatus]=useState('');
 const trigger=useRef<HTMLButtonElement>(null);const panel=useRef<HTMLDivElement>(null);const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const close=(restoreFocus=true)=>{setOpen(false);if(restoreFocus)trigger.current?.focus();};
 useEffect(()=>{if(!open)return;panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setOpen(false);};const dismiss=()=>setOpen(false);document.addEventListener('pointerdown',outside);window.addEventListener('resize',dismiss);window.addEventListener('scroll',dismiss,true);return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',dismiss);window.removeEventListener('scroll',dismiss,true);};},[open]);
 const exportText=async()=>{
  let cursor:string|null=null;const lines=[thread.title,'Local conversation export'];const seen=new Set<string>();
  do {
   const params=new URLSearchParams({limit:'200'});if(cursor)params.set('cursor',cursor);
   const page=await apiRequest<{messages:{role:string;text:string;attachments?:{cardId:string;revision:number}[]}[];nextCursor:string|null}>(`/api/conversations/${encodeURIComponent(thread.conversationId)}?${params}`,{token});
   for(const message of page.messages){lines.push(`${message.role}: ${message.text}`);for(const ref of message.attachments??[])lines.push(`Attached: ${ref.cardId} revision ${ref.revision}`);}
   cursor=page.nextCursor;if(cursor&&seen.has(cursor))throw Error('Message paging failed. Please retry.');if(cursor)seen.add(cursor);
  }while(cursor);
  return lines.join('\n\n');
 };
 const localShare=async(download:boolean)=>{setBusy(true);setStatus('');try{const text=await exportText();if(!alive.current)return;if(download){const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='aegis-conversation.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}else await navigator.clipboard.writeText(text);if(alive.current)setStatus(download?'Downloaded locally. No public link created.':'Copied locally. No public link created.');}catch(e){if(alive.current)setStatus(e instanceof Error?e.message:'Export failed. Please retry.');}finally{if(alive.current)setBusy(false);}};
 const box=trigger.current?.getBoundingClientRect();
 const top=Math.max(8,Math.min(box?.top??8,window.innerHeight-340));const left=Math.max(8,Math.min(box?.right??8,window.innerWidth-244));
 return <><button className="chat-row-quick" aria-label={`Rename ${thread.title}`} title="Rename chat" onClick={onRename}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4 M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/></svg></button><button className="chat-row-quick" aria-label={isPinned ? `Unpin ${thread.title}` : `Pin ${thread.title}`} aria-pressed={isPinned} title={isPinned ? 'Unpin chat from top' : 'Pin chat to top on this device'} onClick={event=>{onTogglePin();event.currentTarget.blur();}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6 M10 3v6l-4 4v2h12v-2l-4-4V3 M12 15v6"/>{isPinned&&<path d="M4 4l16 16"/>}</svg></button><button ref={trigger} className="chat-actions-trigger" aria-label={`Actions for ${thread.title}`} aria-expanded={open} aria-haspopup="menu" onClick={()=>{setShare(false);setStatus('');setOpen(!open);}}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>{open&&createPortal(<div ref={panel} className="conversation-row-actions" style={{top,left}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=[...panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const index=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}if(e.key==='Tab')setOpen(false);}}>
 <div role="menu" aria-label={`Chat actions for ${thread.title}`}>
 <button role="menuitem" onClick={()=>{close();onRename();}}><Icon name="report" size={18}/>Rename</button>
  <button role="menuitem" aria-pressed={isPinned} onClick={()=>{close(false);onTogglePin();}}><Icon name="pin" size={18}/>{isPinned?'Unpin from top':'Pin to top'}</button>
 <div className="chat-action-divider"/>
 <button role="menuitem" aria-expanded={share} onClick={()=>setShare(!share)}><Icon name="arrow" size={18}/>Share</button>
 {share&&<><button role="menuitem" disabled={busy} onClick={()=>void localShare(false)}>Copy conversation</button><button role="menuitem" disabled={busy} onClick={()=>void localShare(true)}>Download Markdown</button></>}
 <div className="chat-action-divider"/>
 <button role="menuitem" disabled title="Saved archiving is not available yet"><Icon name="box" size={18}/>Archive<span className="chat-action-unavailable">Not available yet</span></button>
 <button role="menuitem" className="chat-action-delete" onClick={()=>{close();onDelete();}}><Icon name="close" size={18}/>Delete</button>
 </div>{busy&&<p role="status">Preparing local export...</p>}{status&&<p role="status">{status}</p>}
 </div>,document.body)}</>;
}
