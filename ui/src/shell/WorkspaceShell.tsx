import {useChatWorkspace} from '../chat/ChatWorkspace.js';
import {AccountMenu} from '../chat/AccountMenu.js';
import {ChatDock} from '../chat/ChatDock.js';
import {useEffect,useRef,useState,type ReactNode,type CSSProperties} from 'react';
import {WorkspaceSidebar} from './WorkspaceSidebar.js';
import {SiteHeader} from './SiteChrome.js';
import {ModuleCard} from '../components/ModuleCard.js';
import {ChatPanel} from '../components/ChatPanel.js';
import {Divider} from '../components/Divider.js';
import {Icon} from '../dashboard/Icon.js';
import {useWorkspaceStore} from '../state/store.js';
import {PAGE_LAYOUT,pageTemplates,type PageTemplateId} from '../formulations/pageTemplates.js';
import '../dashboard/dashboard.css';
import '../dashboard/dock.css';
import './WorkspaceShell.css';
/** Page card -> shared shell -> module card -> route sections/data cards. See AEG-SOP-004. */
export function WorkspaceShell({page,children,assistant=true}: {page:PageTemplateId;children:ReactNode;assistant?:boolean}) {
 const chatWorkspace=useChatWorkspace();
 const [state,dispatch]=useWorkspaceStore();const [open,setOpen]=useState(false);const [split,setSplit]=useState(74);const [panelResized,setPanelResized]=useState(false);const resizePanels=(value:number)=>{setPanelResized(true);setSplit(value);};const menu=useRef<HTMLButtonElement>(null);const recipe=pageTemplates[page];
 useEffect(()=>{if(!open)return;const previous=document.activeElement as HTMLElement|null;const nav=document.getElementById('aegis-navigation');const items=()=>[...nav?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])')??[]];items()[0]?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);if(event.key==='Tab'){const targets=items();if(event.shiftKey&&document.activeElement===targets[0]){event.preventDefault();targets.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===targets.at(-1)){event.preventDefault();targets[0]?.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);(previous??menu.current)?.focus();};},[open]);
 return <div className={`regional-app workspace-shell ${assistant?'with-assistant':'without-assistant'}`} data-ui-formulation={`${PAGE_LAYOUT.id}/${PAGE_LAYOUT.version}`} data-sop={PAGE_LAYOUT.sop} style={{'--navigation-width':`${PAGE_LAYOUT.navigationWidth}px`,'--desktop-columns':assistant?`${PAGE_LAYOUT.navigationWidth}px minmax(0,1fr) 8px ${PAGE_LAYOUT.chatWidth}px`:`${PAGE_LAYOUT.navigationWidth}px minmax(0,1fr)`} as CSSProperties}>
 <a className="dashboard-skip" href="#page-content">Skip to page content</a><SiteHeader><button ref={menu} className="ui-icon-button shell-menu" aria-label="Open navigation" aria-expanded={open} aria-controls="aegis-navigation" onClick={()=>setOpen(v=>!v)}><Icon name="menu"/></button><span className="shell-page-name">{recipe.title}</span></SiteHeader>
 <div className="dashboard-body">{open&&<button className="nav-scrim" aria-label="Close navigation" onClick={()=>setOpen(false)}/>}<WorkspaceSidebar current={page} open={open} admin={state.session?.user.isAdmin} onNavigate={()=>setOpen(false)} chatSession={state.session} account={<AccountMenu session={state.session} onSignIn={()=>window.location.assign('/?login=true')} onSignOut={()=>{try{window.sessionStorage.setItem('aegis.noAutoLogin','1');}catch{/* no storage */}dispatch({type:'session',session:null});}}/>}/>
 <div className="dashboard-content-layout shell-content-layout" style={{gridTemplateColumns:assistant?(panelResized?`minmax(0,${split}fr) 8px minmax(260px,${100-split}fr)`:`minmax(0,1fr) 8px ${PAGE_LAYOUT.chatWidth}px`):'minmax(0,1fr)'} as CSSProperties}>
 <div className="dashboard-main shell-page-content" id="page-content" tabIndex={-1}><ModuleCard cardId={recipe.cardId} title={recipe.title} eyebrow="AEGIS WORKSPACE" collapsible={false} className="shell-page-card">{children}</ModuleCard></div>
 {assistant&&<><Divider value={split} onChange={resizePanels}/><aside className="dashboard-assist" aria-label="AEGIS Assist"><ChatDock messages={chatWorkspace.messages} attachments={state.attachments}><ChatPanel helper token={state.session?.token??null} cards={[]} attachments={state.attachments} messages={chatWorkspace.messages} suggestions={['Summarize sector hazards', 'Find nearby help and hospitals', 'Drop a pin to check this location']} onRemoveAttachment={()=>undefined} onAddMessage={message=>dispatch({type:'chat-message',...message})} onClearAttachments={()=>dispatch({type:'clear-attachments'})} onOpenCard={()=>undefined}/></ChatDock></aside></>}
 </div></div></div>;
}
